import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  bearer,
  createMemoryApp,
  developmentId as id,
  login,
  TEST_PASSWORD,
  TEST_PDF,
  uploadTestFile,
} from './memory-harness';
describe('Parent read projections and authorized file resolution', () => {
  let app: INestApplication;
  let parent: string;
  let teacher: string;
  let other: string;
  let admin: string;
  let student: string;
  const get = (path: string, auth: string) =>
    request(app.getHttpServer())
      .get('/api/v1' + path)
      .set('Authorization', auth);
  beforeAll(async () => {
    app = await createMemoryApp();
    parent = bearer((await login(app, 'parent@wasl.test')).accessToken);
    teacher = bearer((await login(app, 'teacher1@wasl.test')).accessToken);
    other = bearer((await login(app, 'teacher2@wasl.test')).accessToken);
    admin = bearer((await login(app, 'admin1@wasl.test')).accessToken);
    student = bearer((await login(app, 'student1@wasl.test')).accessToken);
  });
  afterAll(async () => app.close());
  it('returns only the verified child published content and safe assessment metadata', async () => {
    const r = await get(`/parent/children/${id(112)}/learning`, parent);
    expect(r.status).toBe(200);
    expect(r.body.lessons.map((v: { id: string }) => v.id)).toEqual([id(408)]);
    expect(r.body.resources.map((v: { id: string }) => v.id)).toEqual([id(410)]);
    expect(r.body.assessments[0]).toMatchObject({ id: id(801), status: 'OPEN', questionCount: 1 });
    expect(JSON.stringify(r.body)).not.toContain('isCorrect');
    expect(
      (
        await get(`/parent/children/${id(112)}/assessments/${id(801)}`, parent)
      ).body.questions[0].options.every((o: object) => !('isCorrect' in o)),
    ).toBe(true);
  });
  it('supports the approved second school and rejects wrong school/child/role identifiers', async () => {
    const allowed = await get(`/parent/children/${id(122)}/learning?schoolId=${id(2)}`, parent);
    expect(allowed.status).toBe(200);
    expect(allowed.body.lessons.every((v: { schoolId: string }) => v.schoolId === id(2))).toBe(
      true,
    );
    expect(
      (await get(`/parent/children/${id(112)}/learning?schoolId=${id(2)}`, parent)).status,
    ).toBe(404);
    expect((await get(`/parent/children/${id(111)}/learning`, parent)).status).toBe(404);
    expect((await get(`/parent/children/${id(112)}/learning`, teacher)).status).toBe(403);
    expect((await get(`/parent/children/${id(112)}/assessments/${id(802)}`, parent)).status).toBe(
      404,
    );
  });
  it('rechecks revoked links and withdrawn enrollment on each request', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/parent-links/${id(601)}`)
      .set('Authorization', admin)
      .send({ status: 'REJECTED' });
    expect((await get(`/parent/children/${id(112)}/learning`, parent)).status).toBe(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/parent-links/${id(601)}`)
      .set('Authorization', admin)
      .send({ status: 'VERIFIED' });
    await request(app.getHttpServer())
      .patch(`/api/v1/enrollments/${id(406)}`)
      .set('Authorization', admin)
      .send({ status: 'WITHDRAWN' });
    expect((await get(`/parent/children/${id(112)}/learning`, parent)).body.lessons).toEqual([]);
    expect((await get(`/parent/children/${id(112)}/assessments/${id(801)}`, parent)).status).toBe(
      404,
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/enrollments/${id(406)}`)
      .set('Authorization', admin)
      .send({ status: 'ACTIVE' });
  });
  it('resolves real storage keys only after current file authorization', async () => {
    const f = await uploadTestFile(app, teacher, { purpose: 'LESSON_RESOURCE', lessonId: id(409) });
    const route = '/files/resolve?storageKey=' + encodeURIComponent(f.storageKey);
    expect((await get(route, teacher)).body.id).toBe(f.id);
    expect((await get(route, other)).status).toBe(404);
    expect((await get(route, student)).status).toBe(404);
    expect((await get('/files/resolve?storageKey=../secret', teacher)).status).toBe(404);
    await request(app.getHttpServer())
      .post('/api/v1/resources')
      .set('Authorization', teacher)
      .send({ lessonId: id(409), type: 'FILE', title: 'Worksheet', storageKey: f.storageKey });
    await request(app.getHttpServer())
      .patch(`/api/v1/lessons/${id(409)}`)
      .set('Authorization', teacher)
      .send({ status: 'PUBLISHED' });
    expect((await get(route, student)).body.id).toBe(f.id);
    expect((await get(route, parent)).body.id).toBe(f.id);
  });
  it('resolves and downloads a published lesson file for the selected verified child across schools', async () => {
    const session = await login(app, 'parent@wasl.test');
    expect(session.user.activeSchoolId).toBe(id(1));
    const auth = bearer(session.accessToken);
    const schoolAdmin = bearer((await login(app, 'admin2@wasl.test')).accessToken);
    const change = (method: 'post' | 'patch', path: string, who: string, body: object) =>
      request(app.getHttpServer())[method]('/api/v1' + path).set('Authorization', who).send(body);
    const email = `${randomUUID()}@wasl.test`;
    expect((await change('post', '/users', schoolAdmin, {
      email, fullName: 'Fictional unrelated parent', password: TEST_PASSWORD, role: 'PARENT',
    })).status).toBe(201);
    const unrelatedParent = bearer((await login(app, email)).accessToken);

    const context = `studentId=${id(122)}&schoolId=${id(2)}`;
    const childBundle = `/parent/children/${id(122)}/learning?schoolId=${id(2)}`;
    const lesson = await change('post', '/lessons', other, { unitId: id(507), title: 'Fictional child file lesson' });
    expect(lesson.status).toBe(201);
    const file = await uploadTestFile(app, other, { purpose: 'LESSON_RESOURCE', lessonId: lesson.body.id });
    const resourceInput = { lessonId: lesson.body.id, type: 'FILE', title: 'Fictional worksheet' };
    const foreign = await uploadTestFile(app, teacher, {
      purpose: 'LESSON_RESOURCE',
      lessonId: (await change('post', '/lessons', teacher, { unitId: id(407), title: 'Fictional home lesson' })).body.id,
    });
    expect((await change('post', '/resources', other, { ...resourceInput, storageKey: foreign.storageKey })).status).toBe(400);
    expect((await change('post', '/resources', other, { ...resourceInput, storageKey: file.storageKey })).status).toBe(201);
    const resolve = (key: string, query = context, who = auth) =>
      get(`/files/resolve?storageKey=${encodeURIComponent(key)}&${query}`, who);
    const metadata = `/files/${file.id}?${context}`;
    const content = `/files/${file.id}/content?${context}`;
    const denied = async (response: PromiseLike<{ status: number; body: { message?: string } }>) => {
      const result = await response;
      expect(result.status).toBe(404);
      expect(result.body.message).toBe('File not found');
    };
    await denied(resolve(file.storageKey));
    expect((await change('patch', `/lessons/${lesson.body.id}`, other, { status: 'PUBLISHED' })).status).toBe(200);
    const bundle = await get(childBundle, auth);
    expect(bundle.status).toBe(200);
    expect(bundle.body.resources).toEqual(expect.arrayContaining([expect.objectContaining({ storageKey: file.storageKey })]));
    const legacy = '/files/resolve?storageKey=' + encodeURIComponent(file.storageKey);
    expect((await get(legacy, auth)).status).toBe(404);
    expect((await resolve(file.storageKey)).body).toEqual(file);
    expect((await get(metadata, auth)).body).toEqual(file);
    expect((await get(content, auth)).body).toEqual(TEST_PDF);
    const separateSession = await login(app, 'parent@wasl.test');
    const switched = await change('post', '/auth/switch-school', bearer(separateSession.accessToken), {
      schoolId: id(2), role: 'PARENT',
    });
    expect(switched.status).toBe(200);
    expect((await get(legacy, bearer(switched.body.accessToken))).body).toEqual(file);
    await denied(resolve(file.storageKey, context, unrelatedParent));
    await denied(resolve(file.storageKey, `studentId=${id(121)}&schoolId=${id(2)}`));
    await denied(resolve(file.storageKey, `studentId=${id(112)}&schoolId=${id(1)}`));
    await denied(resolve(file.storageKey, `studentId=${id(122)}&schoolId=${id(1)}`));
    await denied(resolve(foreign.storageKey));
    expect((await resolve(file.storageKey, `studentId=${id(122)}`)).status).toBe(400);
    expect((await resolve(file.storageKey, context, other)).status).toBe(403);

    expect((await change('patch', `/enrollments/${id(506)}`, schoolAdmin, { status: 'WITHDRAWN' })).status).toBe(200);
    await denied(resolve(file.storageKey));
    await denied(get(content, auth));
    expect((await change('patch', `/enrollments/${id(506)}`, schoolAdmin, { status: 'ACTIVE' })).status).toBe(200);
    expect((await get(metadata, auth)).status).toBe(200);
    expect((await change('patch', `/parent-links/${id(602)}`, schoolAdmin, { status: 'REJECTED' })).status).toBe(200);
    await denied(resolve(file.storageKey));
    await denied(get(content, auth));
  });
});
