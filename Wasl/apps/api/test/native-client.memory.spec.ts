import type { INestApplication } from '@nestjs/common';
import type { MeDto, TokenPair } from '@wasl/shared';
import { NativeApi, type TokenVault } from '../../mobile/src/connected/transport';
import { createMemoryApp, developmentId as id, TEST_PASSWORD } from './memory-harness';

describe('Native client against the real memory API', () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    app = await createMemoryApp();
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/api/v1';
  });
  afterAll(async () => app.close());
  function client() {
    let saved: TokenPair | null = null;
    let expired = 0;
    const vault: TokenVault = {
      read: async () => saved,
      write: async (pair) => {
        saved = pair ? { accessToken: pair.accessToken, refreshToken: pair.refreshToken } : null;
      },
    };
    return {
      api: new NativeApi(base, vault, () => {
        expired++;
      }),
      vault,
      saved: () => saved,
      expired: () => expired,
    };
  }
  it('authenticates all roles, restores sessions and enforces school boundaries', async () => {
    for (const [email, role] of [
      ['platform@wasl.test', 'PLATFORM_ADMIN'],
      ['admin1@wasl.test', 'SCHOOL_ADMIN'],
      ['teacher1@wasl.test', 'TEACHER'],
      ['student1@wasl.test', 'STUDENT'],
      ['parent@wasl.test', 'PARENT'],
    ]) {
      const c = client();
      expect((await c.api.login(email, TEST_PASSWORD)).activeRole).toBe(role);
      const restored = new NativeApi(base, c.vault, () => undefined);
      expect(await restored.restore()).toBe(true);
      expect((await restored.call<MeDto>('me')).email).toBe(email);
      await c.api.logout();
      expect(c.saved()).toBeNull();
    }
    const c = client();
    await c.api.login('teacher1@wasl.test', TEST_PASSWORD);
    await expect(c.api.call(`lessons/${id(508)}`)).rejects.toMatchObject({ status: 404 });
    const family = client();
    await family.api.login('parent@wasl.test', TEST_PASSWORD);
    const me = await family.api.switchContext(id(2), 'PARENT');
    expect(me.activeSchoolId).toBe(id(2));
    expect(
      (
        await family.api.call<{ lessons: { schoolId: string }[] }>(
          `parent/children/${id(122)}/learning?schoolId=${id(2)}`,
        )
      ).lessons.every((l) => l.schoolId === id(2)),
    ).toBe(true);
  });
  it('rotates once for parallel expired requests and persists the replacement pair', async () => {
    const c = client();
    await c.api.login('student1@wasl.test', TEST_PASSWORD);
    const previous = c.saved()!;
    await c.vault.write({ ...previous, accessToken: 'expired' });
    const restored = new NativeApi(base, c.vault, () => undefined);
    await restored.restore();
    const results = await Promise.all([
      restored.call<MeDto>('me'),
      restored.call<MeDto>('me'),
      restored.call<MeDto>('me'),
    ]);
    expect(results.every((r) => r.email === 'student1@wasl.test')).toBe(true);
    expect(c.saved()?.refreshToken).not.toBe(previous.refreshToken);
    const replay = await fetch(base + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: previous.refreshToken }),
    });
    expect(replay.status).toBe(401);
    await restored.logout();
    expect(c.saved()).toBeNull();
  });
  it('clears revoked refresh sessions without falling back to a demo account', async () => {
    const c = client();
    await c.api.login('student1@wasl.test', TEST_PASSWORD);
    const previous = c.saved()!;
    await c.api.logout();
    await c.vault.write({ ...previous, accessToken: 'expired' });
    await c.api.restore();
    await expect(c.api.call('me')).rejects.toMatchObject({ status: 401 });
    expect(c.saved()).toBeNull();
    expect(c.expired()).toBe(1);
  });
  it('performs actual multipart upload and authorized binary download', async () => {
    const c = client();
    await c.api.login('teacher1@wasl.test', TEST_PASSWORD);
    const bytes = '%PDF-1.7\nNative API document\n%%EOF\n';
    const data = new FormData();
    data.append('purpose', 'LESSON_RESOURCE');
    data.append('lessonId', id(409));
    data.append('file', new Blob([bytes], { type: 'application/pdf' }), 'native.pdf');
    const f = (await (await c.api.response('files', { method: 'POST', body: data })).json()) as {
      id: string;
      storageKey: string;
    };
    expect(
      (
        await c.api.call<{ id: string }>(
          'files/resolve?storageKey=' + encodeURIComponent(f.storageKey),
        )
      ).id,
    ).toBe(f.id);
    expect(await (await c.api.response(`files/${f.id}/content`)).text()).toBe(bytes);
    const student = client();
    await student.api.login('student1@wasl.test', TEST_PASSWORD);
    await expect(student.api.response(`files/${f.id}/content`)).rejects.toMatchObject({
      status: 404,
    });
  });
});
