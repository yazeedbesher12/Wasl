import type { MeDto, Role, TokenPair } from '@wasl/shared';

export interface TokenVault {
  read(): Promise<TokenPair | null>;
  write(pair: TokenPair | null): Promise<void>;
}
/** One refresh operation per token, with stale account responses rejected. */
export class NativeApi {
  private pair: TokenPair | null = null;
  private rotation?: Promise<void>;
  private writes: Promise<void> = Promise.resolve();
  epoch = 0;
  constructor(
    readonly base: string,
    private vault: TokenVault,
    private expired: () => void,
  ) {}
  private async save(pair: TokenPair | null, epoch: number) {
    if (epoch !== this.epoch) throw new Error('Session changed');
    this.pair = pair;
    this.writes = this.writes.catch(() => undefined).then(() => this.vault.write(pair));
    await this.writes;
    if (epoch !== this.epoch) throw new Error('Session changed');
  }
  async restore() {
    const epoch = this.epoch;
    const pair = await this.vault.read();
    if (epoch === this.epoch) this.pair = pair;
    return !!pair;
  }
  private async fetch(path: string, init: RequestInit = {}, token = this.pair?.accessToken) {
    return fetch(this.base.replace(/\/$/, '') + '/' + path, {
      ...init,
      headers: {
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(20000),
    });
  }
  private async failure(r: Response): Promise<never> {
    const body = await r.json().catch(() => ({}));
    throw Object.assign(
      new Error(typeof body.message === 'string' ? body.message : 'Request failed'),
      { status: r.status },
    );
  }
  async response(path: string, init: RequestInit = {}) {
    const epoch = this.epoch;
    let result = await this.fetch(path, init);
    if (result.status === 401 && this.pair?.refreshToken) {
      if (!this.rotation) {
        const token = this.pair.refreshToken;
        this.rotation = (async () => {
          const r = await this.fetch('auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: token }),
          });
          if (!r.ok) {
            if (r.status === 401 && epoch === this.epoch) {
              await this.save(null, epoch);
              this.expired();
            }
            return this.failure(r);
          }
          const pair = (await r.json()) as TokenPair;
          if (epoch !== this.epoch) {
            await this.fetch('auth/logout', {
              method: 'POST',
              body: JSON.stringify({ refreshToken: pair.refreshToken }),
            }).catch(() => undefined);
            throw new Error('Session changed');
          }
          await this.save(pair, epoch);
        })().finally(() => {
          this.rotation = undefined;
        });
      }
      await this.rotation;
      if (epoch !== this.epoch) throw new Error('Session changed');
      result = await this.fetch(path, init);
    }
    if (epoch !== this.epoch) throw new Error('Session changed');
    if (!result.ok) {
      if (result.status === 401) {
        await this.save(null, epoch);
        this.expired();
      }
      return this.failure(result);
    }
    return result;
  }
  async call<T>(path: string, method = 'GET', input?: unknown): Promise<T> {
    const response = await this.response(path, {
      method,
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    });
    return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
  }
  async all<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page++) {
      const r = await this.call<{ items: T[]; total: number }>(
        path + (path.includes('?') ? '&' : '?') + `limit=100&page=${page}`,
      );
      rows.push(...r.items);
      if (!r.items.length || rows.length >= r.total) return rows;
    }
  }
  async login(email: string, password: string): Promise<MeDto> {
    const epoch = ++this.epoch;
    const r = await this.fetch('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return this.failure(r);
    const pair = (await r.json()) as TokenPair;
    await this.save(pair, epoch);
    return this.call<MeDto>('me');
  }
  async switchContext(schoolId: string | null, role: Role): Promise<MeDto> {
    const pair = await this.call<TokenPair>('auth/switch-school', 'POST', { schoolId, role });
    const epoch = ++this.epoch;
    await this.save(pair, epoch);
    return this.call<MeDto>('me');
  }
  async logout() {
    const token = this.pair?.refreshToken;
    const pending = this.rotation;
    this.epoch++;
    this.pair = null;
    this.writes = this.writes.catch(() => undefined).then(() => this.vault.write(null));
    await this.writes;
    if (pending) await pending.catch(() => undefined);
    if (token)
      await this.fetch('auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: token }),
      }).catch(() => undefined);
  }
}
