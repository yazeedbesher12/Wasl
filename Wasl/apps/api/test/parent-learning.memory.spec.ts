import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  bearer,
  createMemoryApp,
  developmentId as id,
  login,
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
});
