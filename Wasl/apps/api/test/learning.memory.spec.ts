import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { bearer, createMemoryApp, developmentId, login, TEST_PASSWORD } from './memory-harness';

describe('Backend Phase 2 Resources and Question Banks with isolated memory storage', () => {
  let app: INestApplication;

  beforeEach(async () => { app = await createMemoryApp(); });
  afterEach(async () => { if (app) await app.close(); });

  it('requires valid authentication and rejects parent access to authoring content', async () => {
    const missing = await request(app.getHttpServer()).get('/api/v1/resources');
    const invalid = await request(app.getHttpServer()).get('/api/v1/question-banks').set('Authorization', 'Bearer not-a-token');
    const parent = await login(app, 'parent@wasl.test');
    const parentResources = await request(app.getHttpServer()).get('/api/v1/resources').set('Authorization', bearer(parent.accessToken));
    const parentBanks = await request(app.getHttpServer()).get('/api/v1/question-banks').set('Authorization', bearer(parent.accessToken));
    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(parentResources.status).toBe(403);
    expect(parentBanks.status).toBe(403);
  });

  it('lets an assigned teacher create and update HTTPS resource metadata on a draft lesson', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const created = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', auth).send({
      lessonId: developmentId(409), type: 'LINK', title: ' Safe reference ', url: 'https://example.test/reference', offlineAllowed: false,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ schoolId: developmentId(1), lessonId: developmentId(409), type: 'LINK', title: 'Safe reference', storageKey: null, url: 'https://example.test/reference' });
    const updated = await request(app.getHttpServer()).patch(`/api/v1/resources/${created.body.id}`).set('Authorization', auth).send({ title: 'Updated reference', offlineAllowed: true });
    const detail = await request(app.getHttpServer()).get(`/api/v1/resources/${created.body.id}`).set('Authorization', auth);
    expect(updated.status).toBe(200);
    expect(detail.body).toEqual(updated.body);
    expect(detail.body).toMatchObject({ title: 'Updated reference', offlineAllowed: true });
  });

  it('supports file metadata without claiming binary upload support', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const file = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', auth).send({
      lessonId: developmentId(409), type: 'FILE', title: 'Worksheet metadata', storageKey: 'schools/1/worksheets/fictional.pdf', offlineAllowed: true,
    });
    const missingKey = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', auth).send({ lessonId: developmentId(409), type: 'FILE', title: 'No key' });
    const unsafeKey = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', auth).send({ lessonId: developmentId(409), type: 'FILE', title: 'Unsafe key', storageKey: '../secret' });
    expect(file.status).toBe(201);
    expect(file.body).toMatchObject({ type: 'FILE', storageKey: 'schools/1/worksheets/fictional.pdf', url: null });
    expect(missingKey.status).toBe(400);
    expect(unsafeKey.status).toBe(400);
  });

  it('rejects dangerous resource URLs, conflicting metadata, and client-owned school fields', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    for (const url of ['javascript:alert(1)', 'http://example.test/insecure', 'https://user:pass@example.test/private']) {
      const response = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', auth).send({ lessonId: developmentId(409), type: 'LINK', title: 'Unsafe', url });
      expect(response.status).toBe(400);
    }
    const conflicting = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', auth).send({ lessonId: developmentId(409), type: 'VIDEO', title: 'Conflict', url: 'https://example.test/video', storageKey: 'video.mp4' });
    const owned = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', auth).send({ lessonId: developmentId(409), type: 'LINK', title: 'Owned', url: 'https://example.test', schoolId: developmentId(2) });
    expect(conflicting.status).toBe(400);
    expect(owned.status).toBe(400);
  });

  it('protects resources on published lessons and in archived academic years', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const admin = await login(app, 'admin1@wasl.test');
    const teacherAuth = bearer(teacher.accessToken);
    const editPublished = await request(app.getHttpServer()).patch(`/api/v1/resources/${developmentId(410)}`).set('Authorization', teacherAuth).send({ title: 'Changed' });
    const createPublished = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', teacherAuth).send({ lessonId: developmentId(408), type: 'LINK', title: 'Late', url: 'https://example.test/late' });
    expect(editPublished.status).toBe(409);
    expect(createPublished.status).toBe(409);
    const archived = await request(app.getHttpServer()).patch(`/api/v1/academic-years/${developmentId(400)}`).set('Authorization', bearer(admin.accessToken)).send({ archived: true });
    const closed = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', teacherAuth).send({ lessonId: developmentId(409), type: 'LINK', title: 'Closed', url: 'https://example.test/closed' });
    expect(archived.status).toBe(200);
    expect(closed.status).toBe(409);
  });

  it('enforces student publication visibility and cross-school resource isolation', async () => {
    const student = await login(app, 'student1@wasl.test');
    const teacher = await login(app, 'teacher1@wasl.test');
    const studentAuth = bearer(student.accessToken);
    const list = await request(app.getHttpServer()).get('/api/v1/resources?limit=100').set('Authorization', studentAuth);
    const published = await request(app.getHttpServer()).get(`/api/v1/resources/${developmentId(410)}`).set('Authorization', studentAuth);
    const draft = await request(app.getHttpServer()).get(`/api/v1/resources/${developmentId(411)}`).set('Authorization', studentAuth);
    const crossSchool = await request(app.getHttpServer()).get(`/api/v1/resources/${developmentId(510)}`).set('Authorization', bearer(teacher.accessToken));
    const write = await request(app.getHttpServer()).post('/api/v1/resources').set('Authorization', studentAuth).send({ lessonId: developmentId(409), type: 'LINK', title: 'No', url: 'https://example.test/no' });
    expect(list.status).toBe(200);
    expect(list.body.items.map((row: { id: string }) => row.id)).toEqual([developmentId(410)]);
    expect(published.status).toBe(200);
    expect(draft.status).toBe(404);
    expect(crossSchool.status).toBe(404);
    expect(write.status).toBe(403);
  });

  it('lets teachers manage banks only for subjects they actively teach', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const created = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', auth).send({ subjectId: developmentId(404), name: ' Fractions Bank ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ schoolId: developmentId(1), subjectId: developmentId(404), ownerId: developmentId(111), name: 'Fractions Bank' });
    const updated = await request(app.getHttpServer()).patch(`/api/v1/question-banks/${created.body.id}`).set('Authorization', auth).send({ name: 'Advanced Fractions' });
    const list = await request(app.getHttpServer()).get(`/api/v1/question-banks?subjectId=${developmentId(404)}&limit=100`).set('Authorization', auth);
    expect(updated.status).toBe(200);
    expect(list.body.items).toContainEqual(updated.body);
    const missing = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', auth).send({ subjectId: randomUUID(), name: 'Missing' });
    const crossSchool = await request(app.getHttpServer()).get(`/api/v1/question-banks/${developmentId(702)}`).set('Authorization', auth);
    expect(missing.status).toBe(404);
    expect(crossSchool.status).toBe(404);
  });

  it('requires school admins to select a valid assigned teacher owner', async () => {
    const admin = await login(app, 'admin1@wasl.test');
    const auth = bearer(admin.accessToken);
    const missingOwner = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', auth).send({ subjectId: developmentId(404), name: 'Admin Bank' });
    const crossSchoolOwner = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', auth).send({ subjectId: developmentId(404), ownerId: developmentId(121), name: 'Wrong Owner' });
    const created = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', auth).send({ subjectId: developmentId(404), ownerId: developmentId(111), name: 'Admin Managed Bank' });
    expect(missingOwner.status).toBe(400);
    expect(crossSchoolOwner.status).toBe(404);
    expect(created.status).toBe(201);
  });

  it("does not let one assigned teacher modify another teacher's bank", async () => {
    const admin = await login(app, 'admin1@wasl.test');
    const adminAuth = bearer(admin.accessToken);
    const email = `shared-subject-${randomUUID()}@wasl.test`;
    const teacherUser = await request(app.getHttpServer()).post('/api/v1/users').set('Authorization', adminAuth).send({ email, fullName: 'Fictional Shared Subject Teacher', password: TEST_PASSWORD, role: 'TEACHER' });
    const section = await request(app.getHttpServer()).post('/api/v1/sections').set('Authorization', adminAuth).send({ gradeId: developmentId(402), academicYearId: developmentId(400), name: 'Shared Subject QA' });
    const assignment = await request(app.getHttpServer()).post('/api/v1/section-subjects').set('Authorization', adminAuth).send({ sectionId: section.body.id, subjectId: developmentId(404), teacherId: teacherUser.body.user.id });
    expect(teacherUser.status).toBe(201);
    expect(section.status).toBe(201);
    expect(assignment.status).toBe(201);

    const owner = await login(app, email);
    const ownerBank = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', bearer(owner.accessToken)).send({ subjectId: developmentId(404), name: 'Second Teacher Bank' });
    const teacher1 = await login(app, 'teacher1@wasl.test');
    const teacher1Auth = bearer(teacher1.accessToken);
    const readable = await request(app.getHttpServer()).get(`/api/v1/question-banks/${ownerBank.body.id}`).set('Authorization', teacher1Auth);
    const rename = await request(app.getHttpServer()).patch(`/api/v1/question-banks/${ownerBank.body.id}`).set('Authorization', teacher1Auth).send({ name: 'Stolen Bank' });
    const addQuestion = await request(app.getHttpServer()).post(`/api/v1/question-banks/${ownerBank.body.id}/questions`).set('Authorization', teacher1Auth).send({ type: 'ESSAY', text: 'Unauthorized' });
    expect(ownerBank.status).toBe(201);
    expect(readable.status).toBe(200);
    expect(rename.status).toBe(403);
    expect(addQuestion.status).toBe(403);
  });

  it('creates every schema-supported question type with valid answer configuration', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const cases = [
      { type: 'MULTIPLE_CHOICE', text: 'Choose one', options: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: false }] },
      { type: 'TRUE_FALSE', text: 'The sky is blue', options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] },
      { type: 'SHORT_ANSWER', text: 'Write the result', options: [{ text: '42', isCorrect: true }] },
      { type: 'ESSAY', text: 'Explain your reasoning', options: [] },
      { type: 'FILE_UPLOAD', text: 'Upload fictional work', options: [] },
    ];
    for (const value of cases) {
      const response = await request(app.getHttpServer()).post(`/api/v1/question-banks/${developmentId(701)}/questions`).set('Authorization', auth).send({ ...value, points: 2 });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ schoolId: developmentId(1), questionBankId: developmentId(701), type: value.type, text: value.text, points: 2 });
      expect(response.body.options).toHaveLength(value.options.length);
    }
  });

  it('rejects invalid option sets atomically without adding a question', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const before = await request(app.getHttpServer()).get(`/api/v1/question-banks/${developmentId(701)}/questions?limit=100`).set('Authorization', auth);
    const duplicate = await request(app.getHttpServer()).post(`/api/v1/question-banks/${developmentId(701)}/questions`).set('Authorization', auth).send({ type: 'MULTIPLE_CHOICE', text: 'Duplicate', options: [{ text: 'Same', isCorrect: true }, { text: 'same', isCorrect: false }] });
    const twoCorrect = await request(app.getHttpServer()).post(`/api/v1/question-banks/${developmentId(701)}/questions`).set('Authorization', auth).send({ type: 'TRUE_FALSE', text: 'Both', options: [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: true }] });
    const essayOptions = await request(app.getHttpServer()).post(`/api/v1/question-banks/${developmentId(701)}/questions`).set('Authorization', auth).send({ type: 'ESSAY', text: 'Essay', options: [{ text: 'Leaked', isCorrect: true }] });
    const after = await request(app.getHttpServer()).get(`/api/v1/question-banks/${developmentId(701)}/questions?limit=100`).set('Authorization', auth);
    expect(duplicate.status).toBe(400);
    expect(twoCorrect.status).toBe(400);
    expect(essayOptions.status).toBe(400);
    expect(after.body.total).toBe(before.body.total);
  });

  it('updates question content and options atomically and preserves the previous state on failure', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const auth = bearer(teacher.accessToken);
    const created = await request(app.getHttpServer()).post(`/api/v1/question-banks/${developmentId(701)}/questions`).set('Authorization', auth).send({ type: 'MULTIPLE_CHOICE', text: 'Original', points: 1, options: [{ text: 'One', isCorrect: true }, { text: 'Two', isCorrect: false }] });
    const updated = await request(app.getHttpServer()).patch(`/api/v1/questions/${created.body.id}`).set('Authorization', auth).send({ text: 'Updated', points: 3, options: [{ text: 'Three', isCorrect: false }, { text: 'Four', isCorrect: true }] });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ text: 'Updated', points: 3 });
    const invalid = await request(app.getHttpServer()).patch(`/api/v1/questions/${created.body.id}`).set('Authorization', auth).send({ text: 'Must roll back', options: [{ text: 'Only', isCorrect: true }, { text: 'only', isCorrect: false }] });
    const detail = await request(app.getHttpServer()).get(`/api/v1/questions/${created.body.id}`).set('Authorization', auth);
    expect(invalid.status).toBe(400);
    expect(detail.body).toEqual(updated.body);
  });

  it('locks questions represented as referenced by a non-draft assessment', async () => {
    const teacher = await login(app, 'teacher1@wasl.test');
    const response = await request(app.getHttpServer()).patch(`/api/v1/questions/${developmentId(711)}`).set('Authorization', bearer(teacher.accessToken)).send({ text: 'Unsafe mutation' });
    expect(response.status).toBe(409);
  });

  it('returns student-safe question DTOs without answer-key metadata', async () => {
    const student = await login(app, 'student1@wasl.test');
    const teacher = await login(app, 'teacher1@wasl.test');
    const safe = await request(app.getHttpServer()).get(`/api/v1/student/questions/${developmentId(711)}`).set('Authorization', bearer(student.accessToken));
    const author = await request(app.getHttpServer()).get(`/api/v1/questions/${developmentId(711)}`).set('Authorization', bearer(teacher.accessToken));
    expect(safe.status).toBe(200);
    expect(safe.body.options).toHaveLength(2);
    expect(safe.body.options.every((option: Record<string, unknown>) => !Object.prototype.hasOwnProperty.call(option, 'isCorrect'))).toBe(true);
    expect(JSON.stringify(safe.body)).not.toContain('isCorrect');
    expect(author.status).toBe(200);
    expect(author.body.options.some((option: { isCorrect: boolean }) => option.isCorrect)).toBe(true);
  });

  it('isolates student-safe and author question reads across schools', async () => {
    const student = await login(app, 'student1@wasl.test');
    const teacher = await login(app, 'teacher1@wasl.test');
    const studentAuth = bearer(student.accessToken);
    const list = await request(app.getHttpServer()).get('/api/v1/student/questions?limit=100').set('Authorization', studentAuth);
    const crossStudent = await request(app.getHttpServer()).get(`/api/v1/student/questions/${developmentId(712)}`).set('Authorization', studentAuth);
    const crossAuthor = await request(app.getHttpServer()).get(`/api/v1/questions/${developmentId(712)}`).set('Authorization', bearer(teacher.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.items.every((row: { schoolId: string }) => row.schoolId === developmentId(1))).toBe(true);
    expect(crossStudent.status).toBe(404);
    expect(crossAuthor.status).toBe(404);
  });

  it('rejects student authoring and hides all student questions after enrollment withdrawal', async () => {
    const student = await login(app, 'student1@wasl.test');
    const admin = await login(app, 'admin1@wasl.test');
    const studentAuth = bearer(student.accessToken);
    const createBank = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', studentAuth).send({ subjectId: developmentId(404), name: 'No' });
    const createQuestion = await request(app.getHttpServer()).post(`/api/v1/question-banks/${developmentId(701)}/questions`).set('Authorization', studentAuth).send({ type: 'ESSAY', text: 'No' });
    expect(createBank.status).toBe(403);
    expect(createQuestion.status).toBe(403);
    await request(app.getHttpServer()).patch(`/api/v1/enrollments/${developmentId(406)}`).set('Authorization', bearer(admin.accessToken)).send({ status: 'WITHDRAWN' });
    const list = await request(app.getHttpServer()).get('/api/v1/student/questions?limit=100').set('Authorization', studentAuth);
    const detail = await request(app.getHttpServer()).get(`/api/v1/student/questions/${developmentId(711)}`).set('Authorization', studentAuth);
    expect(list.body.items).toHaveLength(0);
    expect(detail.status).toBe(404);
  });

  it('makes bank and question authoring unavailable after the related academic year is archived', async () => {
    const admin = await login(app, 'admin1@wasl.test');
    const teacher = await login(app, 'teacher1@wasl.test');
    const archived = await request(app.getHttpServer()).patch(`/api/v1/academic-years/${developmentId(400)}`).set('Authorization', bearer(admin.accessToken)).send({ archived: true });
    const bank = await request(app.getHttpServer()).post('/api/v1/question-banks').set('Authorization', bearer(teacher.accessToken)).send({ subjectId: developmentId(404), name: 'Closed' });
    const question = await request(app.getHttpServer()).post(`/api/v1/question-banks/${developmentId(701)}/questions`).set('Authorization', bearer(teacher.accessToken)).send({ type: 'ESSAY', text: 'Closed' });
    expect(archived.status).toBe(200);
    expect(bank.status).toBe(400);
    expect(question.status).toBe(404);
  });
});
