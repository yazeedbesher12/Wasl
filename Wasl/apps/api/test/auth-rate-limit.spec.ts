import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthRateLimit } from '../src/auth/auth-rate-limit';
import { validateEnvironment } from '../src/configuration';
import { bearer, createMemoryApp, developmentId, TEST_PASSWORD } from './memory-harness';

describe('HTTP authentication rate limits', () => {
  let app: INestApplication;
  const post = (route: string) => request(app.getHttpServer()).post('/api/v1/auth/' + route);

  beforeAll(async () => { app = await createMemoryApp(); });
  afterAll(async () => { await app?.close(); });

  it('throttles known and unknown login identifiers uniformly while other accounts can log in', async () => {
    const known = 'parent@wasl.test';
    const unknown = 'fictional-missing@wasl.test';
    const attempt = (email: string, ip: number) => post('login')
      .set('X-Forwarded-For', `192.0.2.${ip}`)
      .set('Forwarded', `for=198.51.100.${ip}`)
      .set('X-Real-IP', `203.0.113.${ip}`)
      .send({ email, password: 'incorrect-fictional-password' });

    const ordinaryFailure = { code: 'UNAUTHORIZED', message: 'Wrong email or password' };
    for (let i = 1; i <= 8; i++) {
      const [existing, missing] = await Promise.all([attempt(known, i), attempt(unknown, i)]);
      for (const result of [existing, missing]) {
        expect(result.status).toBe(401);
        expect(result.body).toEqual(ordinaryFailure);
      }
    }
    const limited = { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Try again later.' };
    for (const email of [known.toUpperCase(), unknown]) {
      const result = await attempt(email, 9);
      expect(result.status).toBe(429);
      expect(result.body).toEqual(limited);
      expect(Number(result.headers['retry-after'])).toBeGreaterThan(0);
      expect(result.headers['cache-control']).toBe('no-store');
    }

    const login = await post('login').send({ email: 'teacher1@wasl.test', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const switched = await post('switch-school').set('Authorization', bearer(login.body.accessToken))
      .send({ role: 'TEACHER', schoolId: developmentId(1) });
    expect(switched.status).toBe(200);
    const rotated = await post('refresh').send({ refreshToken: switched.body.refreshToken });
    expect(rotated.status).toBe(200);
    expect((await post('refresh').send({ refreshToken: switched.body.refreshToken })).status).toBe(401);
    expect((await post('logout').send({ refreshToken: login.body.refreshToken })).status).toBe(204);
    expect((await post('refresh').send({ refreshToken: rotated.body.refreshToken })).status).toBe(401);
  });

  it('resets expired windows and isolates operations and IP sources', () => {
    const limiter = new AuthRateLimit();
    for (let i = 0; i < 8; i++) expect(limiter.consume('login', '192.0.2.1', 'child', 0)).toBe(0);
    expect(limiter.consume('login', '192.0.2.1', 'child', 1000)).toBe(59);
    expect(limiter.consume('login', '::ffff:192.0.2.1', 'child', 1000)).toBe(59);
    expect(limiter.consume('login', '192.0.2.2', 'child', 1000)).toBe(0);
    expect(limiter.consume('login', '192.0.2.1', 'child', 60_000)).toBe(0);
    for (let i = 0; i < 120; i++) expect(limiter.consume('refresh', '192.0.2.1', undefined, 0)).toBe(0);
    expect(limiter.consume('refresh', '192.0.2.1', undefined, 1000)).toBe(59);
    expect(limiter.consume('logout', '192.0.2.1', undefined, 1000)).toBe(0);
    for (let i = 0; i < 24; i++) expect(limiter.consume('switch-school', '192.0.2.1', 'actor', 0)).toBe(0);
    expect(limiter.consume('switch-school', '192.0.2.2', 'actor', 1000)).toBe(59);
    expect(limiter.consume('switch-school', '192.0.2.1', 'unrelated-actor', 1000)).toBe(0);
  });

  it('groups IPv6 privacy addresses and requires explicit literal trusted proxy addresses', () => {
    const limiter = new AuthRateLimit();
    for (let i = 1; i <= 8; i++) expect(limiter.consume('login', `2001:db8::${i}`, 'child', 0)).toBe(0);
    expect(limiter.consume('login', '2001:0db8:0000:0000::ffff', 'child', 1000)).toBe(59);
    expect(limiter.consume('login', '2001:db8:0:1::1', 'child', 1000)).toBe(0);
    expect(validateEnvironment(process.env).WASL_TRUSTED_PROXY_IPS).toEqual([]);
    expect(validateEnvironment({ ...process.env, WASL_TRUSTED_PROXY_IPS: '192.0.2.1, 2001:db8::1' }).WASL_TRUSTED_PROXY_IPS)
      .toEqual(['192.0.2.1', '2001:db8::1']);
    expect(() => validateEnvironment({ ...process.env, WASL_TRUSTED_PROXY_IPS: '0.0.0.0/0' })).toThrow('literal IP addresses');
  });
});
