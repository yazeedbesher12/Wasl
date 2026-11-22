import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bearer, createMemoryApp, developmentId, login } from './memory-harness';

describe('Backend Phase 2 Units and Lessons with isolated memory storage', () => {
  let app: INestApplication;

  beforeEach(async () => { app = await createMemoryApp(); });
  afterEach(async () => { if (app) await app.close(); });

  it('requires JWTs and rejects roles outside educational content access', async () => {
    const missing = await request(app.getHttpServer()).get('/api/v1/units');
    const parent = await login(app, 'parent@wasl.test');
    const parentUnits = await request(app.getHttpServer()).get('/api/v1/units').set('Authorization', bearer(parent.accessToken));
    const parentLessons = await request(app.getHttpServer()).get('/api/v1/lessons').set('Authorization', bearer(parent.accessToken));
    expect(missing.status).toBe(401);
    expect(parentUnits.status).toBe(403);
    expect(parentLessons.status).toBe(403);
  });

  it('allows an assigned teacher to create, list, read, and update a unit consistently', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const created = await request(app.getHttpServer()).post('/api/v1/units').set('Authorization', auth)
      .send({ sectionSubjectId: developmentId(405), title: ' Algebra ', order: 3 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ schoolId: developmentId(1), sectionSubjectId: developmentId(405), title: 'Algebra', order: 3 });

    const updated = await request(app.getHttpServer()).patch(`/api/v1/units/${created.body.id}`).set('Authorization', auth)
      .send({ title: 'Algebra II', order: 4 });
    const detail = await request(app.getHttpServer()).get(`/api/v1/units/${created.body.id}`).set('Authorization', auth);
    const list = await request(app.getHttpServer()).get(`/api/v1/units?sectionSubjectId=${developmentId(405)}&limit=100`).set('Authorization', auth);
    expect(updated.status).toBe(200);
    expect(detail.body).toMatchObject({ title: 'Algebra II', order: 4 });
    expect(list.body.items).toContainEqual(detail.body);
  });

  it('validates unit input and hides missing, unassigned, and cross-school references', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const invalid = await request(app.getHttpServer()).post('/api/v1/units').set('Authorization', auth)
      .send({ sectionSubjectId: 'not-a-uuid', title: '', order: -1, schoolId: developmentId(2) });
    const missing = await request(app.getHttpServer()).post('/api/v1/units').set('Authorization', auth)
      .send({ sectionSubjectId: randomUUID(), title: 'Missing' });
    const crossSchool = await request(app.getHttpServer()).post('/api/v1/units').set('Authorization', auth)
      .send({ sectionSubjectId: developmentId(505), title: 'Cross school' });
    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(crossSchool.status).toBe(404);

    const admin = await login(app, 'admin1@wasl.test');
    const subject = await request(app.getHttpServer()).post('/api/v1/subjects').set('Authorization', bearer(admin.accessToken))
      .send({ nameAr: 'اختبار', nameEn: 'Unassigned' });
    const unassigned = await request(app.getHttpServer()).post('/api/v1/section-subjects').set('Authorization', bearer(admin.accessToken))
      .send({ sectionId: developmentId(403), subjectId: subject.body.id });
    const denied = await request(app.getHttpServer()).post('/api/v1/units').set('Authorization', auth)
      .send({ sectionSubjectId: unassigned.body.id, title: 'Not mine' });
    expect(denied.status).toBe(404);
  });

  it('isolates unit lists and direct IDs by school', async () => {
    const admin = await login(app, 'admin1@wasl.test');
    const auth = bearer(admin.accessToken);
    const response = await request(app.getHttpServer()).get('/api/v1/units?limit=100').set('Authorization', auth);
    const direct = await request(app.getHttpServer()).get(`/api/v1/units/${developmentId(507)}`).set('Authorization', bearer(admin.accessToken));
    const lessons = await request(app.getHttpServer()).get('/api/v1/lessons?limit=100').set('Authorization', auth);
    const directLesson = await request(app.getHttpServer()).get(`/api/v1/lessons/${developmentId(508)}`).set('Authorization', auth);
    expect(response.status).toBe(200);
    expect(response.body.items.every((row: { schoolId: string }) => row.schoolId === developmentId(1))).toBe(true);
    expect(direct.status).toBe(404);
    expect(lessons.body.items.every((row: { schoolId: string }) => row.schoolId === developmentId(1))).toBe(true);
    expect(directLesson.status).toBe(404);
  });

  it('allows an assigned teacher to create and edit a draft lesson with persistent reads', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const created = await request(app.getHttpServer()).post('/api/v1/lessons').set('Authorization', auth)
      .send({ unitId: developmentId(407), title: ' Fractions ', body: 'Draft one', order: 5 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ schoolId: developmentId(1), unitId: developmentId(407), title: 'Fractions', body: 'Draft one', order: 5, status: 'DRAFT', publishedAt: null });
    const updated = await request(app.getHttpServer()).patch(`/api/v1/lessons/${created.body.id}`).set('Authorization', auth)
      .send({ title: 'Equivalent fractions', body: 'Draft two', order: 6 });
    const detail = await request(app.getHttpServer()).get(`/api/v1/lessons/${created.body.id}`).set('Authorization', auth);
    expect(updated.status).toBe(200);
    expect(detail.body).toEqual(updated.body);
  });

  it('validates lesson input and hides missing or cross-school units and lessons', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const invalid = await request(app.getHttpServer()).post('/api/v1/lessons').set('Authorization', auth)
      .send({ unitId: 'bad', title: '', order: -2, status: 'PUBLISHED' });
    const missing = await request(app.getHttpServer()).post('/api/v1/lessons').set('Authorization', auth)
      .send({ unitId: randomUUID(), title: 'Missing' });
    const crossUnit = await request(app.getHttpServer()).post('/api/v1/lessons').set('Authorization', auth)
      .send({ unitId: developmentId(507), title: 'Cross school' });
    const crossLesson = await request(app.getHttpServer()).get(`/api/v1/lessons/${developmentId(508)}`).set('Authorization', auth);
    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(crossUnit.status).toBe(404);
    expect(crossLesson.status).toBe(404);
  });

  it('publishes a draft atomically and enforces one-way immutable lifecycle rules', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const published = await request(app.getHttpServer()).patch(`/api/v1/lessons/${developmentId(409)}`).set('Authorization', auth)
      .send({ title: 'Ready lesson', body: 'Ready content', status: 'PUBLISHED' });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe('PUBLISHED');
    expect(new Date(published.body.publishedAt).toString()).not.toBe('Invalid Date');
    const editPublished = await request(app.getHttpServer()).patch(`/api/v1/lessons/${developmentId(409)}`).set('Authorization', auth).send({ body: 'Changed' });
    const revert = await request(app.getHttpServer()).patch(`/api/v1/lessons/${developmentId(409)}`).set('Authorization', auth).send({ status: 'DRAFT' });
    const archived = await request(app.getHttpServer()).patch(`/api/v1/lessons/${developmentId(409)}`).set('Authorization', auth).send({ status: 'ARCHIVED' });
    expect(editPublished.status).toBe(409);
    expect(revert.status).toBe(409);
    expect(archived.status).toBe(200);
    expect(archived.body.status).toBe('ARCHIVED');
  });

  it('shows students only published lessons in their active enrolled classes', async () => {
    const student = await login(app, 'student1@wasl.test');
    const auth = bearer(student.accessToken);
    const list = await request(app.getHttpServer()).get(`/api/v1/lessons?unitId=${developmentId(407)}&limit=100`).set('Authorization', auth);
    const published = await request(app.getHttpServer()).get(`/api/v1/lessons/${developmentId(408)}`).set('Authorization', auth);
    const draft = await request(app.getHttpServer()).get(`/api/v1/lessons/${developmentId(409)}`).set('Authorization', auth);
    const create = await request(app.getHttpServer()).post('/api/v1/lessons').set('Authorization', auth).send({ unitId: developmentId(407), title: 'No' });
    expect(list.status).toBe(200);
    expect(list.body.items.map((row: { id: string }) => row.id)).toEqual([developmentId(408)]);
    expect(published.status).toBe(200);
    expect(draft.status).toBe(404);
    expect(create.status).toBe(403);
  });

  it('removes student content visibility when enrollment becomes inactive', async () => {
    const student = await login(app, 'student1@wasl.test');
    const admin = await login(app, 'admin1@wasl.test');
    const disabled = await request(app.getHttpServer()).patch(`/api/v1/enrollments/${developmentId(406)}`).set('Authorization', bearer(admin.accessToken)).send({ status: 'WITHDRAWN' });
    const units = await request(app.getHttpServer()).get('/api/v1/units').set('Authorization', bearer(student.accessToken));
    const lesson = await request(app.getHttpServer()).get(`/api/v1/lessons/${developmentId(408)}`).set('Authorization', bearer(student.accessToken));
    expect(disabled.status).toBe(200);
    expect(units.body.items).toHaveLength(0);
    expect(lesson.status).toBe(404);
  });

  it('makes content read-only when its academic year is archived', async () => {
    const admin = await login(app, 'admin1@wasl.test');
    const auth = bearer(admin.accessToken);
    const archived = await request(app.getHttpServer()).patch(`/api/v1/academic-years/${developmentId(400)}`).set('Authorization', auth).send({ archived: true });
    const unit = await request(app.getHttpServer()).post('/api/v1/units').set('Authorization', auth).send({ sectionSubjectId: developmentId(405), title: 'Closed year' });
    const lesson = await request(app.getHttpServer()).patch(`/api/v1/lessons/${developmentId(409)}`).set('Authorization', auth).send({ title: 'Closed year' });
    expect(archived.status).toBe(200);
    expect(unit.status).toBe(409);
    expect(lesson.status).toBe(409);
  });
});
