const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node').register({
  transpileOnly: true, skipProject: true,
  compilerOptions: { module: 'Node16', moduleResolution: 'Node16' },
});
process.env.NODE_ENV = 'production';
process.env.WASL_WEB_SESSION_MODE = 'single-instance';
process.env.WASL_WEB_ORIGIN = 'https://wasl.test';
process.env.WASL_API_URL = 'https://fictional-api.test/api/v1';

const { NextRequest } = require('next/server');
const { createWaslProxy } = require('../src/app/api/wasl/proxy');
const { accessCookie, refreshCookie, sessionSelector, createSessionState } = require('../src/app/api/wasl/session-state');
const origin = process.env.WASL_WEB_ORIGIN;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  let issue = 0;
  const upstream = { revoke: async () => true, refresh: async () => undefined, upload: async () => new Response(null, { status: 201 }) };
  const calls = { logout: [], refresh: [] };
  const revoked = new Set();
  const families = new Map();
  const issuePair = (family = ++issue) => {
    const serial = ++issue;
    const pair = { accessToken: 'fictional-access-' + serial, refreshToken: 'fictional-refresh-' + serial };
    families.set(pair.accessToken, family);
    families.set(pair.refreshToken, family);
    return pair;
  };
  async function mock(url, init) {
    const route = new URL(url).pathname.split('/api/v1/')[1];
    const token = new Headers(init.headers).get('authorization')?.slice(7);
    const family = families.get(token);
    if (route === 'auth/login') return Response.json(issuePair());
    if (route === 'auth/logout') {
      const credential = JSON.parse(init.body).refreshToken;
      calls.logout.push(credential);
      if (!await upstream.revoke(credential)) return new Response(null, { status: 502 });
      revoked.add(families.get(credential));
      return new Response(null, { status: 204 });
    }
    if (route === 'auth/refresh') {
      const credential = JSON.parse(init.body).refreshToken;
      calls.refresh.push(credential);
      await upstream.refresh();
      const owner = families.get(credential);
      return owner && !revoked.has(owner) ? Response.json(issuePair(owner)) : new Response(null, { status: 401 });
    }
    if (!family || revoked.has(family)) return new Response(null, { status: 401 });
    if (route === 'auth/switch-school') return Response.json(issuePair(family));
    if (route === 'files') return upstream.upload();
    if (route === 'me') return Response.json({ family });
    throw new Error('Unexpected fictional upstream route');
  }
  const instance = () => createWaslProxy(createSessionState(), mock);
  return { handler: instance(), instance, upstream, calls, revoked, families };
}

function send(handler, jar, path, method = 'GET', requestOrigin = origin) {
  const request = new NextRequest(origin + '/api/wasl/' + path, {
    method,
    headers: { origin: requestOrigin, cookie: [...jar].map(([name, value]) => name + '=' + value).join('; ') },
  });
  return handler(request, { params: Promise.resolve({ path: path.split('/') }) });
}
function apply(jar, response) {
  for (const cookie of response.cookies.getAll()) {
    if (cookie.maxAge === 0) jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}
async function login(handler, jar) {
  const response = await send(handler, jar, 'auth/login', 'POST');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  apply(jar, response);
  return { response, slot: jar.get(sessionSelector) };
}

test('bounds authenticated upload forwarding and releases capacity after upstream failure', async () => {
  const h = harness();
  const jar = new Map();
  await login(h.handler, jar);
  const started = deferred(), complete = deferred();
  let inFlight = 0;
  h.upstream.upload = async () => {
    if (++inFlight === 4) started.resolve();
    await complete.promise;
    throw new Error('Fictional upstream interruption');
  };
  const pending = Array.from({ length: 4 }, () => send(h.handler, jar, 'files', 'POST'));
  try {
    await started.promise;
    const busy = await send(h.handler, jar, 'files', 'POST');
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get('retry-after'), '1');
    assert.equal(inFlight, 4);
    assert.equal((await send(h.handler, jar, 'me')).status, 200);
  } finally {
    complete.resolve();
    assert.deepEqual((await Promise.all(pending)).map(response => response.status), [503, 503, 503, 503]);
  }
  h.upstream.upload = async () => new Response(null, { status: 503, headers: { 'Retry-After': '2' } });
  const busyUpstream = await send(h.handler, jar, 'files', 'POST');
  assert.equal(busyUpstream.headers.get('retry-after'), '2');
  h.upstream.upload = async () => new Response(null, { status: 201 });
  assert.equal((await send(h.handler, jar, 'files', 'POST')).status, 201);
});
function assertCleared(response, slot) {
  for (const name of [accessCookie(slot), refreshCookie(slot)]) {
    const cookie = response.cookies.get(name);
    assert.ok(cookie?.maxAge === 0 && cookie.httpOnly && cookie.secure && cookie.sameSite === 'lax');
  }
  assert.equal(response.cookies.get(sessionSelector), undefined);
  assert.match(response.headers.get('cache-control'), /no-store/);
}

test('secure cookies, CSRF and method checks, successful family logout and repeat logout', async () => {
  const h = harness();
  const jar = new Map();
  const { response, slot } = await login(h.handler, jar);
  for (const name of [sessionSelector, accessCookie(slot), refreshCookie(slot)]) {
    const cookie = response.cookies.get(name);
    assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'lax' && cookie.path === '/');
  }
  assert.equal((await send(h.handler, jar, 'auth/logout', 'POST', 'https://outside.test')).status, 403);
  assert.equal((await send(h.handler, jar, 'auth/logout')).status, 405);
  assert.equal(h.calls.logout.length, 0);
  const initialFamily = h.families.get(jar.get(refreshCookie(slot)));
  const switched = await send(h.handler, jar, 'auth/switch-school', 'POST');
  assert.equal(switched.status, 200);
  apply(jar, switched);
  const switchedSlot = jar.get(sessionSelector);
  assert.notEqual(switchedSlot, slot);
  assert.equal(jar.has(refreshCookie(slot)), false);
  const signedOut = await send(h.handler, jar, 'auth/logout', 'POST');
  assert.equal(signedOut.status, 200);
  assert.deepEqual(await signedOut.json(), { ok: true });
  assertCleared(signedOut, switchedSlot);
  apply(jar, signedOut);
  assert.equal(h.revoked.has(initialFamily), true);
  assert.equal((await send(h.handler, jar, 'me')).status, 401);
  const repeated = await send(h.handler, jar, 'auth/logout', 'POST');
  assert.deepEqual(await repeated.json(), { ok: true, revocation: 'not-requested' });
  assert.equal(h.calls.logout.length, 1);
  await login(h.handler, jar);
  assert.equal((await send(h.handler, jar, 'me')).status, 200);
});

for (const mode of ['non-success', 'network exception']) {
  test('upstream ' + mode + ' clears cookies, closes the local slot, and allows retry', async () => {
    const h = harness();
    const jar = new Map();
    const { slot } = await login(h.handler, jar);
    const original = new Map(jar);
    h.upstream.revoke = async () => {
      if (mode === 'network exception') throw new Error('Fictional network failure');
      return false;
    };
    const failure = await send(h.handler, jar, 'auth/logout', 'POST');
    assert.equal(failure.status, 503);
    assert.equal((await failure.json()).code, 'REVOCATION_UNCONFIRMED');
    assertCleared(failure, slot);
    apply(jar, failure);
    assert.equal((await send(h.handler, original, 'me')).status, 401);
    assert.equal(jar.has(refreshCookie(slot)), false);
    h.upstream.revoke = async () => true;
    const retry = await send(h.handler, jar, 'auth/logout', 'POST');
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { ok: true });
    assert.equal(h.calls.logout.length, 2);
    assert.equal(h.calls.logout[0] === h.calls.logout[1], true);
  });
}

test('a late logout response cannot clear a newer login, and retries share the revocation', async () => {
  const h = harness();
  const jar = new Map();
  const first = await login(h.handler, jar);
  const entered = deferred();
  const release = deferred();
  h.upstream.revoke = async () => { entered.resolve(); await release.promise; return true; };
  const signedOut = send(h.handler, jar, 'auth/logout', 'POST');
  await entered.promise;
  const retry = send(h.handler, jar, 'auth/logout', 'POST');
  assert.equal((await send(h.handler, jar, 'me')).status, 401);
  const second = await login(h.handler, jar);
  release.resolve();
  for (const response of await Promise.all([signedOut, retry])) {
    assertCleared(response, first.slot);
    apply(jar, response);
  }
  assert.equal(jar.get(sessionSelector), second.slot);
  assert.equal(h.calls.logout.length, 1);
  assert.equal((await send(h.handler, jar, 'me')).status, 200);
});

test('only one refresh rotates a shared cookie and rotation does not rewrite the selector', async () => {
  const h = harness();
  const jar = new Map();
  const { slot } = await login(h.handler, jar);
  jar.delete(accessCookie(slot));
  const [first, second] = await Promise.all([send(h.handler, jar, 'me'), send(h.handler, jar, 'me')]);
  for (const response of [first, second]) {
    assert.equal(response.status, 200);
    assert.ok(response.cookies.get(accessCookie(slot)));
    assert.equal(response.cookies.get(sessionSelector), undefined);
    apply(jar, response);
  }
  assert.equal(h.calls.refresh.length, 1);
  assert.equal((await send(h.handler, jar, 'me')).status, 200);
});

test('fresh process state fails closed, and a second isolated instance does not share the session', async () => {
  const h = harness();
  const jar = new Map();
  const { slot } = await login(h.handler, jar);
  const secondInstance = h.instance();
  const restartedInstance = h.instance();
  assert.equal((await send(secondInstance, jar, 'me')).status, 401);
  assert.equal((await send(restartedInstance, jar, 'me')).status, 401);
  assert.equal(h.calls.refresh.length, 0);
  assert.equal((await send(h.handler, jar, 'me')).status, 200);
  const independent = new Map();
  const other = await login(secondInstance, independent);
  assert.equal((await send(h.handler, independent, 'me')).status, 401);
  const unrelated = new Map(jar);
  unrelated.set(accessCookie(slot), independent.get(accessCookie(other.slot)));
  unrelated.set(refreshCookie(slot), independent.get(refreshCookie(other.slot)));
  assert.equal((await send(h.handler, unrelated, 'me')).status, 401);
  const signedOut = await send(restartedInstance, jar, 'auth/logout', 'POST');
  assert.equal(signedOut.status, 200);
  assertCleared(signedOut, slot);
  assert.equal((await send(h.handler, jar, 'me')).status, 401);
  assert.equal((await send(secondInstance, independent, 'me')).status, 200);
});
