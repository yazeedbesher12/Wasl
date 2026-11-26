import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import type { TokenPair } from '@wasl/shared';

import { accessCookie, refreshCookie, revokeSession, sessionSelector, type SessionState } from './session-state';

const slotPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const legacyCookies = ['wasl.access', 'wasl.refresh', 'wasl.session'];
const noStore = { 'Cache-Control': 'private, no-store' };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const apiUrl = () =>
  (process.env.WASL_API_URL ?? 'http://127.0.0.1:4000/api/v1').replace(/\/$/, '');
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
function clear(response: NextResponse, names: string[]) {
  for (const name of names) response.cookies.set(name, '', { ...cookieOptions, maxAge: 0 });
}
function clearSlot(response: NextResponse, slot: string) {
  if (slot) clear(response, [accessCookie(slot), refreshCookie(slot)]);
  return response;
}
function setTokens(response: NextResponse, pair: TokenPair, slot: string) {
  response.cookies.set(accessCookie(slot), pair.accessToken, { ...cookieOptions, maxAge: 86400 });
  response.cookies.set(refreshCookie(slot), pair.refreshToken, { ...cookieOptions, maxAge: 30 * 86400 });
}
export function createWaslProxy(state: SessionState, fetchUpstream: typeof fetch = fetch) {
  const { sessions, refreshing } = state;
  const active = (slot: string) => (sessions.get(slot)?.expires ?? 0) > Date.now();
  const refreshKey = (slot: string, token: string) => slot + ':' + hash(token);

  async function rotate(slot: string, token: string): Promise<TokenPair | null> {
    const key = refreshKey(slot, token);
    let operation = refreshing.get(key);
    if (!operation) {
      operation = (async () => {
        const r = await fetchUpstream(apiUrl() + '/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
          cache: 'no-store',
          redirect: 'error',
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
    const route = path.join('/');
    const method = request.method;
    if (['auth/login', 'auth/logout', 'auth/switch-school'].includes(route) && method !== 'POST')
      return NextResponse.json({ message: 'Method not allowed' }, { status: 405, headers: { ...noStore, Allow: 'POST' } });
    if (route !== 'auth/logout' && process.env.NODE_ENV === 'production'
      && process.env.WASL_WEB_SESSION_MODE !== 'single-instance')
      return NextResponse.json({ message: 'Session service unavailable' }, { status: 503, headers: noStore });
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
    const selector = request.cookies.get(sessionSelector)?.value ?? '';
    const slot = slotPattern.test(selector) ? selector : '';
    const session = sessions.get(slot);
    let pair: TokenPair | undefined;
    let token = slot ? request.cookies.get(accessCookie(slot))?.value : undefined;
    let refresh = slot ? request.cookies.get(refreshCookie(slot))?.value : undefined;
    if (route === 'auth/logout') {
      const legacySlot = request.cookies.get('wasl.session')?.value ?? '';
      const legacy = !slot && slotPattern.test(legacySlot);
      const logoutSlot = slot || (legacy ? legacySlot : randomUUID());
      const hadSession = active(slot) || !!token || (legacy && !!request.cookies.get('wasl.access')?.value);
      const result = await revokeSession(state, logoutSlot, refresh ?? (legacy ? request.cookies.get('wasl.refresh')?.value : undefined),
        async refreshToken => (await fetchUpstream(apiUrl() + '/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
        })).ok);
      const response = (result === false || (result === null && hadSession))
        ? NextResponse.json({ code: 'REVOCATION_UNCONFIRMED', message: 'Local sign-out completed. Server sign-out could not be confirmed.' }, { status: 503, headers: noStore })
        : NextResponse.json(result === null ? { ok: true, revocation: 'not-requested' } : { ok: true }, { headers: noStore });
      clearSlot(response, slot);
      clear(response, legacyCookies);
      return response;
    }
    if (session) {
      if (token && hash(token) !== session.accessHash) token = undefined;
      if (refresh && hash(refresh) !== session.refreshHash && !refreshing.has(refreshKey(slot, refresh)))
        refresh = undefined;
    }
    if (route !== 'auth/login' && (!active(slot) || (!token && !refresh)))
      return clearSlot(NextResponse.json({ message: 'Sign in required' }, { status: 401, headers: noStore }), slot);
    try {
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
        fetchUpstream(apiUrl() + '/' + route + request.nextUrl.search, {
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
      if (route !== 'auth/login' && !active(slot))
        return NextResponse.json({ message: 'Session ended' }, { status: 401, headers: noStore });
      let result = await upstream();
      if (result.status === 401 && route !== 'auth/login' && refresh && active(slot)) {
        pair = (await rotate(slot, refresh)) ?? undefined;
        const current = sessions.get(slot);
        if (pair && current && active(slot)
          && (current.refreshHash === hash(refresh) || current.refreshHash === hash(pair.refreshToken))) {
          current.accessHash = hash(pair.accessToken);
          current.refreshHash = hash(pair.refreshToken);
          token = pair.accessToken;
          result = await upstream();
        } else pair = undefined;
      }
      if (route !== 'auth/login' && !active(slot))
        return NextResponse.json({ message: 'Session ended' }, { status: 401 });
      if (result.ok && ['auth/login', 'auth/switch-school'].includes(route)) {
        const data = (await result.json()) as TokenPair & { user?: unknown };
        if (route === 'auth/switch-school' && !active(slot))
          return NextResponse.json({ message: 'Session ended' }, { status: 401 });
        sessions.delete(slot);
        for (const [id, entry] of sessions) if (entry.expires <= Date.now()) sessions.delete(id);
        const nextSession = randomUUID();
        const expires = Date.now() + 30 * 86400000;
        sessions.set(nextSession, { expires, accessHash: hash(data.accessToken), refreshHash: hash(data.refreshToken) });
        const response = NextResponse.json(data.user ? { user: data.user } : { ok: true }, {
          status: result.status, headers: noStore,
        });
        clear(response, legacyCookies);
        clearSlot(response, slot);
        // Only a successful login or switch can change the selector. Late
        // responses can expire or replace credentials for their own slot only.
        response.cookies.set(sessionSelector, nextSession, { ...cookieOptions, maxAge: 30 * 86400 });
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
      if (result.status === 401 && route !== 'auth/login') clearSlot(response, slot);
      else if (pair && sessions.get(slot)?.refreshHash === hash(pair.refreshToken)) setTokens(response, pair, slot);
      return response;
    } catch {
      return NextResponse.json(
        { code: 'SERVICE_UNAVAILABLE', message: 'Service is unavailable. Please retry.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }
  return handle;
}
