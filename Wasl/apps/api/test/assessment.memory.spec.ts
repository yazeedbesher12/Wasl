import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WaslClient } from '@wasl/shared';
import { bearer, createMemoryApp, developmentId as id, login, TEST_PASSWORD } from './memory-harness';

const root = '/api/v1';
type Actor = 'teacher' | 'student' | 'admin' | 'parent' | 'otherTeacher' | 'otherStudent' | 'peerTeacher' | 'peerStudent' | 'platform';
type Row = { id: string; option: string; points: number };
describe('Assessment, submission and result API (memory)', () => {
  let app: INestApplication;
  const tokens = {} as Record<Actor, string>;
  let peerStudentId: string;
  const call = (who: Actor, method: 'get' | 'post' | 'patch' | 'put', path: string, body?: object) => {
    const r = request(app.getHttpServer())[method](root + path).set('Authorization', tokens[who]);
    return body === undefined ? r : r.send(body);
  };
  const action = (assessmentId: string, name: string) => call('teacher', 'post', `/assessments/${assessmentId}/${name}`);
  async function build(extra: Record<string, unknown> = {}, count = 1) {
    const created = await call('teacher', 'post', '/assessments', { sectionSubjectId: id(405), type: 'EXAM', title: `Assessment ${randomUUID()}`, ...extra });
    expect(created.status).toBe(201);
    const rows: Row[] = [];
    for (let i = 0; i < count; i++) {
      const q = await call('teacher', 'post', `/question-banks/${id(701)}/questions`, { type: 'MULTIPLE_CHOICE', text: `Question ${i}`, points: i + 2, options: [{ text: 'Correct', isCorrect: true }, { text: 'Other', isCorrect: false }] });
      expect(q.status).toBe(201);
      rows.push({ id: q.body.id, option: q.body.options[0].id, points: i + 2 });
    }
    const linked = await call('teacher', 'put', `/assessments/${created.body.id}/questions`, { questions: rows.map((q, i) => ({ questionId: q.id, order: i })) });
    expect(linked.status).toBe(200);
    return { assessmentId: created.body.id as string, rows };
  }
  const answers = (rows: Row[]) => ({ answers: rows.map(q => ({ questionId: q.id, optionId: q.option })) });
  const marks = (rows: Row[]) => ({ answers: rows.map(q => ({ questionId: q.id, score: q.points })), feedback: 'Reviewed feedback' });
  async function submitted(who: Actor = 'student', extra: Record<string, unknown> = {}, count = 1) {
    const b = await build(extra, count);
    expect((await action(b.assessmentId, 'publish')).status).toBe(200);
    const s = await call(who, 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows));
    expect(s.status).toBe(200);
    return { ...b, submissionId: s.body.id as string };
  }
  async function graded() {
    const b = await submitted();
    expect((await action(b.assessmentId, 'close')).status).toBe(200);
    expect((await call('teacher', 'post', `/submissions/${b.submissionId}/grade`, marks(b.rows))).status).toBe(200);
    return b;
  }
  function clock(at: number) {
    jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    jest.setSystemTime(at);
  }
  beforeAll(async () => {
    app = await createMemoryApp();
    await app.listen(0, '127.0.0.1');
    for (const [who, email] of Object.entries({ teacher: 'teacher1@wasl.test', student: 'student1@wasl.test', admin: 'admin1@wasl.test', parent: 'parent@wasl.test', otherTeacher: 'teacher2@wasl.test', otherStudent: 'student2@wasl.test', platform: 'platform@wasl.test' })) {
      tokens[who as Actor] = bearer((await login(app, email)).accessToken);
    }
    for (const [who, role] of [['peerTeacher', 'TEACHER'], ['peerStudent', 'STUDENT']] as const) {
      const email = `${randomUUID()}@wasl.test`;
      const u = await call('admin', 'post', '/users', { email, fullName: who, password: TEST_PASSWORD, role });
      expect(u.status).toBe(201);
      tokens[who] = bearer((await login(app, email)).accessToken);
      if (who === 'peerStudent') {
        peerStudentId = u.body.user.id;
        expect((await call('admin', 'post', '/enrollments', { sectionId: id(403), studentId: peerStudentId })).status).toBe(201);
      }
    }
  });
  afterEach(() => jest.useRealTimers());
  afterAll(async () => { await app?.close(); });

  it('completes the teacher/student/parent workflow and only exposes grades after explicit release', async () => {
    const b = await build({}, 2);
    expect((await call('student', 'get', `/assessments/${b.assessmentId}`)).status).toBe(404);
    const opened = await action(b.assessmentId, 'publish');
    expect(opened.body).toMatchObject({ status: 'OPEN', totalPoints: 5, questionCount: 2 });
    const view = await call('student', 'get', `/assessments/${b.assessmentId}`);
    expect(view.body.questions).toHaveLength(2);
    expect(JSON.stringify(view.body)).not.toContain('isCorrect');
    const partial = { answers: answers(b.rows).answers.slice(0, 1) };
    const draft = await call('student', 'put', `/assessments/${b.assessmentId}/submission`, partial);
    expect(draft.body).toMatchObject({ status: 'IN_PROGRESS', submittedAt: null });
    const resumed = await call('student', 'get', `/assessments/${b.assessmentId}/submission`);
    expect(resumed.body).toEqual(draft.body);
    expect((await call('teacher', 'get', `/submissions/${draft.body.id}`)).status).toBe(404);
    expect((await call('teacher', 'get', `/assessments/${b.assessmentId}/submissions`)).body.total).toBe(0);
    expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, partial)).status).toBe(400);
    const final = await call('student', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows));
    expect(final.body).toMatchObject({ id: draft.body.id, status: 'SUBMITTED', studentId: id(112) });
    expect(final.body.submittedAt).not.toBeNull();
    expect((await action(b.assessmentId, 'close')).status).toBe(200);
    const graded = await call('teacher', 'post', `/submissions/${final.body.id}/grade`, marks(b.rows));
    expect(graded.body).toMatchObject({ score: 5, status: 'GRADED', feedback: 'Reviewed feedback', resultsReleased: false });
    const hidden = await call('student', 'get', `/submissions/${final.body.id}`);
    expect(hidden.body).toMatchObject({ status: 'SUBMITTED', score: null, feedback: null, gradedAt: null, resultsReleased: false });
    expect(hidden.body.answers.every((a: { score: number | null }) => a.score === null)).toBe(true);
    expect((await call('student', 'get', '/me/grades')).body.items.some((v: { id: string }) => v.id === final.body.id)).toBe(false);
    expect((await call('parent', 'get', `/parent/children/${id(112)}/grades`)).body.items.some((v: { id: string }) => v.id === final.body.id)).toBe(false);
    expect((await action(b.assessmentId, 'release')).body.status).toBe('RESULTS_RELEASED');
    const released = await call('student', 'get', `/submissions/${final.body.id}`);
    expect(released.body).toMatchObject({ status: 'GRADED', score: 5, feedback: 'Reviewed feedback', resultsReleased: true });
    const parent = await call('parent', 'get', `/parent/children/${id(112)}/grades?search=${encodeURIComponent(opened.body.title)}`);
    expect(parent.body.items[0].submission.score).toBe(5);
    expect((await call('teacher', 'post', `/submissions/${final.body.id}/grade`, marks(b.rows))).status).toBe(409);
  });

  it('allows draft edits, clearable dates, ordered question replacement and safe unpublish', async () => {
    const b = await build({}, 2);
    expect((await call('teacher', 'patch', `/assessments/${b.assessmentId}`, { title: 'Updated title', type: 'ASSIGNMENT', instructions: 'تعليمات بالعربية', opensAt: null, dueAt: null })).body.title).toBe('Updated title');
    const reordered = await call('teacher', 'put', `/assessments/${b.assessmentId}/questions`, { questions: [{ questionId: b.rows[1].id, order: 0 }, { questionId: b.rows[0].id, order: 1 }] });
    expect(reordered.body.questions.map((q: { id: string }) => q.id)).toEqual([b.rows[1].id, b.rows[0].id]);
    await action(b.assessmentId, 'publish');
    expect((await call('teacher', 'patch', `/assessments/${b.assessmentId}`, { title: 'Blocked' })).status).toBe(409);
    expect((await call('teacher', 'put', `/assessments/${b.assessmentId}/questions`, { questions: [] })).status).toBe(409);
    expect((await action(b.assessmentId, 'unpublish')).body.status).toBe('DRAFT');
    expect((await call('student', 'get', `/assessments/${b.assessmentId}`)).status).toBe(404);
    expect((await call('teacher', 'patch', `/questions/${b.rows[0].id}`, { text: 'Editable after unpublish' })).status).toBe(200);
  });

  it('locks real referenced questions after publication and blocks unpublish after a draft exists', async () => {
    const b = await build(); await action(b.assessmentId, 'publish');
    expect((await call('teacher', 'patch', `/questions/${b.rows[0].id}`, { points: 99 })).status).toBe(409);
    await call('student', 'put', `/assessments/${b.assessmentId}/submission`, { answers: [] });
    expect((await action(b.assessmentId, 'unpublish')).status).toBe(409);
  });

  it('rejects empty publication, invalid deadlines, null scalar fields and invented lifecycle fields', async () => {
    const b = await build({}, 0);
    expect((await action(b.assessmentId, 'publish')).status).toBe(400);
    const base = { sectionSubjectId: id(405), type: 'EXAM', title: 'Invalid' };
    for (const extra of [{ title: null }, { type: null }, { schoolId: id(2) }, { status: 'OPEN' }, { opensAt: '2027-01-02T12:00:00' }, { opensAt: '2027-02-30T12:00:00Z' }, { opensAt: '2027-01-02T12:00:00Z', dueAt: '2027-01-01T12:00:00Z' }]) {
      expect((await call('teacher', 'post', '/assessments', { ...base, ...extra })).status).toBe(400);
    }
    for (const input of [{ title: null }, { type: null }, { sectionSubjectId: id(505) }, { resultsReleasedAt: new Date().toISOString() }]) {
      expect((await call('teacher', 'patch', `/assessments/${b.assessmentId}`, input)).status).toBe(400);
    }
    const past = await build({ dueAt: new Date(Date.now() - 1000).toISOString() });
    expect((await action(past.assessmentId, 'publish')).status).toBe(400);
  });

  it('enforces scheduled opening and deadline closure on reads, drafts and final submission', async () => {
    const start = Date.now();
    const b = await build({ opensAt: new Date(start + 30000).toISOString(), dueAt: new Date(start + 60000).toISOString() });
    expect((await action(b.assessmentId, 'publish')).body.status).toBe('SCHEDULED');
    expect((await call('student', 'get', `/assessments/${b.assessmentId}`)).body.questions).toEqual([]);
    expect((await call('student', 'get', `/student/questions/${b.rows[0].id}`)).status).toBe(404);
    expect((await call('student', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows))).status).toBe(409);
    expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows))).status).toBe(409);
    clock(start + 30000);
    expect((await call('student', 'get', `/assessments/${b.assessmentId}`)).body.status).toBe('OPEN');
    expect((await call('student', 'get', `/student/questions/${b.rows[0].id}`)).status).toBe(200);
    expect((await call('student', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows))).status).toBe(200);
    jest.setSystemTime(start + 60000);
    const closed = await call('student', 'get', `/assessments/${b.assessmentId}`);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.questions).toHaveLength(1);
    expect((await call('student', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows))).status).toBe(409);
    expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows))).status).toBe(409);
    expect((await action(b.assessmentId, 'start-grading')).body.status).toBe('GRADING');
  });

  it('keeps invalid answer changes atomic and validates choices, text, uniqueness and server-owned fields', async () => {
    const b = await build(); await action(b.assessmentId, 'publish');
    const saved = await call('student', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows));
    for (const input of [
      { answers: [{ questionId: b.rows[0].id, optionId: id(731) }] },
      { answers: [{ questionId: id(712), optionId: id(740) }] },
      { answers: [{ questionId: b.rows[0].id, text: 'Spoofed' }] },
      { answers: [{ ...answers(b.rows).answers[0], score: 2 }] },
      { answers: [answers(b.rows).answers[0], answers(b.rows).answers[0]] },
      { ...answers(b.rows), studentId: peerStudentId },
      { answers: null }, { answers: [null] },
    ]) expect((await call('student', 'put', `/assessments/${b.assessmentId}/submission`, input)).status).toBe(400);
    expect((await call('student', 'get', `/assessments/${b.assessmentId}/submission`)).body).toEqual(saved.body);
    const cleared = await call('student', 'put', `/assessments/${b.assessmentId}/submission`, { answers: [] });
    expect(cleared.body.answers).toEqual([]);
    expect(cleared.body.id).toBe(saved.body.id);
  });

  it('supports written and file metadata responses while hiding short-answer model answers', async () => {
    const b = await build({}, 0);
    const qs = [];
    for (const type of ['SHORT_ANSWER', 'ESSAY', 'FILE_UPLOAD']) {
      const q = await call('teacher', 'post', `/question-banks/${id(701)}/questions`, { type, text: type, options: type === 'SHORT_ANSWER' ? [{ text: 'SECRET_MODEL_ANSWER', isCorrect: true }] : [] });
      expect(q.status).toBe(201); qs.push(q.body);
    }
    await call('teacher', 'put', `/assessments/${b.assessmentId}/questions`, { questions: qs.map((q, i) => ({ questionId: q.id, order: i })) });
    await action(b.assessmentId, 'publish');
    const detail = await call('student', 'get', `/assessments/${b.assessmentId}`);
    expect(detail.body.questions[0].options).toEqual([]);
    expect(JSON.stringify(detail.body)).not.toContain('SECRET_MODEL_ANSWER');
    expect(JSON.stringify((await call('student', 'get', `/student/questions/${qs[0].id}`)).body)).not.toContain('SECRET_MODEL_ANSWER');
    const values = [{ questionId: qs[0].id, text: 'My answer' }, { questionId: qs[1].id, text: 'My essay' }, { questionId: qs[2].id, fileKey: `schools/${id(1)}/students/${id(112)}/answer.pdf` }];
    for (const key of [`schools/${id(2)}/students/${id(112)}/x.pdf`, `schools/${id(1)}/students/${peerStudentId}/x.pdf`, `schools/${id(1)}/students/${id(112)}/../x.pdf`]) {
      expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, { answers: [...values.slice(0, 2), { questionId: qs[2].id, fileKey: key }] })).status).toBe(400);
    }
    expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, { answers: [{ ...values[0], text: ' ' }, ...values.slice(1)] })).status).toBe(400);
    const submitted = await call('student', 'post', `/assessments/${b.assessmentId}/submit`, { answers: values });
    expect(submitted.status).toBe(200);
    expect(submitted.body.answers.map((a: { response: string | null }) => a.response)).toEqual(['My answer', 'My essay', null]);
  });

  it('prevents duplicate final submissions under concurrent requests and later edits', async () => {
    const b = await build(); await action(b.assessmentId, 'publish');
    const results = await Promise.all([1, 2].map(() => call('student', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows))));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await call('teacher', 'get', `/assessments/${b.assessmentId}/submissions`)).body.total).toBe(1);
    expect((await call('student', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows))).status).toBe(409);
  });

  it('rejects premature, incomplete and excessive grading without changing saved marks', async () => {
    const b = await submitted('student', {}, 2);
    const grade = `/submissions/${b.submissionId}/grade`;
    expect((await call('teacher', 'post', grade, marks(b.rows))).status).toBe(409);
    await action(b.assessmentId, 'close');
    for (const input of [
      { answers: marks(b.rows).answers.slice(0, 1) },
      { answers: [{ questionId: b.rows[0].id, score: 99 }, marks(b.rows).answers[1]] },
      { answers: [{ questionId: b.rows[0].id, score: -1 }, marks(b.rows).answers[1]] },
      { answers: [{ questionId: b.rows[0].id, score: null }, marks(b.rows).answers[1]] },
      { answers: [{ questionId: b.rows[0].id, score: '2' }, marks(b.rows).answers[1]] },
      { answers: [marks(b.rows).answers[0], marks(b.rows).answers[0]] },
    ]) expect((await call('teacher', 'post', grade, input)).status).toBe(400);
    expect((await call('teacher', 'get', `/submissions/${b.submissionId}`)).body.score).toBeNull();
    expect((await call('teacher', 'post', grade, marks(b.rows))).body.score).toBe(5);
    expect((await call('teacher', 'post', grade, { answers: [{ questionId: b.rows[0].id, score: 999 }, marks(b.rows).answers[1]] })).status).toBe(400);
    expect((await call('teacher', 'get', `/submissions/${b.submissionId}`)).body.score).toBe(5);
  });

  it('requires every final submission to be graded before releasing the assessment', async () => {
    const b = await submitted();
    const second = await call('peerStudent', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows));
    await action(b.assessmentId, 'close');
    await call('teacher', 'post', `/submissions/${b.submissionId}/grade`, marks(b.rows));
    expect((await action(b.assessmentId, 'release')).status).toBe(409);
    expect((await call('student', 'get', `/submissions/${b.submissionId}`)).body.score).toBeNull();
    await call('teacher', 'post', `/submissions/${second.body.id}/grade`, marks(b.rows));
    expect((await action(b.assessmentId, 'release')).status).toBe(200);
  });

  it('does not treat abandoned drafts as final submissions for result release', async () => {
    const b = await submitted();
    await call('peerStudent', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows));
    await action(b.assessmentId, 'close');
    await call('teacher', 'post', `/submissions/${b.submissionId}/grade`, marks(b.rows));
    expect((await action(b.assessmentId, 'release')).status).toBe(200);
    expect((await call('peerStudent', 'get', `/assessments/${b.assessmentId}/submission`)).body).toMatchObject({ status: 'IN_PROGRESS', score: null });
  });

  it('keeps archived released results readable and immutable', async () => {
    const b = await graded(); await action(b.assessmentId, 'release');
    expect((await action(b.assessmentId, 'archive')).body.status).toBe('ARCHIVED');
    expect((await call('student', 'get', `/submissions/${b.submissionId}`)).body.score).toBe(2);
    expect((await call('teacher', 'post', `/submissions/${b.submissionId}/grade`, marks(b.rows))).status).toBe(409);
    expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows))).status).toBe(409);
    expect((await call('teacher', 'patch', `/questions/${b.rows[0].id}`, { text: 'Change history' })).status).toBe(409);
  });

  it('enforces teacher ownership and read-only school admin access', async () => {
    const b = await build();
    for (const who of ['student', 'admin', 'parent', 'platform'] as const) {
      expect((await call(who, 'post', '/assessments', { sectionSubjectId: id(405), type: 'EXAM', title: 'Forbidden' })).status).toBe(403);
      expect((await call(who, 'patch', `/assessments/${b.assessmentId}`, { title: 'Forbidden' })).status).toBe(403);
      for (const name of ['publish', 'unpublish', 'close', 'start-grading', 'release', 'archive']) expect((await call(who, 'post', `/assessments/${b.assessmentId}/${name}`)).status).toBe(403);
    }
    expect((await call('peerTeacher', 'get', `/assessments/${b.assessmentId}`)).status).toBe(404);
    expect((await call('peerTeacher', 'patch', `/assessments/${b.assessmentId}`, { title: 'Forbidden' })).status).toBe(404);
    expect((await call('admin', 'get', `/assessments/${b.assessmentId}`)).status).toBe(200);
  });

  it('isolates every assessment read and mutation across schools', async () => {
    const b = await build();
    for (const method of ['get', 'patch', 'put'] as const) {
      const path = `/assessments/${b.assessmentId}${method === 'put' ? '/questions' : ''}`;
      expect((await call('otherTeacher', method, path, method === 'patch' ? { title: 'No' } : method === 'put' ? { questions: [] } : undefined)).status).toBe(404);
    }
    for (const name of ['publish', 'unpublish', 'close', 'start-grading', 'release', 'archive']) expect((await call('otherTeacher', 'post', `/assessments/${b.assessmentId}/${name}`)).status).toBe(404);
    expect((await call('otherTeacher', 'get', `/assessments/${b.assessmentId}/submissions`)).status).toBe(404);
    expect((await call('teacher', 'post', '/assessments', { sectionSubjectId: id(505), type: 'EXAM', title: 'Cross-school' })).status).toBe(404);
    await action(b.assessmentId, 'publish');
    expect((await call('otherStudent', 'get', `/assessments/${b.assessmentId}`)).status).toBe(404);
    expect((await call('otherStudent', 'get', `/assessments/${b.assessmentId}/submission`)).status).toBe(404);
    expect((await call('otherStudent', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows))).status).toBe(404);
    expect((await call('otherStudent', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows))).status).toBe(404);
    const list = await call('otherStudent', 'get', '/assessments?limit=100');
    expect(list.body.items.every((a: { schoolId: string }) => a.schoolId === id(2))).toBe(true);
  });

  it('hides a peer submission and rejects unauthorized grading and staff draft access', async () => {
    const b = await submitted();
    for (const who of ['peerStudent', 'otherStudent', 'peerTeacher', 'otherTeacher'] as const) expect((await call(who, 'get', `/submissions/${b.submissionId}`)).status).toBe(404);
    for (const who of ['student', 'admin', 'parent', 'platform'] as const) expect((await call(who, 'post', `/submissions/${b.submissionId}/grade`, marks(b.rows))).status).toBe(403);
    for (const who of ['peerTeacher', 'otherTeacher'] as const) expect((await call(who, 'post', `/submissions/${b.submissionId}/grade`, marks(b.rows))).status).toBe(404);
  });

  it('validates same-subject and same-school question links atomically', async () => {
    const b = await build();
    const before = await call('teacher', 'get', `/assessments/${b.assessmentId}`);
    const subject = await call('admin', 'post', '/subjects', { nameAr: 'علوم', nameEn: 'Science' });
    const adminBank = await call('teacher', 'post', `/question-banks/${id(701)}/questions`, { type: 'ESSAY', text: 'Unused' });
    const q = b.rows[0];
    for (const questions of [[{ questionId: id(712), order: 0 }], [{ questionId: q.id, order: 0 }, { questionId: q.id, order: 1 }], [{ questionId: q.id, order: 0 }, { questionId: adminBank.body.id, order: 0 }]]) {
      const result = await call('teacher', 'put', `/assessments/${b.assessmentId}/questions`, { questions });
      expect([400, 404]).toContain(result.status);
    }
    const bank = await call('admin', 'post', '/question-banks', { subjectId: subject.body.id, ownerId: id(111), name: 'Not assigned' });
    expect(bank.status).toBe(400);
    expect((await call('admin', 'post', '/section-subjects', { sectionId: id(403), subjectId: subject.body.id, teacherId: id(111) })).status).toBe(201);
    const scienceBank = await call('teacher', 'post', '/question-banks', { subjectId: subject.body.id, name: 'Science' });
    expect(scienceBank.status).toBe(201);
    const scienceQuestion = await call('teacher', 'post', `/question-banks/${scienceBank.body.id}/questions`, { type: 'ESSAY', text: 'Science only' });
    expect((await call('teacher', 'put', `/assessments/${b.assessmentId}/questions`, { questions: [{ questionId: scienceQuestion.body.id, order: 0 }] })).status).toBe(404);
    expect((await call('teacher', 'get', `/assessments/${b.assessmentId}`)).body).toEqual(before.body);
  });

  it('rechecks parent links and supports the approved second school without switching roles', async () => {
    expect((await call('parent', 'get', `/parent/children/${id(122)}/grades?schoolId=${id(2)}`)).status).toBe(200);
    expect((await call('parent', 'get', `/parent/children/${peerStudentId}/grades`)).status).toBe(404);
    expect((await call('parent', 'get', `/parent/children/${id(112)}/grades?schoolId=${id(2)}`)).status).toBe(404);
    await call('admin', 'patch', `/parent-links/${id(601)}`, { status: 'REJECTED' });
    expect((await call('parent', 'get', `/parent/children/${id(112)}/grades`)).status).toBe(404);
    await call('admin', 'patch', `/parent-links/${id(601)}`, { status: 'VERIFIED' });
  });

  it('rechecks student enrollment and archived-year write restrictions', async () => {
    const b = await build(); await action(b.assessmentId, 'publish');
    await call('admin', 'patch', `/enrollments/${id(406)}`, { status: 'WITHDRAWN' });
    expect((await call('student', 'get', `/assessments/${b.assessmentId}`)).status).toBe(404);
    expect((await call('student', 'post', `/assessments/${b.assessmentId}/submit`, answers(b.rows))).status).toBe(404);
    await call('admin', 'patch', `/enrollments/${id(406)}`, { status: 'ACTIVE' });
    await call('admin', 'patch', `/academic-years/${id(400)}`, { archived: true });
    expect((await action(b.assessmentId, 'close')).status).toBe(409);
    expect((await call('student', 'put', `/assessments/${b.assessmentId}/submission`, answers(b.rows))).status).toBe(409);
    await call('admin', 'patch', `/academic-years/${id(400)}`, { archived: false });
  });

  it('rejects invalid lifecycle transitions and publishing results without any graded work', async () => {
    const b = await build();
    for (const name of ['close', 'start-grading', 'release', 'archive', 'unpublish']) expect((await action(b.assessmentId, name)).status).toBe(409);
    await action(b.assessmentId, 'publish');
    expect((await action(b.assessmentId, 'release')).status).toBe(409);
    await action(b.assessmentId, 'close');
    expect((await action(b.assessmentId, 'publish')).status).toBe(409);
    expect((await action(b.assessmentId, 'unpublish')).status).toBe(409);
    await action(b.assessmentId, 'start-grading');
    expect((await action(b.assessmentId, 'release')).status).toBe(409);
  });

  it('does not disclose unused draft-bank questions through the generic student endpoints', async () => {
    const b = await build();
    expect((await call('student', 'get', `/student/questions/${b.rows[0].id}`)).status).toBe(404);
    const list = await call('student', 'get', `/student/questions?questionBankId=${id(701)}&limit=100`);
    expect(list.body.items.some((q: { id: string }) => q.id === b.rows[0].id)).toBe(false);
  });

  it('rechecks reassigned teachers and suspended student memberships with existing tokens', async () => {
    const b = await build(); await action(b.assessmentId, 'publish');
    await call('admin', 'patch', `/section-subjects/${id(405)}`, { teacherId: null });
    expect((await action(b.assessmentId, 'close')).status).toBe(404);
    await call('admin', 'patch', `/section-subjects/${id(405)}`, { teacherId: id(111) });
    await call('admin', 'patch', `/memberships/${id(432)}`, { active: false });
    expect((await call('student', 'get', `/assessments/${b.assessmentId}`)).status).toBe(401);
    expect((await call('parent', 'get', `/parent/children/${id(112)}/grades`)).status).toBe(404);
    await call('admin', 'patch', `/memberships/${id(432)}`, { active: true });
  });

  it('documents all new DTOs in Swagger and exercises the shared typed client against HTTP', async () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    expect(document.paths['/api/v1/assessments/{id}/submit'].post?.requestBody).toBeDefined();
    expect(document.components?.schemas?.AssessmentDetailResponse).toBeDefined();
    expect(document.components?.schemas?.SubmissionResponse).toBeDefined();
    const address = app.getHttpServer().address();
    const client = new WaslClient(`http://127.0.0.1:${address.port}/api/v1`, () => tokens.teacher.replace('Bearer ', ''));
    const a = await client.createAssessment({ sectionSubjectId: id(405), type: 'ASSIGNMENT', title: 'Typed client test' });
    const detail = await client.assessment(a.id);
    expect(detail.title).toBe('Typed client test');
    const found = await client.assessments({ search: 'Typed client test', limit: 1 });
    expect(found.total).toBe(1);
  });
});
