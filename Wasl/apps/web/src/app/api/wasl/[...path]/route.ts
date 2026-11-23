import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import type { TokenPair } from '@wasl/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const accessCookie = 'wasl.access';
const refreshCookie = 'wasl.refresh';
const sessionCookie = 'wasl.session';
// The development API is single-process. Keep session revocation in this BFF
// process too; a restart deliberately requires sign-in again.
type BffState = {
  sessions: Map<string, { valid: boolean; expires: number }>;
  refreshing: Map<string, Promise<TokenPair | null>>;
};
const host = globalThis as typeof globalThis & { waslBffState?: BffState };
// Next development recompilation must not discard active sessions.
const { sessions, refreshing } = (host.waslBffState ??= {
  sessions: new Map(),
  refreshing: new Map(),
});
const apiUrl = () =>
  (process.env.WASL_API_URL ?? 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
function clear(response: NextResponse) {
  response.cookies.set(sessionCookie, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(accessCookie, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(refreshCookie, '', { ...cookieOptions, maxAge: 0 });
}
function setTokens(response: NextResponse, pair: TokenPair, sessionId: string) {
  response.cookies.set(sessionCookie, sessionId, { ...cookieOptions, maxAge: 30 * 86400 });
  response.cookies.set(accessCookie, pair.accessToken, { ...cookieOptions, maxAge: 86400 });
  response.cookies.set(refreshCookie, pair.refreshToken, { ...cookieOptions, maxAge: 30 * 86400 });
}
async function rotate(token: string): Promise<TokenPair | null> {
  const key = createHash('sha256').update(token).digest('hex');
  let operation = refreshing.get(key);
  if (!operation) {
    operation = (async () => {
      const r = await fetch(apiUrl() + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 401) return null;
      if (!r.ok) throw new Error('Session service unavailable');
      return r.json() as Promise<TokenPair>;
    })();
    refreshing.set(key, operation);
    // Concurrent requests carrying the consumed cookie receive the same replacement.
    void operation
      .finally(() => {
        setTimeout(() => refreshing.delete(key), 10000).unref();
      })
      .catch(() => undefined);
  }
  return operation;
}
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (
    !path.length ||
    path.some((p) => !/^[A-Za-z0-9-]+$/.test(p)) ||
    path[0] === 'health' ||
    path.join('/') === 'auth/refresh'
  )
    return NextResponse.json({ message: 'Unavailable route' }, { status: 404 });
  const method = request.method;
  if (method !== 'GET') {
    const origin = request.headers.get('origin');
    let sameOrigin = false;
    try {
      const supplied = new URL(origin ?? '');
      sameOrigin = process.env.WASL_WEB_ORIGIN
        ? supplied.origin === new URL(process.env.WASL_WEB_ORIGIN).origin
        : ['http:', 'https:'].includes(supplied.protocol) &&
          supplied.host === request.headers.get('host');
    } catch {}
    if (!sameOrigin)
      return NextResponse.json({ message: 'Invalid request origin' }, { status: 403 });
  }
  const route = path.join('/');
  let pair: TokenPair | undefined;
  let token = request.cookies.get(accessCookie)?.value;
  const refresh = request.cookies.get(refreshCookie)?.value;
  const sessionId = request.cookies.get(sessionCookie)?.value ?? '';
  const session = sessions.get(sessionId);
  if (
    !['auth/login', 'auth/logout'].includes(route) &&
    (!session?.valid || session.expires < Date.now())
  )
    return NextResponse.json({ message: 'Sign in required' }, { status: 401 });
  try {
    if (route === 'auth/logout') {
      if (session) session.valid = false;
      const pending = refresh
        ? refreshing.get(createHash('sha256').update(refresh).digest('hex'))
        : undefined;
      const replacement = pending ? await pending.catch(() => null) : null;
      if (refresh)
        await fetch(apiUrl() + '/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: replacement?.refreshToken ?? refresh }),
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        });
      const response = NextResponse.json({ ok: true });
      clear(response);
      return response;
    }
    const declared = Number(request.headers.get('content-length') ?? 0);
    const limit = 11 * 1024 * 1024;
    if (declared > limit)
      return NextResponse.json({ message: 'File is too large' }, { status: 413 });
    let body: ArrayBuffer | undefined;
    if (method !== 'GET') {
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = request.body?.getReader();
      if (reader)
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > limit) {
            await reader.cancel();
            return NextResponse.json({ message: 'File is too large' }, { status: 413 });
          }
          chunks.push(item.value);
        }
      if (size) {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        body = bytes.buffer;
      }
    }
    const upstream = () =>
      fetch(apiUrl() + '/' + route + request.nextUrl.search, {
        method,
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(request.headers.get('content-type')
            ? { 'Content-Type': request.headers.get('content-type')! }
            : {}),
        },
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    let result = await upstream();
    if (result.status === 401 && route !== 'auth/login' && refresh) {
      pair = (await rotate(refresh)) ?? undefined;
      if (pair) {
        token = pair.accessToken;
        result = await upstream();
      }
    }
    if (route !== 'auth/login' && !sessions.get(sessionId)?.valid)
      return NextResponse.json({ message: 'Session ended' }, { status: 401 });
    if (result.ok && ['auth/login', 'auth/switch-school'].includes(route)) {
      const data = (await result.json()) as TokenPair & { user?: unknown };
      if (session) session.valid = false;
      for (const [id, entry] of sessions) if (entry.expires < Date.now()) sessions.delete(id);
      const nextSession = randomUUID();
      sessions.set(nextSession, { valid: true, expires: Date.now() + 30 * 86400000 });
      const response = NextResponse.json(data.user ? { user: data.user } : { ok: true }, {
        status: result.status,
      });
      setTokens(response, data, nextSession);
      return response;
    }
    const headers = new Headers({ 'Cache-Control': 'private, no-store' });
    for (const name of ['content-type', 'content-disposition', 'x-content-type-options']) {
      const value = result.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = new NextResponse(result.status === 204 ? null : result.body, {
      status: result.status,
      headers,
    });
    if (pair) setTokens(response, pair, sessionId);
    if (result.status === 401 && route !== 'auth/login') clear(response);
    return response;
  } catch {
    return NextResponse.json(
      { code: 'SERVICE_UNAVAILABLE', message: 'Service is unavailable. Please retry.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
