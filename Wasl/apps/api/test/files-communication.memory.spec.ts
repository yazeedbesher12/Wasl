import type { INestApplication } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WaslClient } from '@wasl/shared';
import { STORAGE, type FoundationStorage } from '../src/foundation/repositories';
import { MAX_FILE_BYTES, OBJECT_STORE, type ObjectStore } from '../src/files/object-store';
import { bearer, createMemoryApp, developmentId as id, login, TEST_PASSWORD, TEST_PDF, uploadTestFile } from './memory-harness';

type Actor = 'teacher' | 'student' | 'parent' | 'admin' | 'otherTeacher' | 'otherStudent' | 'otherAdmin' | 'peerTeacher' | 'peerStudent' | 'platform';
describe('Private files, announcements and notifications API', () => {
  let app: INestApplication;
  let objects: ObjectStore;
  const tokens = {} as Record<Actor, string>;
  let peerStudent: string;
  const call = (who: Actor, method: 'get' | 'post' | 'put' | 'patch', path: string, body?: object) => {
    const req = request(app.getHttpServer())[method]('/api/v1' + path).set('Authorization', tokens[who]);
    return body ? req.send(body) : req;
  };
  const upload = (who: Actor, purpose: 'LESSON_RESOURCE' | 'ASSESSMENT_ANSWER', target: string, data = TEST_PDF, filename = 'test.pdf', mime = 'application/pdf') => request(app.getHttpServer()).post('/api/v1/files').set('Authorization', tokens[who]).field('purpose', purpose).field(purpose === 'LESSON_RESOURCE' ? 'lessonId' : 'assessmentId', target).attach('file', data, { filename, contentType: mime });
  async function lesson() {
    const row = await call('teacher', 'post', '/lessons', { unitId: id(407), title: 'File lesson ' + randomUUID() });
    expect(row.status).toBe(201); return row.body.id as string;
  }
  async function exam(fileQuestion = true) {
    const q = await call('teacher', 'post', `/question-banks/${id(701)}/questions`, { type: fileQuestion ? 'FILE_UPLOAD' : 'ESSAY', text: 'Answer question', points: 5 });
    const a = await call('teacher', 'post', '/assessments', { sectionSubjectId: id(405), type: 'ASSIGNMENT', title: 'File assessment ' + randomUUID() });
    expect(q.status).toBe(201); expect(a.status).toBe(201);
    expect((await call('teacher', 'put', `/assessments/${a.body.id}/questions`, { questions: [{ questionId: q.body.id, order: 0 }] })).status).toBe(200);
    expect((await call('teacher', 'post', `/assessments/${a.body.id}/publish`)).status).toBe(200);
    return { assessmentId: a.body.id as string, questionId: q.body.id as string };
  }
  async function announcement(who: Actor = 'teacher', classId: string | null = id(405)) {
    const a = await call(who, 'post', '/announcements', { sectionSubjectId: classId, title: 'إعلان ' + randomUUID(), body: 'School announcement content' });
    expect(a.status).toBe(201); return a.body.id as string;
  }
  const notices = async (who: Actor, entityId: string) => {
    const list = await call(who, 'get', '/notifications?limit=100');
    expect(list.status).toBe(200); return list.body.items.filter((n: { payload: { entityId: string } }) => n.payload.entityId === entityId);
  };
  beforeAll(async () => {
    app = await createMemoryApp(); await app.listen(0, '127.0.0.1'); objects = app.get(OBJECT_STORE);
    for (const [who, email] of Object.entries({ teacher: 'teacher1@wasl.test', student: 'student1@wasl.test', parent: 'parent@wasl.test', admin: 'admin1@wasl.test', otherTeacher: 'teacher2@wasl.test', otherStudent: 'student2@wasl.test', otherAdmin: 'admin2@wasl.test', platform: 'platform@wasl.test' })) tokens[who as Actor] = bearer((await login(app, email)).accessToken);
    for (const [who, role] of [['peerTeacher', 'TEACHER'], ['peerStudent', 'STUDENT']] as const) {
      const email = `${randomUUID()}@wasl.test`;
      const user = await call('admin', 'post', '/users', { email, fullName: who, password: TEST_PASSWORD, role });
      expect(user.status).toBe(201); tokens[who] = bearer((await login(app, email)).accessToken);
      if (who === 'peerStudent') { peerStudent = user.body.user.id; expect((await call('admin', 'post', '/enrollments', { sectionId: id(403), studentId: peerStudent })).status).toBe(201); }
    }
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it('stores real bytes, returns safe metadata and serves exact authenticated attachment bytes', async () => {
    const l = await lesson();
    const f = await upload('teacher', 'LESSON_RESOURCE', l);
    expect(f.status).toBe(201);
    expect(f.body).toMatchObject({ ownerId: id(111), schoolId: id(1), purpose: 'LESSON_RESOURCE', lessonId: l, size: TEST_PDF.length, contentType: 'application/pdf' });
    expect(f.body).not.toHaveProperty('storageDriver'); expect(f.body).not.toHaveProperty('sha256');
    expect(await objects.get(f.body.storageKey)).toEqual(TEST_PDF);
    expect((await call('teacher', 'get', `/files/${f.body.id}`)).body).toEqual(f.body);
    const content = await call('teacher', 'get', `/files/${f.body.id}/content`);
    expect(content.status).toBe(200); expect(content.body).toEqual(TEST_PDF);
    expect(content.headers['content-disposition']).toMatch(/^attachment;/);
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.headers['cache-control']).toContain('no-store');
    expect((await request(app.getHttpServer()).get(`/api/v1/files/${f.body.id}/content`)).status).toBe(401);
  });

  it('only exposes attached lesson files to enrolled students/parents after lesson publication', async () => {
    const l = await lesson(); const f = await uploadTestFile(app, tokens.teacher, { purpose: 'LESSON_RESOURCE', lessonId: l });
    expect((await call('student', 'get', `/files/${f.id}/content`)).status).toBe(404);
    expect((await call('parent', 'get', `/files/${f.id}`)).status).toBe(404);
    const resource = await call('teacher', 'post', '/resources', { lessonId: l, type: 'FILE', title: 'Actual worksheet', storageKey: f.storageKey });
    expect(resource.status).toBe(201);
    await call('teacher', 'patch', `/lessons/${l}`, { status: 'PUBLISHED' });
    expect((await call('student', 'get', `/files/${f.id}/content`)).body).toEqual(TEST_PDF);
    expect((await call('parent', 'get', `/files/${f.id}/content`)).status).toBe(200);
    expect((await upload('teacher', 'LESSON_RESOURCE', l)).status).toBe(409);
    await call('teacher', 'patch', `/lessons/${l}`, { status: 'ARCHIVED' });
    expect((await call('student', 'get', `/files/${f.id}/content`)).status).toBe(404);
    expect((await call('teacher', 'get', `/files/${f.id}/content`)).status).toBe(200);
  });

  it('keeps unreferenced files private even after their lesson is published', async () => {
    const l = await lesson(); const f = await uploadTestFile(app, tokens.teacher, { purpose: 'LESSON_RESOURCE', lessonId: l });
    await call('teacher', 'patch', `/lessons/${l}`, { status: 'PUBLISHED' });
    expect((await call('student', 'get', `/files/${f.id}/content`)).status).toBe(404);
  });

  it('rejects fake, unrelated and cross-school resource storage keys', async () => {
    const l = await lesson(); const other = await lesson();
    const f = await uploadTestFile(app, tokens.teacher, { purpose: 'LESSON_RESOURCE', lessonId: other });
    for (const key of ['schools/1/pretend.pdf', '../private', f.storageKey]) expect((await call('teacher', 'post', '/resources', { lessonId: l, type: 'FILE', title: 'No', storageKey: key })).status).toBe(400);
    expect((await call('otherTeacher', 'get', `/files/${f.id}`)).status).toBe(404);
    expect((await call('otherStudent', 'get', `/files/${f.id}/content`)).status).toBe(404);
    expect((await call('peerTeacher', 'get', `/files/${f.id}/content`)).status).toBe(404);
  });

  it('enforces file purposes, target scope and upload roles', async () => {
    const l = await lesson();
    expect((await upload('student', 'LESSON_RESOURCE', l)).status).toBe(404);
    expect((await upload('otherTeacher', 'LESSON_RESOURCE', l)).status).toBe(404);
    expect((await upload('parent', 'LESSON_RESOURCE', l)).status).toBe(403);
    expect((await upload('platform', 'LESSON_RESOURCE', l)).status).toBe(403);
    const unknown = await request(app.getHttpServer()).post('/api/v1/files').set('Authorization', tokens.teacher).field('purpose', 'LESSON_RESOURCE').field('lessonId', l).field('schoolId', id(2)).attach('file', TEST_PDF, 'x.pdf');
    expect([400, 413]).toContain(unknown.status);
    expect((await call('teacher', 'post', '/files', { purpose: 'LESSON_RESOURCE', lessonId: l })).status).toBe(400);
  });

  it('rejects empty, oversized, executable and MIME/signature mismatched uploads', async () => {
    const l = await lesson();
    for (const [bytes, filename, mime] of [
      [Buffer.alloc(0), 'x.pdf', 'application/pdf'],
      [Buffer.from('fake PDF'), 'x.pdf', 'application/pdf'],
      [TEST_PDF, 'x.html', 'text/html'],
      [TEST_PDF, 'x.exe', 'application/octet-stream'],
      [TEST_PDF, 'x.pdf', 'text/plain'],
      [Buffer.from([0, 1, 2]), 'x.txt', 'text/plain'],
    ] as const) expect((await upload('teacher', 'LESSON_RESOURCE', l, bytes, filename, mime)).status).toBe(400);
    const large = Buffer.alloc(MAX_FILE_BYTES + 1); TEST_PDF.copy(large);
    expect((await upload('teacher', 'LESSON_RESOURCE', l, large)).status).toBe(413);
  });

  it('accepts UTF-8 text files and distinct immutable uploads without overwriting', async () => {
    const l = await lesson(); const bytes = Buffer.from('محتوى تعليمي بالعربية');
    const a = await upload('teacher', 'LESSON_RESOURCE', l, bytes, 'notes.txt', 'text/plain');
    const b = await upload('teacher', 'LESSON_RESOURCE', l, Buffer.from('Another text'), 'notes.txt', 'text/plain');
    expect(a.status).toBe(201); expect(b.status).toBe(201); expect(a.body.storageKey).not.toBe(b.body.storageKey);
    expect(await objects.get(a.body.storageKey)).toEqual(bytes);
  });

  it('requires an owned uploaded answer file for the exact assessment and protects drafts until final submission', async () => {
    const a = await exam();
    const f = await uploadTestFile(app, tokens.student, { purpose: 'ASSESSMENT_ANSWER', assessmentId: a.assessmentId });
    const peer = await uploadTestFile(app, tokens.peerStudent, { purpose: 'ASSESSMENT_ANSWER', assessmentId: a.assessmentId });
    expect((await call('teacher', 'get', `/files/${f.id}/content`)).status).toBe(404);
    expect((await call('admin', 'get', `/files/${f.id}/content`)).status).toBe(404);
    expect((await call('parent', 'get', `/files/${f.id}/content`)).status).toBe(404);
    expect((await call('peerStudent', 'get', `/files/${f.id}/content`)).status).toBe(404);
    for (const key of [`schools/${id(1)}/students/${id(112)}/invented.pdf`, peer.storageKey]) expect((await call('student', 'post', `/assessments/${a.assessmentId}/submit`, { answers: [{ questionId: a.questionId, fileKey: key }] })).status).toBe(400);
    const final = await call('student', 'post', `/assessments/${a.assessmentId}/submit`, { answers: [{ questionId: a.questionId, fileKey: f.storageKey }] });
    expect(final.status).toBe(200);
    expect((await call('teacher', 'get', `/files/${f.id}/content`)).status).toBe(200);
    expect((await call('admin', 'get', `/files/${f.id}/content`)).status).toBe(200);
    expect((await call('parent', 'get', `/files/${f.id}/content`)).status).toBe(404);
    await call('teacher', 'post', `/assessments/${a.assessmentId}/close`);
    await call('teacher', 'post', `/submissions/${final.body.id}/grade`, { answers: [{ questionId: a.questionId, score: 5 }] });
    await call('teacher', 'post', `/assessments/${a.assessmentId}/release`);
    expect((await call('parent', 'get', `/files/${f.id}/content`)).status).toBe(200);
    await call('admin', 'patch', `/parent-links/${id(601)}`, { status: 'REJECTED' });
    expect((await call('parent', 'get', `/files/${f.id}/content`)).status).toBe(404);
    await call('admin', 'patch', `/parent-links/${id(601)}`, { status: 'VERIFIED' });
    expect((await upload('student', 'ASSESSMENT_ANSWER', a.assessmentId)).status).toBe(409);
  });

  it('rejects files from another assessment and assessments without a file question', async () => {
    const a = await exam(); const b = await exam();
    const f = await uploadTestFile(app, tokens.student, { purpose: 'ASSESSMENT_ANSWER', assessmentId: a.assessmentId });
    expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, { answers: [{ questionId: b.questionId, fileKey: f.storageKey }] })).status).toBe(400);
    const text = await exam(false);
    expect((await upload('student', 'ASSESSMENT_ANSWER', text.assessmentId)).status).toBe(400);
    expect((await upload('otherStudent', 'ASSESSMENT_ANSWER', a.assessmentId)).status).toBe(404);
  });

  it('cleans up stored bytes when metadata commit fails and never creates metadata on an object-store failure', async () => {
    const l = await lesson(); const storage = app.get<FoundationStorage>(STORAGE);
    const original = storage.run.bind(storage);
    let attempts = 0; let key = '';
    const put = objects.put.bind(objects); jest.spyOn(objects, 'put').mockImplementation(async (k, data, mime) => { key = k; return put(k, data, mime); });
    jest.spyOn(storage, 'run').mockImplementation(async (scope, work) => {
      // Access-token identity validation is a separate identity operation.
      if (scope.kind === 'school' && ++attempts === 2) throw new ServiceUnavailableException('Test metadata outage');
      return original(scope, work);
    });
    expect((await upload('teacher', 'LESSON_RESOURCE', l)).status).toBe(503);
    expect(key).not.toBe(''); await expect(objects.get(key)).rejects.toThrow();
    jest.restoreAllMocks();
    jest.spyOn(objects, 'put').mockRejectedValue(new ServiceUnavailableException('Test storage outage'));
    expect((await upload('teacher', 'LESSON_RESOURCE', l)).status).toBe(503);
  });

  it('rechecks target lifecycle after object upload and removes the newly written orphan', async () => {
    const l = await lesson(); const put = objects.put.bind(objects); let key = '';
    jest.spyOn(objects, 'put').mockImplementation(async (k, data, mime) => {
      key = k; await put(k, data, mime);
      expect((await call('teacher', 'patch', `/lessons/${l}`, { status: 'PUBLISHED' })).status).toBe(200);
    });
    expect((await upload('teacher', 'LESSON_RESOURCE', l)).status).toBe(409);
    await expect(objects.get(key)).rejects.toThrow();
  });

  it('refuses missing or corrupted stored bytes rather than returning fictional data', async () => {
    const l = await lesson(); const f = await uploadTestFile(app, tokens.teacher, { purpose: 'LESSON_RESOURCE', lessonId: l });
    jest.spyOn(objects, 'get').mockResolvedValue(Buffer.from('tampered'));
    expect((await call('teacher', 'get', `/files/${f.id}/content`)).status).toBe(503);
    jest.restoreAllMocks(); await objects.remove(f.storageKey);
    expect((await call('teacher', 'get', `/files/${f.id}/content`)).status).toBe(404);
  });

  it('keeps announcement drafts private and publishes class notifications only to eligible students and approved parents', async () => {
    const a = await announcement();
    expect((await call('student', 'get', `/announcements/${a}`)).status).toBe(404);
    expect((await call('parent', 'get', `/announcements/${a}`)).status).toBe(404);
    expect(await notices('student', a)).toEqual([]);
    expect((await call('teacher', 'patch', `/announcements/${a}`, { body: 'Edited draft' })).status).toBe(200);
    const published = await call('teacher', 'post', `/announcements/${a}/publish`);
    expect(published.body).toMatchObject({ status: 'PUBLISHED', body: 'Edited draft' }); expect(published.body.publishedAt).not.toBeNull();
    expect((await call('student', 'get', `/announcements/${a}`)).status).toBe(200);
    expect((await call('parent', 'get', `/announcements/${a}`)).status).toBe(200);
    expect(await notices('student', a)).toHaveLength(1); expect(await notices('parent', a)).toHaveLength(1);
    expect(await notices('otherStudent', a)).toEqual([]);
    expect((await call('teacher', 'post', `/announcements/${a}/publish`)).status).toBe(409);
    expect(await notices('student', a)).toHaveLength(1);
    expect((await call('teacher', 'patch', `/announcements/${a}`, { title: 'Change live text' })).status).toBe(409);
  });

  it('lets school admins publish school-wide announcements and notifies active memberships once', async () => {
    const a = await announcement('admin', null);
    expect((await call('admin', 'post', `/announcements/${a}/publish`)).status).toBe(200);
    for (const who of ['teacher', 'student', 'parent', 'peerTeacher'] as const) expect(await notices(who, a)).toHaveLength(1);
    expect(await notices('admin', a)).toHaveLength(0);
    expect((await call('otherAdmin', 'get', `/announcements/${a}`)).status).toBe(404);
    expect((await call('teacher', 'post', '/announcements', { title: 'Whole school', body: 'No' })).status).toBe(403);
  });

  it('hides archived announcements and their notifications from student and parent views', async () => {
    const a = await announcement(); await call('teacher', 'post', `/announcements/${a}/publish`);
    expect((await call('teacher', 'post', `/announcements/${a}/archive`)).body.status).toBe('ARCHIVED');
    expect((await call('student', 'get', `/announcements/${a}`)).status).toBe(404);
    expect((await call('parent', 'get', `/announcements/${a}`)).status).toBe(404);
    expect(await notices('student', a)).toEqual([]); expect(await notices('parent', a)).toEqual([]);
    expect((await call('teacher', 'get', `/announcements/${a}`)).status).toBe(200);
  });

  it('rejects cross-school, unassigned-teacher and student announcement mutations', async () => {
    const a = await announcement();
    for (const who of ['otherTeacher', 'peerTeacher'] as const) {
      expect((await call(who, 'get', `/announcements/${a}`)).status).toBe(404);
      expect((await call(who, 'patch', `/announcements/${a}`, { title: 'No' })).status).toBe(404);
      for (const act of ['publish', 'archive']) expect((await call(who, 'post', `/announcements/${a}/${act}`)).status).toBe(404);
    }
    for (const who of ['student', 'parent', 'platform'] as const) {
      expect((await call(who, 'post', '/announcements', { title: 'No', body: 'No' })).status).toBe(403);
      expect((await call(who, 'post', `/announcements/${a}/publish`)).status).toBe(403);
    }
    expect((await call('teacher', 'post', '/announcements', { sectionSubjectId: id(505), title: 'No', body: 'No' })).status).toBe(404);
  });

  it('validates announcement fields, lifecycle and immutable ownership', async () => {
    for (const fields of [{ title: '' }, { title: null }, { body: null }, { schoolId: id(2) }, { authorId: id(121) }, { status: 'PUBLISHED' }]) expect((await call('teacher', 'post', '/announcements', { sectionSubjectId: id(405), title: 'Valid', body: 'Valid', ...fields })).status).toBe(400);
    const a = await announcement();
    expect((await call('teacher', 'post', `/announcements/${a}/archive`)).status).toBe(409);
    expect((await call('teacher', 'patch', `/announcements/${a}`, { sectionSubjectId: id(505) })).status).toBe(400);
  });

  it('supports owner-only read flags, accurate unread counts and idempotent timestamps', async () => {
    const a = await announcement(); await call('teacher', 'post', `/announcements/${a}/publish`);
    const n = (await notices('student', a))[0];
    expect(n.titleAr).toBeTruthy(); expect(n.title).toBeTruthy(); expect(n.payload).not.toHaveProperty('score');
    const before = await call('student', 'get', '/notifications/unread-count');
    const read = await call('student', 'patch', `/notifications/${n.id}/read`);
    expect(read.status).toBe(200); expect(read.body.readAt).not.toBeNull();
    expect((await call('student', 'get', '/notifications/unread-count')).body.count).toBe(before.body.count - 1);
    expect((await call('student', 'patch', `/notifications/${n.id}/read`)).body.readAt).toBe(read.body.readAt);
    for (const who of ['parent', 'peerStudent', 'otherStudent'] as const) expect((await call(who, 'patch', `/notifications/${n.id}/read`)).status).toBe(404);
    expect((await notices('parent', a))[0].readAt).toBeNull();
    expect((await call('student', 'post', '/notifications/read-all')).status).toBe(200);
    expect((await call('student', 'get', '/notifications/unread-count')).body.count).toBe(0);
    expect((await call('student', 'get', '/notifications?read=unread')).body.total).toBe(0);
  });

  it('emits assessment, submission and released-result events atomically without disclosing grades', async () => {
    const a = await exam(false);
    expect((await notices('student', a.assessmentId)).map((n: { type: string }) => n.type)).toContain('ASSESSMENT_PUBLISHED');
    expect((await notices('parent', a.assessmentId)).map((n: { type: string }) => n.type)).toContain('ASSESSMENT_PUBLISHED');
    const final = await call('student', 'post', `/assessments/${a.assessmentId}/submit`, { answers: [{ questionId: a.questionId, text: 'My work' }] });
    expect(final.status).toBe(200);
    expect((await notices('teacher', final.body.id))[0].type).toBe('SUBMISSION_RECEIVED');
    expect((await notices('student', final.body.id))[0].type).toBe('SUBMISSION_RECEIVED');
    expect(await notices('parent', final.body.id)).toEqual([]);
    await call('teacher', 'post', `/assessments/${a.assessmentId}/close`);
    await call('teacher', 'post', `/submissions/${final.body.id}/grade`, { answers: [{ questionId: a.questionId, score: 4 }], feedback: 'PRIVATE_FEEDBACK' });
    expect((await notices('student', a.assessmentId)).some((n: { type: string }) => n.type === 'RESULTS_RELEASED')).toBe(false);
    await call('teacher', 'post', `/assessments/${a.assessmentId}/release`);
    const released = (await notices('student', a.assessmentId)).find((n: { type: string }) => n.type === 'RESULTS_RELEASED');
    expect(released).toBeDefined(); expect(JSON.stringify(released)).not.toContain('PRIVATE_FEEDBACK'); expect(released.payload).not.toHaveProperty('score');
    expect((await notices('parent', a.assessmentId)).filter((n: { type: string }) => n.type === 'RESULTS_RELEASED')).toHaveLength(1);
    expect((await call('teacher', 'post', `/assessments/${a.assessmentId}/release`)).status).toBe(409);
    expect((await notices('student', a.assessmentId)).filter((n: { type: string }) => n.type === 'RESULTS_RELEASED')).toHaveLength(1);
  });

  it('rolls back publication when event persistence fails', async () => {
    const a = await announcement(); const storage = app.get<FoundationStorage>(STORAGE); const original = storage.run.bind(storage);
    jest.spyOn(storage, 'run').mockImplementation((scope, work) => original(scope, r => {
      r.communication.notify = async () => { throw new ServiceUnavailableException('Test notification outage'); };
      return work(r);
    }));
    expect((await call('teacher', 'post', `/announcements/${a}/publish`)).status).toBe(503);
    jest.restoreAllMocks();
    expect((await call('teacher', 'get', `/announcements/${a}`)).body.status).toBe('DRAFT');
    expect(await notices('student', a)).toEqual([]);
  });

  it('rechecks revoked parent links and withdrawn enrollment before returning historical alerts', async () => {
    const a = await announcement(); await call('teacher', 'post', `/announcements/${a}/publish`);
    await call('admin', 'patch', `/parent-links/${id(601)}`, { status: 'REJECTED' });
    expect((await call('parent', 'get', `/announcements/${a}`)).status).toBe(404); expect(await notices('parent', a)).toEqual([]);
    await call('admin', 'patch', `/parent-links/${id(601)}`, { status: 'VERIFIED' });
    await call('admin', 'patch', `/enrollments/${id(406)}`, { status: 'WITHDRAWN' });
    expect((await call('student', 'get', `/announcements/${a}`)).status).toBe(404); expect(await notices('student', a)).toEqual([]); expect(await notices('parent', a)).toEqual([]);
    await call('admin', 'patch', `/enrollments/${id(406)}`, { status: 'ACTIVE' });
  });

  it('rejects mutations in archived academic years', async () => {
    const l = await lesson(); const a = await announcement();
    await call('admin', 'patch', `/academic-years/${id(400)}`, { archived: true });
    expect((await upload('teacher', 'LESSON_RESOURCE', l)).status).toBe(409);
    expect((await call('teacher', 'post', `/announcements/${a}/publish`)).status).toBe(409);
    await call('admin', 'patch', `/academic-years/${id(400)}`, { archived: false });
  });

  it('documents binary and notification APIs and uploads/downloads through the shared client', async () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    expect(document.paths['/api/v1/files'].post?.requestBody).toBeDefined();
    expect(document.paths['/api/v1/files/{id}/content'].get).toBeDefined();
    expect(document.components?.schemas?.NotificationResponse).toBeDefined();
    const address = app.getHttpServer().address();
    const client = new WaslClient(`http://127.0.0.1:${address.port}/api/v1`, () => tokens.teacher.replace('Bearer ', ''));
    const l = await lesson(); const form = new FormData(); form.append('purpose', 'LESSON_RESOURCE'); form.append('lessonId', l); form.append('file', new Blob([TEST_PDF], { type: 'application/pdf' }), 'client.pdf');
    const uploaded = await client.uploadFile(form);
    expect((await client.file(uploaded.id)).size).toBe(TEST_PDF.length);
    expect(Buffer.from(await (await client.downloadFile(uploaded.id)).arrayBuffer())).toEqual(TEST_PDF);
    const a = await client.createAnnouncement({ sectionSubjectId: id(405), title: 'Client announcement', body: 'Body' });
    expect((await client.publishAnnouncement(a.id)).status).toBe('PUBLISHED');
  });
});
