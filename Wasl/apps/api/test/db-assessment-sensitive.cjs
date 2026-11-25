// Run against a marker-verified PostgreSQL 17 disposable lab only.
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { PrismaStorage } = require('../src/foundation/prisma.adapter');
const { FoundationService } = require('../src/foundation/foundation.service');
const { LearningService } = require('../src/foundation/learning.service');
const { AssessmentService } = require('../src/foundation/assessment.service');

const roles = { tenant: 'wasl_tenant', auth: 'wasl_auth', platform: 'wasl_platform', academicAdmin: 'wasl_academic_admin', assessmentStaff: 'wasl_assessment_staff' };
const denied = e => e.meta?.code === '42501';
const notFound = e => e.getStatus?.() === 404;

test('assessment keys and grades have a database-enforced boundary', async t => {
  const urls = { tenant: process.env.DATABASE_URL, auth: process.env.AUTH_DATABASE_URL, platform: process.env.PLATFORM_DATABASE_URL,
    academicAdmin: process.env.ACADEMIC_ADMIN_DATABASE_URL, assessmentStaff: process.env.ASSESSMENT_STAFF_DATABASE_URL };
  const marker = process.env.WASL_LAB_ID;
  assert.ok(/^wasl-pg17-lab-[a-f0-9]{10}$/.test(marker ?? '') && !process.env.MIGRATION_DATABASE_URL);
  const ports = new Set();
  for (const [name, value] of Object.entries(urls)) {
    const parsed = new URL(value);
    assert.ok(parsed.protocol === 'postgresql:' && parsed.hostname === '127.0.0.1' && +parsed.port > 1024 && !['5432', '5433'].includes(parsed.port) &&
      parsed.pathname === '/wasl_db02_disposable' && parsed.username === roles[name] && !!parsed.password && parsed.search === '?schema=public' && !parsed.hash);
    ports.add(parsed.port);
  }
  assert.equal(ports.size, 1);
  const key = Buffer.from(process.env.WASL_SUBJECT_PROOF_KEY ?? '', 'hex');
  assert.equal(key.length, 32);
  function client(value) {
    const parsed = new URL(value);
    parsed.searchParams.set('connection_limit', '1');
    const db = new PrismaClient({ datasources: { db: { url: parsed.href } } });
    t.after(() => db.$disconnect());
    return db;
  }
  const clients = Object.fromEntries(Object.entries(urls).map(([name, url]) => [name, client(url)]));
  for (const [name, db] of Object.entries(clients)) {
    const [identity] = await db.$queryRaw`SELECT current_database() = 'wasl_db02_disposable' AND current_user::text = ${roles[name]}
      AND pg_catalog.pg_get_userbyid(datdba) = 'wasl_migrate' AND pg_catalog.shobj_description(oid, 'pg_database') = ${marker}
      AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AS valid
      FROM pg_catalog.pg_database WHERE datname = current_database()`;
    assert.equal(identity.valid, true);
  }
  const db = clients.tenant;
  const other = client(urls.tenant);
  const [platform] = await db.$queryRaw`SELECT m.id AS "membershipId", m.user_id AS sub, u.email, 'PLATFORM_ADMIN' AS role,
    NULL::uuid AS "schoolId" FROM public.memberships m JOIN public.users u ON u.id = m.user_id WHERE m.role = 'PLATFORM_ADMIN' LIMIT 1`;
  const storage = await PrismaStorage.open(urls, key);
  t.after(() => storage.onModuleDestroy());
  const foundation = new FoundationService(storage);
  const learning = new LearningService(storage);
  const grading = new AssessmentService(storage);
  const password = randomUUID();
  const email = () => `fictional-${randomUUID()}@wasl.test`;
  const actor = ({ user, membership }) => ({ sub: user.id, email: user.email, role: membership.role, schoolId: membership.schoolId, membershipId: membership.id });
  async function fixtures(name) {
    const school = await foundation.createSchool(platform, { name });
    const admin = actor(await foundation.provisionAdministrator(platform, school.id, { email: email(), fullName: 'Fictional Admin', password }));
    const create = async role => actor(await foundation.createUser(admin, { email: email(), fullName: `Fictional ${role}`, password, role }));
    const teacher = await create('TEACHER');
    const student = await create('STUDENT');
    const parent = await create('PARENT');
    const link = await foundation.createLink(admin, { parentId: parent.sub, studentId: student.sub });
    await foundation.linkStatus(admin, link.id, 'VERIFIED');
    const year = await foundation.saveAcademic(admin, 'academicYears', { name: 'Fictional Year', startDate: '2026-01-01', endDate: '2027-01-01' });
    const grade = await foundation.saveAcademic(admin, 'grades', { name: 'Fictional Grade', level: 8 });
    const section = await foundation.saveAcademic(admin, 'sections', { name: 'Fictional Section', gradeId: grade.id, academicYearId: year.id });
    const subject = await foundation.saveAcademic(admin, 'subjects', { nameEn: 'Fictional Subject', nameAr: 'Fictional Subject' });
    const unassigned = await foundation.saveAcademic(admin, 'subjects', { nameEn: 'Unassigned Subject', nameAr: 'Unassigned Subject' });
    const assignment = await foundation.saveAcademic(admin, 'sectionSubjects', { sectionId: section.id, subjectId: subject.id, teacherId: teacher.sub });
    await foundation.saveAcademic(admin, 'enrollments', { sectionId: section.id, studentId: student.sub });
    const bank = await learning.createQuestionBank(teacher, { subjectId: subject.id, name: 'Fictional Bank' });
    const choice = await learning.createQuestion(teacher, bank.id, { type: 'MULTIPLE_CHOICE', text: 'Fictional prompt', points: 3,
      options: [{ text: 'Alpha', isCorrect: true }, { text: 'Beta', isCorrect: false }] });
    const short = await learning.createQuestion(teacher, bank.id, { type: 'SHORT_ANSWER', text: 'Fictional short answer', points: 2,
      options: [{ text: 'Fictional accepted answer', isCorrect: true }] });
    const assessment = await grading.create(teacher, { sectionSubjectId: assignment.id, type: 'ASSIGNMENT', title: 'Fictional work' });
    await grading.replaceQuestions(teacher, assessment.id, { questions: [{ questionId: choice.id, order: 0 }, { questionId: short.id, order: 1 }] });
    await grading.publish(teacher, assessment.id);
    return { school, teacher, student, parent, unassigned, choice, short, assessment };
  }
  const a = await fixtures('Fictional Alpha');
  const b = await fixtures('Fictional Beta');
  const page = { page: 1, limit: 100 };
  const readGrade = (tx, id) => tx.$queryRaw`SELECT * FROM wasl_assessment.released_grade(${id}::uuid)`;
  const install = (tx, p) => tx.$queryRaw`SELECT set_config('app.assessment_proof', ${p.payload}, true) IS NOT NULL,
    set_config('app.assessment_tag', ${p.tag}, true) IS NOT NULL`;
  async function proof(tx, who, target, operation, options = {}) {
    const [binding] = await tx.$queryRaw`SELECT oid::text AS database, pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid,
      session_user::text AS login FROM pg_catalog.pg_database WHERE datname = current_database()`;
    const payload = JSON.stringify([binding.database, binding.pid, binding.xid, binding.login, options.expires ?? Date.now() + 15000,
      options.actor ?? who.sub, who.membershipId, options.school ?? who.schoolId, `assessment:${operation}`, target]);
    return { payload, tag: createHmac('sha256', key).update(payload).digest('hex') };
  }

  await t.test('the tenant cannot retrieve keys or write protected columns or release state', async () => {
    for (const run of [
      () => db.$queryRaw`SELECT is_correct FROM public.question_options`,
      () => db.$queryRaw`SELECT o.text FROM public.questions q JOIN public.question_options o ON q.id = o.question_id`,
      () => db.$executeRaw`UPDATE public.question_options SET is_correct = true WHERE false`,
      () => db.$queryRaw`SELECT s.score, a.score FROM public.submissions s JOIN public.answers a ON a.submission_id = s.id`,
      () => db.$queryRaw`SELECT feedback, graded_at FROM public.submissions`,
      () => db.$executeRaw`UPDATE public.submissions SET score = 100 WHERE false`,
      () => db.$executeRaw`UPDATE public.answers SET score = 100 WHERE false`,
      () => db.$executeRaw`UPDATE public.assessments SET results_released_at = CURRENT_TIMESTAMP WHERE false`,
      () => db.$executeRaw`SET ROLE wasl_assessment_staff`,
    ]) await assert.rejects(run(), denied);
    await assert.rejects(clients.assessmentStaff.$queryRaw`SELECT password_hash FROM public.users`, denied);
    await assert.rejects(clients.assessmentStaff.$queryRaw`SELECT token_hash FROM public.refresh_tokens`, denied);
    await assert.rejects(clients.auth.$queryRaw`SELECT is_correct FROM public.question_options`, denied);
    assert.deepEqual(await db.$queryRaw`SELECT text FROM wasl_assessment.learner_options WHERE question_id = ${a.short.id}::uuid`, []);
    const delivered = await grading.get(a.student, a.assessment.id);
    assert.equal(delivered.questions.find(q => q.id === a.choice.id).options.length, 2);
    assert.ok(delivered.questions.every(q => q.options.every(o => !('isCorrect' in o))));
    assert.deepEqual(delivered.questions.find(q => q.id === a.short.id).options, []);
    assert.ok((await learning.getQuestion(a.teacher, a.choice.id)).options.some(o => o.isCorrect));
    await assert.rejects(learning.getQuestion(b.teacher, a.choice.id), notFound);
  });

  await t.test('question-bank creation conceals unassigned, foreign and nonexistent subjects alike', async () => {
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('../src/app.module');
    const { configureApp } = require('../src/setup');
    const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    try {
      configureApp(app);
      await app.listen(0, '127.0.0.1');
      const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
      const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: a.teacher.email, password }) });
      assert.equal(login.status, 200);
      const { accessToken } = await login.json();
      for (const subjectId of [a.unassigned.id, b.unassigned.id, randomUUID()]) {
        const response = await fetch(`${base}/question-banks`, { method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ subjectId, name: 'Fictional attempt' }) });
        assert.equal(response.status, 404);
        assert.equal((await response.json()).message, 'Record not found');
      }
    } finally {
      await app.close();
    }
  });

  await t.test('draft, final submission and grading work while drafts and grades resist SQL tampering', async () => {
    const request = { answers: [{ questionId: a.choice.id, optionId: a.choice.options[0].id }, { questionId: a.short.id, text: 'Fictional reply' }] };
    const draft = await grading.save(a.student, a.assessment.id, request, false);
    assert.equal(draft.status, 'IN_PROGRESS');
    assert.equal(await db.$executeRaw`DELETE FROM public.answers WHERE submission_id = ${draft.id}::uuid`, 0);
    await assert.rejects(db.$transaction(async tx => {
      await install(tx, await proof(tx, a.student, a.assessment.id, 'draft'));
      return tx.$executeRaw`UPDATE public.submissions SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP WHERE id = ${draft.id}::uuid`;
    }), denied);
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, b.student, a.assessment.id, 'submit'));
      assert.equal(await tx.$executeRaw`DELETE FROM public.answers WHERE submission_id = ${draft.id}::uuid`, 0);
    });
    const rollback = new Error('Fictional rollback');
    await assert.rejects(db.$transaction(async tx => {
      await install(tx, await proof(tx, a.student, a.assessment.id, 'draft'));
      assert.equal(await tx.$executeRaw`DELETE FROM public.answers WHERE submission_id = ${draft.id}::uuid`, 2);
      throw rollback;
    }), e => e === rollback);
    assert.equal((await grading.ownSubmission(a.student, a.assessment.id)).answers.length, 2);
    assert.equal((await grading.save(a.student, a.assessment.id, request, true)).status, 'SUBMITTED');
    await grading.transition(a.teacher, a.assessment.id, 'close');
    const graded = await grading.grade(a.teacher, draft.id, { answers: [{ questionId: a.choice.id, score: 3 }, { questionId: a.short.id, score: 1 }], feedback: 'Fictional feedback' });
    assert.equal(graded.score, 4);
    assert.equal((await grading.ownSubmission(a.student, a.assessment.id)).score, null);
    let captured;
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, a.student, a.student.sub, 'results'));
      assert.deepEqual(await readGrade(tx, draft.id), []);
    });
    assert.equal((await grading.childResults(a.parent, a.student.sub, page)).total, 0);
    await grading.transition(a.teacher, a.assessment.id, 'release');
    assert.equal((await grading.ownSubmission(a.student, a.assessment.id)).score, 4);
    assert.equal((await grading.childResults(a.parent, a.student.sub, page)).items[0].submission.feedback, 'Fictional feedback');
    assert.equal(await db.$executeRaw`DELETE FROM public.answers WHERE submission_id = ${draft.id}::uuid`, 0);

    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.school_id', ${a.school.id}, true), set_config('app.user_id', ${a.student.sub}, true), set_config('app.bypass_rls', 'on', true)`;
      assert.deepEqual(await readGrade(tx, draft.id), []);
      const valid = await proof(tx, a.student, a.student.sub, 'results');
      captured = valid;
      for (const forged of [{ ...valid, tag: '0'.repeat(64) }, await proof(tx, a.student, a.student.sub, 'results', { expires: Date.now() - 500 }),
        await proof(tx, a.student, a.student.sub, 'results', { actor: b.student.sub }), await proof(tx, a.student, a.student.sub, 'results', { school: b.school.id }),
        await proof(tx, b.student, a.student.sub, 'results')]) {
        await install(tx, forged);
        assert.deepEqual(await readGrade(tx, draft.id), []);
      }
      await install(tx, valid);
      assert.equal((await readGrade(tx, draft.id))[0].score, 4);
      await other.$transaction(async fresh => {
        await install(fresh, valid);
        assert.deepEqual(await readGrade(fresh, draft.id), []);
      });
    });
    await db.$transaction(async later => {
      await install(later, captured);
      assert.deepEqual(await readGrade(later, draft.id), []);
    });
  });
});
