import type { TokenPair } from '@wasl/shared';
import { NativeApi } from '../../mobile/src/connected/transport';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const pair = (name: string): TokenPair => ({ accessToken: name + '-access', refreshToken: name + '-refresh' });
const A = pair('fictional-a');
const B = pair('fictional-b');
const rotated = pair('fictional-rotated');
const changed = { message: 'Session changed' };

function harness() {
  let stored: TokenPair | null = A;
  type Request = {
    path: string;
    token: string | null;
    body: Record<string, unknown>;
    respond: (status: number, body?: unknown) => void;
  };
  const sent: Request[] = [];
  let waiting = deferred<Request>();
  let cursor = 0;
  jest.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const response = deferred<Response>();
    const request: Request = {
      path: new URL(String(url)).pathname.slice(1),
      token: new Headers(init?.headers).get('Authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      respond: (status, body) => response.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
    };
    sent.push(request);
    waiting.resolve(request);
    waiting = deferred<Request>();
    return response.promise;
  });
  const write = jest.fn(async (value: TokenPair | null) => { stored = value; });
  const expired = jest.fn();
  const api = new NativeApi('https://fictional.test', { read: async () => stored, write }, expired);
  async function take(path: string) {
    const request = sent[cursor] ?? await waiting.promise;
    cursor++;
    expect(request.path).toBe(path);
    return request;
  }
  async function login(value = B) {
    const action = api.login('fictional@example.test', 'fictional-password');
    (await take('auth/login')).respond(200, value);
    const me = await take('me');
    expect(me.token).toBe('Bearer ' + value.accessToken);
    me.respond(200, { id: value.accessToken });
    return action;
  }
  return { api, take, login, write, expired, saved: () => stored, sent };
}

afterEach(() => jest.restoreAllMocks());

describe('mobile session ownership', () => {
  it.each(['login', 'logout', 'switch'] as const)('discards a late 401 after %s without sending a refresh', async action => {
    const h = harness();
    await h.api.restore();
    const old = expect(h.api.call('old')).rejects.toMatchObject(changed);
    const request = await h.take('old');
    expect(request.token).toBe('Bearer ' + A.accessToken);
    if (action === 'login') await h.login();
    if (action === 'logout') {
      const logout = h.api.logout();
      const revoke = await h.take('auth/logout');
      expect(revoke.body.refreshToken).toBe(A.refreshToken);
      revoke.respond(204);
      await logout;
    }
    if (action === 'switch') {
      const switching = h.api.switchContext('fictional-school', 'TEACHER');
      (await h.take('auth/switch-school')).respond(200, B);
      (await h.take('me')).respond(200, { activeSchoolId: 'fictional-school' });
      await switching;
    }
    request.respond(401);
    await old;
    expect(h.sent.filter(r => r.path === 'auth/refresh')).toHaveLength(0);
    expect(h.saved()).toEqual(action === 'logout' ? null : B);
    expect(h.expired).not.toHaveBeenCalled();
  });

  it.each([false, true])('rotates once for the same pair when the second 401 is delayed: %s', async delayed => {
    const h = harness();
    await h.api.restore();
    const first = h.api.call('one');
    const second = h.api.call('two');
    const one = await h.take('one');
    const two = await h.take('two');
    one.respond(401);
    if (!delayed) two.respond(401);
    const refresh = await h.take('auth/refresh');
    expect(refresh.body.refreshToken).toBe(A.refreshToken);
    refresh.respond(200, rotated);
    const retried = await h.take('one');
    expect(retried.token).toBe('Bearer ' + rotated.accessToken);
    retried.respond(200, { ok: true });
    await first;
    if (delayed) two.respond(401);
    const retry = await h.take('two');
    expect(retry.token).toBe('Bearer ' + rotated.accessToken);
    retry.respond(200, { ok: true });
    await second;
    expect(h.saved()).toEqual(rotated);
    expect(h.sent.filter(r => r.path === 'auth/refresh')).toHaveLength(1);
  });

  it('discards a refresh completed after login without retrying with the newer session', async () => {
    const h = harness();
    await h.api.restore();
    const old = expect(h.api.call('old')).rejects.toMatchObject(changed);
    (await h.take('old')).respond(401);
    const refresh = await h.take('auth/refresh');
    expect(refresh.body.refreshToken).toBe(A.refreshToken);
    await h.login();
    refresh.respond(200, rotated);
    const cleanup = await h.take('auth/logout');
    expect(cleanup.token).toBeNull();
    expect(cleanup.body.refreshToken).toBe(rotated.refreshToken);
    cleanup.respond(204);
    await old;
    expect(h.saved()).toEqual(B);
    expect(h.sent.filter(r => r.path === 'old')).toHaveLength(1);
  });

  it('leaves newer credentials intact when a logout response arrives late', async () => {
    const h = harness();
    await h.api.restore();
    const logout = h.api.logout();
    const revoke = await h.take('auth/logout');
    expect(h.saved()).toBeNull();
    await h.login();
    revoke.respond(204);
    await logout;
    expect(revoke.body.refreshToken).toBe(A.refreshToken);
    expect(h.saved()).toEqual(B);
  });

  it('discards a refresh completed after a school switch without revoking the shared family', async () => {
    const h = harness();
    await h.api.restore();
    const old = expect(h.api.call('old')).rejects.toMatchObject(changed);
    (await h.take('old')).respond(401);
    const refresh = await h.take('auth/refresh');
    const switching = h.api.switchContext('fictional-school', 'TEACHER');
    (await h.take('auth/switch-school')).respond(200, B);
    (await h.take('me')).respond(200, { activeSchoolId: 'fictional-school' });
    await switching;
    refresh.respond(200, rotated);
    await old;
    expect(h.saved()).toEqual(B);
    expect(h.sent.filter(r => r.path === 'auth/logout')).toHaveLength(0);
  });

  it('rejects a switch response that arrives after a different login', async () => {
    const h = harness();
    await h.api.restore();
    const stale = expect(h.api.switchContext('fictional-school', 'TEACHER')).rejects.toMatchObject(changed);
    const switched = await h.take('auth/switch-school');
    await h.login();
    switched.respond(200, rotated);
    await stale;
    expect(h.saved()).toEqual(B);
    expect(h.sent.filter(r => r.path === 'me')).toHaveLength(1);
  });

  it('lets the latest login win even if the earlier response arrives last', async () => {
    const h = harness();
    const stale = expect(h.api.login('first@example.test', 'fictional-password')).rejects.toMatchObject(changed);
    const first = await h.take('auth/login');
    await h.login();
    first.respond(200, A);
    const revoke = await h.take('auth/logout');
    expect(revoke.body.refreshToken).toBe(A.refreshToken);
    revoke.respond(204);
    await stale;
    expect(h.saved()).toEqual(B);
  });

  it('clears a rejected current refresh and notifies once', async () => {
    const h = harness();
    await h.api.restore();
    const denied = expect(h.api.call('private')).rejects.toMatchObject({ status: 401 });
    (await h.take('private')).respond(401);
    (await h.take('auth/refresh')).respond(401);
    await denied;
    expect(h.saved()).toBeNull();
    expect(h.expired).toHaveBeenCalledTimes(1);
  });

  it('invalidates a retry that is already in flight', async () => {
    const h = harness();
    await h.api.restore();
    const stale = expect(h.api.call('private')).rejects.toMatchObject(changed);
    (await h.take('private')).respond(401);
    (await h.take('auth/refresh')).respond(200, rotated);
    const retry = await h.take('private');
    await h.login();
    retry.respond(401);
    await stale;
    expect(h.saved()).toEqual(B);
    expect(h.expired).not.toHaveBeenCalled();
  });

  it('serializes a delayed vault write and skips queued stale mutations', async () => {
    const h = harness();
    await h.api.restore();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const write = h.write.getMockImplementation()!;
    h.write.mockImplementationOnce(async value => {
      entered.resolve();
      await finish.promise;
      await write(value);
    });
    const old = expect(h.api.call('private')).rejects.toMatchObject(changed);
    (await h.take('private')).respond(401);
    (await h.take('auth/refresh')).respond(200, rotated);
    await entered.promise;
    const logout = expect(h.api.logout()).rejects.toMatchObject(changed);
    const login = h.api.login('fictional@example.test', 'fictional-password');
    expect(h.write).toHaveBeenCalledTimes(1);
    finish.resolve();
    const revoke = await h.take('auth/logout');
    expect(revoke.body.refreshToken).toBe(rotated.refreshToken);
    revoke.respond(204);
    (await h.take('auth/login')).respond(200, B);
    (await h.take('me')).respond(200, { id: 'fictional-b' });
    await Promise.all([old, logout, login]);
    expect(h.sent.filter(r => r.path === 'private')).toHaveLength(1);
    expect(h.write.mock.calls.map(([value]) => value)).toEqual([rotated, null, B]);
    expect(h.saved()).toEqual(B);
  });
});
