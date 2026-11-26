import type { MeDto, Role, TokenPair } from '@wasl/shared';

export interface TokenVault {
  read(): Promise<TokenPair | null>;
  write(pair: TokenPair | null): Promise<void>;
}
export class SessionChangedError extends Error {
  constructor() { super('Session changed'); }
}
/** One refresh operation per token, with stale account responses rejected. */
export class NativeApi {
  private pair: TokenPair | null = null;
  private rotation?: { epoch: number; pair: TokenPair; pending: Promise<void> };
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;
  private switchIntent = 0;
  get epoch() { return this.generation; }
  constructor(
    readonly base: string,
    private vault: TokenVault,
    private expired: () => void,
  ) {}
  assertCurrent(epoch: number) {
    if (epoch !== this.epoch) throw new SessionChangedError();
  }
  private async save(pair: TokenPair | null, epoch: number) {
    this.assertCurrent(epoch);
    this.pair = pair;
    this.writes = this.writes.catch(() => undefined).then(() => {
      if (epoch === this.epoch && pair === this.pair) return this.vault.write(pair);
    });
    await this.writes;
    this.assertCurrent(epoch);
  }
  async restore() {
    const epoch = this.epoch;
    const original = this.pair;
    await this.writes;
    this.assertCurrent(epoch);
    const pair = await this.vault.read();
    this.assertCurrent(epoch);
    if (original === this.pair && !original) this.pair = pair;
    return !!this.pair;
  }
  private async fetch(path: string, init: RequestInit = {}, token?: string) {
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
  private async revoke(refreshToken?: string) {
    if (refreshToken) {
      await this.fetch('auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
  }
  private async clearExpired(epoch: number, pair: TokenPair | null) {
    if (epoch !== this.epoch || pair !== this.pair) return;
    const cleared = ++this.generation;
    try {
      await this.save(null, cleared);
    } finally {
      if (cleared === this.epoch) this.expired();
    }
  }
  private refresh(epoch: number, pair: TokenPair) {
    this.assertCurrent(epoch);
    if (this.rotation?.epoch === epoch && this.rotation.pair === pair) return this.rotation.pending;
    const pending = this.rotate(epoch, pair).finally(() => {
      if (this.rotation?.pending === pending) this.rotation = undefined;
    });
    this.rotation = { epoch, pair, pending };
    return pending;
  }
  private async rotate(epoch: number, original: TokenPair) {
    this.assertCurrent(epoch);
    const r = await this.fetch('auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: original.refreshToken }),
    });
    if (!r.ok) {
      this.assertCurrent(epoch);
      if (r.status === 401) await this.clearExpired(epoch, original);
      return this.failure(r);
    }
    const pair = (await r.json()) as TokenPair;
    if (epoch !== this.epoch) {
      void this.revoke(pair.refreshToken);
      this.assertCurrent(epoch);
    }
    await this.save(pair, epoch);
  }
  async response(path: string, init: RequestInit = {}, epoch = this.epoch) {
    this.assertCurrent(epoch);
    let pair = this.pair;
    let result = await this.fetch(path, init, pair?.accessToken);
    this.assertCurrent(epoch);
    if (result.status === 401 && pair?.refreshToken) {
      // A delayed 401 for a replaced pair can use the completed rotation.
      if (pair === this.pair) await this.refresh(epoch, pair);
      this.assertCurrent(epoch);
      pair = this.pair;
      result = await this.fetch(path, init, pair?.accessToken);
      this.assertCurrent(epoch);
    }
    if (!result.ok) {
      if (result.status === 401 && pair) await this.clearExpired(epoch, pair);
      return this.failure(result);
    }
    return result;
  }
  async call<T>(path: string, method = 'GET', input?: unknown, epoch = this.epoch): Promise<T> {
    const response = await this.response(path, {
      method,
      ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
    }, epoch);
    const data = response.status === 204 ? undefined : await response.json();
    this.assertCurrent(epoch);
    return data as T;
  }
  async all<T>(path: string, epoch = this.epoch): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page++) {
      const r = await this.call<{ items: T[]; total: number }>(
        path + (path.includes('?') ? '&' : '?') + `limit=100&page=${page}`,
        'GET', undefined, epoch,
      );
      rows.push(...r.items);
      if (!r.items.length || rows.length >= r.total) return rows;
    }
  }
  async login(email: string, password: string): Promise<MeDto> {
    const epoch = ++this.generation;
    await this.save(null, epoch);
    const r = await this.fetch('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) return this.failure(r);
    const pair = (await r.json()) as TokenPair;
    if (epoch !== this.epoch) {
      void this.revoke(pair.refreshToken);
      this.assertCurrent(epoch);
    }
    await this.save(pair, epoch);
    return this.call<MeDto>('me', 'GET', undefined, epoch);
  }
  async switchContext(schoolId: string | null, role: Role): Promise<MeDto> {
    const origin = this.epoch;
    const intent = ++this.switchIntent;
    const result = await this.response('auth/switch-school', {
      method: 'POST', body: JSON.stringify({ schoolId, role }),
    }, origin);
    const pair = await result.json() as TokenPair;
    if (origin !== this.epoch || intent !== this.switchIntent) {
      void this.revoke(pair.refreshToken);
      throw new SessionChangedError();
    }
    const epoch = ++this.generation;
    await this.save(pair, epoch);
    return this.call<MeDto>('me', 'GET', undefined, epoch);
  }
  async logout() {
    const token = this.pair?.refreshToken;
    const epoch = ++this.generation;
    try {
      await this.save(null, epoch);
    } finally {
      await this.revoke(token);
    }
  }
}
