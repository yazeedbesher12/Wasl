import type { LoginResponse, MeDto, TokenPair } from './index';

/** Minimal typed API client shared by the web and mobile apps. */
export class WaslClient {
  constructor(
    private baseUrl: string,
    private getToken: () => string | null = () => null,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = res.status === 204 ? undefined : await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(body?.message ?? res.statusText), { status: res.status, body });
    }
    return body as T;
  }

  login(email: string, password: string) {
    return this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  refresh(refreshToken: string) {
    return this.request<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  me() {
    return this.request<MeDto>('/me');
  }
}
