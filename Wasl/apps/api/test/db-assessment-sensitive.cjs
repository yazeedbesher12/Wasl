// Run against a marker-verified PostgreSQL 17 disposable lab only.
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { PrismaStorage } = require('../src/foundation/prisma.adapter');
const { FoundationService } = require('../src/foundation/foundation.service');
const { LearningService } = require('../src/foundation/learning.service');
const { AssessmentService } = require('../src/foundation/assessment.service');
const { ContentService } = require('../src/foundation/content.service');
const { CommunicationService } = require('../src/foundation/communication.service');
const { FileService } = require('../src/files/file.service');

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
  const [platform] = await clients.platform.$queryRaw`SELECT m.id AS "membershipId", m.user_id AS sub, u.email, 'PLATFORM_ADMIN' AS role,
    NULL::uuid AS "schoolId" FROM public.memberships m JOIN public.users u ON u.id = m.user_id WHERE m.role = 'PLATFORM_ADMIN' LIMIT 1`;
  const storage = await PrismaStorage.open(urls, key);
  t.after(() => storage.onModuleDestroy());
  const foundation = new FoundationService(storage);
  const learning = new LearningService(storage);
  const grading = new AssessmentService(storage);
  const content = new ContentService(storage);
  const communication = new CommunicationService(storage);
  function temporaryFiles() {
    const objects = new Map();
    return new FileService(storage, { driver: 'local', put: async (key, bytes) => objects.set(key, bytes),
      get: async key => objects.get(key), remove: async key => objects.delete(key) });
  }
  const password = randomUUID();
  const email = () => `fictional-${randomUUID()}@wasl.test`;
  const actor = ({ user, membership }) => ({ sub: user.id, email: user.email, role: membership.role, schoolId: membership.schoolId, membershipId: membership.id });
  async function fixtures(name) {
    const school = await foundation.createSchool(platform, { name });
    const admin = actor(await foundation.provisionAdministrator(platform, school.id, { email: email(), fullName: 'Fictional Admin', password }));
    const create = async role => actor(await foundation.createUser(admin, { email: email(), fullName: `Fictional ${role}`, password, role }));
    const teacher = await create('TEACHER');
    const student = await create('STUDENT');
    const peer = await create('STUDENT');
    const unassignedTeacher = await create('TEACHER');
    const parent = await create('PARENT');
    const link = await foundation.createLink(admin, { parentId: parent.sub, studentId: student.sub });
    await foundation.linkStatus(admin, link.id, 'VERIFIED');
    const year = await foundation.saveAcademic(admin, 'academicYears', { name: 'Fictional Year', startDate: '2026-01-01', endDate: '2027-01-01' });
    const grade = await foundation.saveAcademic(admin, 'grades', { name: 'Fictional Grade', level: 8 });
    const section = await foundation.saveAcademic(admin, 'sections', { name: 'Fictional Section', gradeId: grade.id, academicYearId: year.id });
    const subject = await foundation.saveAcademic(admin, 'subjects', { nameEn: 'Fictional Subject', nameAr: 'Fictional Subject' });
    const unassigned = await foundation.saveAcademic(admin, 'subjects', { nameEn: 'Unassigned Subject', nameAr: 'Unassigned Subject' });
    const assignment = await foundation.saveAcademic(admin, 'sectionSubjects', { sectionId: section.id, subjectId: subject.id, teacherId: teacher.sub });
    const enrollment = await foundation.saveAcademic(admin, 'enrollments', { sectionId: section.id, studentId: student.sub });
    const peerEnrollment = await foundation.saveAcademic(admin, 'enrollments', { sectionId: section.id, studentId: peer.sub });
    const semester = await foundation.saveAcademic(admin, 'semesters', { academicYearId: year.id, name: 'Fictional Semester', startDate: '2026-01-01', endDate: '2026-07-01' });
    const bank = await learning.createQuestionBank(teacher, { subjectId: subject.id, name: 'Fictional Bank' });
    const choice = await learning.createQuestion(teacher, bank.id, { type: 'MULTIPLE_CHOICE', text: 'Fictional prompt', points: 3,
      options: [{ text: 'Alpha', isCorrect: true }, { text: 'Beta', isCorrect: false }] });
    const short = await learning.createQuestion(teacher, bank.id, { type: 'SHORT_ANSWER', text: 'Fictional short answer', points: 2,
      options: [{ text: 'Fictional accepted answer', isCorrect: true }] });
    const assessment = await grading.create(teacher, { sectionSubjectId: assignment.id, type: 'ASSIGNMENT', title: 'Fictional work' });
    await grading.replaceQuestions(teacher, assessment.id, { questions: [{ questionId: choice.id, order: 0 }, { questionId: short.id, order: 1 }] });
    await grading.publish(teacher, assessment.id);
    return { school, admin, teacher, unassignedTeacher, student, peer, parent, link, year, semester, grade, section, enrollment, peerEnrollment, assignment, unassigned, choice, short, assessment };
  }
  const a = await fixtures('Fictional Alpha');
  const b = await fixtures('Fictional Beta');
  const page = { page: 1, limit: 100 };
  const readGrade = (tx, id) => tx.$queryRaw`SELECT * FROM wasl_assessment.released_grade(${id}::uuid)`;
  const install = (tx, p) => tx.$queryRaw`SELECT set_config('app.assessment_proof', ${p.payload}, true) IS NOT NULL,
    set_config('app.assessment_tag', ${p.tag}, true) IS NOT NULL`;
  async function proof(tx, who, target, operation, options = {}) {
    const [binding] = await tx.$queryRaw`SELECT oid::text AS database, pg_backend_pid() AS pid, pg_current_xact_id()::text AS xid,
      session_user::text AS login, (extract(epoch FROM statement_timestamp()) * 1000)::float8 AS "databaseNow"
      FROM pg_catalog.pg_database WHERE datname = current_database()`;
    const expiry = options.expired ? Math.floor(binding.databaseNow) - 1000 : Date.now() + 15000;
    const payload = JSON.stringify([binding.database, binding.pid, binding.xid, binding.login, expiry,
      options.actor ?? who.sub, who.membershipId, options.school ?? who.schoolId, `assessment:${operation}`, target]);
    return { payload, tag: createHmac('sha256', key).update(payload).digest('hex') };
  }

  await t.test('directory names, contact fields and roster joins require the right relationship', async () => {
    const ids = rows => rows.map(row => row.id).sort();
    const names = tx => tx.$queryRaw`SELECT id, full_name FROM public.users`;
    const contacts = tx => tx.$queryRaw`SELECT id, email FROM wasl_directory.contact_profiles`;
    const scoped = (who, work) => db.$transaction(async tx => {
      await install(tx, await proof(tx, who, who.sub, 'read'));
      return work(tx);
    });
    assert.deepEqual(await names(db), []);
    assert.deepEqual(await contacts(db), []);
    await assert.rejects(db.$queryRaw`SELECT email FROM public.users`, denied);
    await assert.rejects(db.$queryRaw`SELECT * FROM wasl_directory.actor_scope()`, denied);
    await assert.rejects(db.$executeRaw`SET ROLE wasl_subject_verifier`, denied);
    await assert.rejects(db.$executeRaw`UPDATE public.users SET full_name = 'No' WHERE false`, denied);
    await assert.rejects(db.$executeRaw`UPDATE public.schools SET name = 'No' WHERE false`, denied);

    const roster = await foundation.roster(a.teacher, a.assignment.id, { page: 1, limit: 100 });
    assert.deepEqual(roster.items.map(item => item.student.id).sort(), [a.student.sub, a.peer.sub].sort());
    await scoped(a.teacher, async tx => {
      assert.deepEqual(ids(await names(tx)), [a.teacher.sub, a.student.sub, a.peer.sub].sort());
      assert.deepEqual(await contacts(tx), [{ id: a.teacher.sub, email: a.teacher.email }]);
      const joined = await tx.$queryRaw`SELECT u.id FROM public.users u JOIN public.memberships m ON m.user_id = u.id WHERE m.role = 'STUDENT'`;
      assert.deepEqual(ids(joined), [a.student.sub, a.peer.sub].sort());
    });
    await scoped(a.student, async tx => {
      assert.deepEqual(ids(await names(tx)), [a.student.sub, a.teacher.sub].sort());
      assert.deepEqual(await contacts(tx), [{ id: a.student.sub, email: a.student.email }]);
    });
    const adminUsers = await foundation.listUsers(a.admin, { page: 1, limit: 100 });
    assert.ok(adminUsers.items.some(row => row.id === a.student.sub && row.email === a.student.email));
    assert.ok(adminUsers.items.every(row => row.id !== b.student.sub));
    await scoped(a.admin, async tx => {
      const rows = await contacts(tx);
      assert.ok(rows.some(row => row.id === a.student.sub && row.email === a.student.email));
      assert.ok(rows.every(row => row.id !== b.student.sub && row.id !== b.admin.sub));
    });
  });

  await t.test('independent audit checks bank ownership and assessment workflow integrity', async t => {
    const rolledBack = new Error('Roll back independent audit fixture');
    async function auditWrite(actor, target, description, statement) {
      let outcome;
      try {
        await clients.assessmentStaff.$transaction(async tx => {
          await install(tx, await proof(tx, actor, target, 'staff-write'));
          outcome = (await statement(tx)) === 1 ? 'ALLOWED' : 'FILTERED';
          throw rolledBack;
        });
        assert.fail('The audit transaction must roll back');
      } catch (error) {
        if (error !== rolledBack) {
          assert.ok(['42501', '23503', '23514'].includes(error.meta?.code), error.message);
          outcome = `DENIED (${error.meta.code})`;
        }
      }
      t.diagnostic(`${description}: ${outcome}`);
      return outcome;
    }
    const bankId = randomUUID();
    const bankOwner = await auditWrite(a.admin, a.admin.sub, 'School administrator assigns a question bank to a foreign school teacher', tx => tx.$executeRaw`
      INSERT INTO public.question_banks (id, school_id, subject_id, owner_id, name)
      VALUES (${bankId}::uuid, ${a.school.id}::uuid, ${a.assignment.subjectId}::uuid, ${b.teacher.sub}::uuid, 'Fictional audit bank')`);
    assert.match(bankOwner, /^DENIED/);
    await assert.rejects(clients.academicAdmin.$transaction(async tx => {
      await install(tx, await proof(tx, a.admin, a.admin.sub, 'academic-write'));
      return tx.$executeRaw`INSERT INTO public.section_subjects (id, school_id, section_id, subject_id, teacher_id)
        VALUES (${randomUUID()}::uuid, ${a.school.id}::uuid, ${a.section.id}::uuid, ${a.unassigned.id}::uuid, ${b.teacher.sub}::uuid)`;
    }), denied);
    const broadWrite = await auditWrite(a.teacher, a.teacher.sub, 'Assigned teacher releases an open ungraded assessment through direct SQL', tx => tx.$executeRaw`
      UPDATE public.assessments SET status = 'RESULTS_RELEASED', results_released_at = CURRENT_TIMESTAMP
      WHERE id = ${a.assessment.id}::uuid`);
    assert.match(broadWrite, /^(DENIED|FILTERED)/);
    await assert.rejects(clients.assessmentStaff.$transaction(async tx => {
      await install(tx, await proof(tx, a.teacher, a.assessment.id, 'staff-release'));
      return tx.$executeRaw`UPDATE public.assessments SET status = 'RESULTS_RELEASED', results_released_at = CURRENT_TIMESTAMP
        WHERE id = ${a.assessment.id}::uuid`;
    }), denied);
    assert.equal((await grading.get(a.teacher, a.assessment.id)).status, 'OPEN');
  });

  await t.test('academic reads follow verified assignments, enrollments and parent links', async () => {
    const a = await fixtures('Fictional Academic Read Home');
    const b = await fixtures('Fictional Academic Read Partner');
    const read = tx => tx.$queryRaw`SELECT e.id FROM public.enrollments e JOIN public.sections s ON s.id = e.section_id
      JOIN public.grades g ON g.id = s.grade_id JOIN public.academic_years y ON y.id = s.academic_year_id
      JOIN public.semesters sem ON sem.academic_year_id = y.id WHERE sem.id IN (${a.semester.id}::uuid, ${b.semester.id}::uuid) ORDER BY e.id`;
    assert.deepEqual(await read(db), []);
    assert.deepEqual(await db.$queryRaw`SELECT id FROM public.memberships`, []);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.school_id', ${a.school.id}, true), set_config('app.user_id', ${a.student.sub}, true), set_config('app.bypass_rls', 'on', true)`;
      assert.deepEqual(await read(tx), []);
      await install(tx, await proof(tx, a.student, a.student.sub, 'read', { expired: true }));
      assert.deepEqual(await read(tx), []);
      const valid = await proof(tx, a.student, a.student.sub, 'read');
      await install(tx, valid);
      assert.deepEqual(await read(tx), [{ id: a.enrollment.id }]);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.memberships WHERE role = 'STUDENT'`, [{ id: a.student.membershipId }]);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.section_subjects`, [{ id: a.assignment.id }]);
      await other.$transaction(async second => { await install(second, valid); assert.deepEqual(await read(second), []); });
      await install(tx, await proof(tx, a.unassignedTeacher, a.unassignedTeacher.sub, 'read'));
      assert.deepEqual(await read(tx), []);
      await install(tx, await proof(tx, a.parent, a.student.sub, 'read'));
      assert.deepEqual(await read(tx), [{ id: a.enrollment.id }]);
      await install(tx, await proof(tx, a.parent, a.peer.sub, 'read'));
      assert.deepEqual(await read(tx), []);
    });
    const readAssignments = who => db.$transaction(async tx => {
      await install(tx, await proof(tx, who, who.sub, 'read'));
      return tx.$queryRaw`SELECT id FROM public.section_subjects WHERE id = ${a.assignment.id}::uuid`;
    });
    await foundation.saveAcademic(a.admin, 'sectionSubjects', { teacherId: null }, a.assignment.id);
    assert.deepEqual(await readAssignments(a.teacher), []);
    await foundation.saveAcademic(a.admin, 'sectionSubjects', { teacherId: a.teacher.sub }, a.assignment.id);
    await foundation.saveAcademic(a.admin, 'enrollments', { status: 'WITHDRAWN' }, a.enrollment.id);
    assert.deepEqual(await readAssignments(a.student), []);
    await foundation.saveAcademic(a.admin, 'enrollments', { status: 'ACTIVE' }, a.enrollment.id);
  });

  await t.test('academic writes require administrator proof, immutable school and same-school references', async () => {
    const academic = clients.academicAdmin;
    const code = expected => error => error.meta?.code === expected;
    const write = (fn) => academic.$transaction(async tx => {
      await install(tx, await proof(tx, a.admin, a.admin.sub, 'academic-write'));
      return fn(tx);
    });
    await assert.rejects(academic.$executeRaw`UPDATE public.grades SET school_id = ${b.school.id}::uuid WHERE id = ${a.grade.id}::uuid`, denied);
    await assert.rejects(write(tx => tx.$executeRaw`DELETE FROM public.sections WHERE id = ${b.section.id}::uuid`), denied);
    await assert.rejects(write(tx => tx.$executeRaw`INSERT INTO public.grades (id, school_id, name, level)
      VALUES (${randomUUID()}::uuid, ${b.school.id}::uuid, 'Foreign', 52)`), denied);
    assert.equal(await write(tx => tx.$executeRaw`UPDATE public.grades SET name = 'Foreign' WHERE id = ${b.grade.id}::uuid`), 0);
    await assert.rejects(write(tx => tx.$executeRaw`INSERT INTO public.sections (id, school_id, grade_id, academic_year_id, name)
      VALUES (${randomUUID()}::uuid, ${a.school.id}::uuid, ${b.grade.id}::uuid, ${a.year.id}::uuid, 'Foreign grade section')`), code('23503'));
    await assert.rejects(write(tx => tx.$executeRaw`UPDATE public.section_subjects SET teacher_id = ${b.teacher.sub}::uuid WHERE id = ${a.assignment.id}::uuid`), denied);
    const rollback = new Error('Fictional academic rollback');
    await assert.rejects(write(async tx => {
      assert.equal(await tx.$executeRaw`UPDATE public.academic_years SET archived = true WHERE id = ${a.year.id}::uuid`, 1);
      throw rollback;
    }), error => error === rollback);
    await foundation.saveAcademic(a.admin, 'academicYears', { archived: true }, a.year.id);
    await assert.rejects(write(tx => tx.$executeRaw`INSERT INTO public.sections (id, school_id, grade_id, academic_year_id, name)
      VALUES (${randomUUID()}::uuid, ${a.school.id}::uuid, ${a.grade.id}::uuid, ${a.year.id}::uuid, 'Archived year section')`), denied);
    await foundation.saveAcademic(a.admin, 'academicYears', { archived: false }, a.year.id);
  });

  await t.test('learning content follows verified assignment, publication and relationship scope', async () => {
    const unit = await content.createUnit(a.teacher, { sectionSubjectId: a.assignment.id, title: 'Fictional Unit' });
    const lesson = await content.createLesson(a.teacher, { unitId: unit.id, title: 'Fictional Lesson' });
    const resource = await learning.createResource(a.teacher, { lessonId: lesson.id, type: 'LINK', title: 'Fictional Resource', url: 'https://example.test/lesson' });
    const read = tx => tx.$queryRaw`SELECT r.id FROM public.resources r JOIN public.lessons l ON l.id = r.lesson_id
      JOIN public.units u ON u.id = l.unit_id WHERE r.id = ${resource.id}::uuid AND u.id = ${unit.id}::uuid`;
    const scoped = (actor, target, operation, work) => db.$transaction(async tx => {
      await install(tx, await proof(tx, actor, target, operation));
      return work(tx);
    });
    assert.deepEqual(await read(db), []);
    assert.deepEqual(await scoped(a.student, a.student.sub, 'read', read), []);
    assert.deepEqual(await scoped(a.unassignedTeacher, a.unassignedTeacher.sub, 'read', read), []);
    assert.deepEqual(await scoped(a.teacher, a.teacher.sub, 'read', read), [{ id: resource.id }]);
    assert.equal(await scoped(a.teacher, a.teacher.sub, 'read', tx => tx.$executeRaw`UPDATE public.units SET title = 'No' WHERE id = ${unit.id}::uuid`), 0);
    await assert.rejects(scoped(a.teacher, a.teacher.sub, 'content-write', tx => tx.$executeRaw`INSERT INTO public.units (id,school_id,section_subject_id,title)
      VALUES (${randomUUID()}::uuid,${a.school.id}::uuid,${b.assignment.id}::uuid,'Foreign class')`), denied);
    await assert.rejects(scoped(a.teacher, a.teacher.sub, 'content-write', tx => tx.$executeRaw`UPDATE public.lessons SET school_id = ${b.school.id}::uuid WHERE id = ${lesson.id}::uuid`), denied);
    await content.updateLesson(a.teacher, lesson.id, { status: 'PUBLISHED' });
    assert.deepEqual(await scoped(a.student, a.student.sub, 'read', read), [{ id: resource.id }]);
    assert.deepEqual(await scoped(b.student, b.student.sub, 'read', read), []);
    assert.deepEqual(await scoped(a.parent, a.peer.sub, 'read', read), []);
    assert.deepEqual(await scoped(a.parent, a.student.sub, 'read', read), [{ id: resource.id }]);
    await assert.rejects(scoped(a.teacher, a.teacher.sub, 'content-write', tx => tx.$executeRaw`UPDATE public.lessons SET title = 'No' WHERE id = ${lesson.id}::uuid`), denied);
    await content.updateLesson(a.teacher, lesson.id, { status: 'ARCHIVED' });
    assert.deepEqual(await scoped(a.student, a.student.sub, 'read', read), []);
    await foundation.saveAcademic(a.admin, 'academicYears', { archived: true }, a.year.id);
    await assert.rejects(scoped(a.teacher, a.teacher.sub, 'content-write', tx => tx.$executeRaw`INSERT INTO public.units (id,school_id,section_subject_id,title)
      VALUES (${randomUUID()}::uuid,${a.school.id}::uuid,${a.assignment.id}::uuid,'Archived class')`), denied);
    await foundation.saveAcademic(a.admin, 'academicYears', { archived: false }, a.year.id);
  });

  await t.test('files, announcement audiences and notification recipients ignore forged GUCs', async () => {
    const files = temporaryFiles();
    const unit = await content.createUnit(a.teacher, { sectionSubjectId: a.assignment.id, title: 'Fictional file unit' });
    const lesson = await content.createLesson(a.teacher, { unitId: unit.id, title: 'Fictional file lesson' });
    const bytes = Buffer.from('Fictional handout');
    const file = await files.upload(a.teacher, { purpose: 'LESSON_RESOURCE', lessonId: lesson.id }, {
      originalname: 'handout.txt', buffer: bytes, size: bytes.length, mimetype: 'text/plain',
    });
    await learning.createResource(a.teacher, { lessonId: lesson.id, type: 'FILE', title: 'Fictional handout', storageKey: file.storageKey });
    await assert.rejects(files.download(a.student, file.id), notFound);
    await content.updateLesson(a.teacher, lesson.id, { status: 'PUBLISHED' });
    assert.deepEqual((await files.download(a.student, file.id)).data, bytes);
    assert.deepEqual((await files.download(a.parent, file.id)).data, bytes);
    await assert.rejects(files.download(b.student, file.id), notFound);

    const announcement = await communication.create(a.teacher, { sectionSubjectId: a.assignment.id, title: 'Fictional notice', body: 'Fictional content' });
    await assert.rejects(communication.get(a.student, announcement.id), notFound);
    await communication.transition(a.teacher, announcement.id, 'publish');
    assert.equal((await communication.get(a.student, announcement.id)).id, announcement.id);
    await assert.rejects(communication.get(b.student, announcement.id), notFound);
    const query = { read: 'all', page: 1, limit: 100 };
    const notice = (await communication.notifications(a.student, query)).items.find(n => n.payload.entityId === announcement.id);
    const peerNotice = (await communication.notifications(a.peer, query)).items.find(n => n.payload.entityId === announcement.id);
    assert.ok(notice && peerNotice);
    assert.ok((await communication.markRead(a.student, notice.id)).readAt);
    await assert.rejects(communication.markRead(a.student, peerNotice.id), notFound);

    const raw = async tx => ({
      files: await tx.$queryRaw`SELECT id FROM public.file_objects WHERE id = ${file.id}::uuid`,
      announcements: await tx.$queryRaw`SELECT id FROM public.announcements WHERE id = ${announcement.id}::uuid`,
      notices: await tx.$queryRaw`SELECT id FROM public.notifications WHERE id IN (${notice.id}::uuid, ${peerNotice.id}::uuid)`,
    });
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.school_id', ${a.school.id}, true), set_config('app.user_id', ${a.student.sub}, true), set_config('app.bypass_rls', 'on', true)`;
      assert.deepEqual(await raw(tx), { files: [], announcements: [], notices: [] });
      await install(tx, await proof(tx, b.student, b.student.sub, 'metadata'));
      assert.deepEqual(await raw(tx), { files: [], announcements: [], notices: [] });
      await install(tx, await proof(tx, a.student, a.student.sub, 'metadata'));
      assert.deepEqual(await raw(tx), { files: [{ id: file.id }], announcements: [{ id: announcement.id }], notices: [{ id: notice.id }] });
      assert.equal(await tx.$executeRaw`UPDATE public.notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ${peerNotice.id}::uuid`, 0);
    });
    await assert.rejects(db.$transaction(async tx => {
      await install(tx, await proof(tx, a.student, a.student.sub, 'metadata'));
      return tx.$executeRaw`INSERT INTO public.notifications (id, school_id, user_id, type, payload)
        VALUES (${randomUUID()}::uuid, ${a.school.id}::uuid, ${a.peer.sub}::uuid, 'ANNOUNCEMENT_PUBLISHED',
        ${JSON.stringify({ entityId: announcement.id, sectionSubjectId: a.assignment.id, studentId: a.peer.sub })}::jsonb)`;
    }), denied);
    await communication.transition(a.teacher, announcement.id, 'archive');
    assert.ok(!(await communication.notifications(a.student, query)).items.some(n => n.id === notice.id));
  });

  await t.test('answer file metadata and bytes follow ownership, submission and parent release', async () => {
    const files = temporaryFiles();
    const bank = await learning.createQuestionBank(b.teacher, { subjectId: b.assignment.subjectId, name: 'Fictional File Bank' });
    const question = await learning.createQuestion(b.teacher, bank.id, { type: 'FILE_UPLOAD', text: 'Fictional file task', points: 2 });
    const assessment = await grading.create(b.teacher, { sectionSubjectId: b.assignment.id, type: 'ASSIGNMENT', title: 'Fictional file assessment' });
    await grading.replaceQuestions(b.teacher, assessment.id, { questions: [{ questionId: question.id, order: 0 }] });
    await grading.publish(b.teacher, assessment.id);
    const bytes = Buffer.from('Fictional answer');
    const file = await files.upload(b.student, { purpose: 'ASSESSMENT_ANSWER', assessmentId: assessment.id }, {
      originalname: 'answer.txt', buffer: bytes, size: bytes.length, mimetype: 'text/plain',
    });
    assert.deepEqual((await files.download(b.student, file.id)).data, bytes);
    await assert.rejects(files.metadata(b.peer, file.id), notFound);
    await assert.rejects(files.metadata(b.teacher, file.id), notFound);
    await assert.rejects(files.metadata(b.parent, file.id), notFound);

    await assert.rejects(db.$transaction(async tx => {
      await install(tx, await proof(tx, b.student, assessment.id, 'file-write'));
      return tx.$executeRaw`INSERT INTO public.file_objects
        (id, school_id, owner_id, purpose, assessment_id, storage_key, storage_driver, original_name, content_type, size, sha256)
        VALUES (${randomUUID()}::uuid, ${b.school.id}::uuid, ${b.student.sub}::uuid, 'ASSESSMENT_ANSWER', ${assessment.id}::uuid,
          '../fictional.txt', 'local', 'fictional.txt', 'text/plain', 1, ${'0'.repeat(64)})`;
    }), denied);
    const submitted = await grading.save(b.student, assessment.id, { answers: [{ questionId: question.id, fileKey: file.storageKey }] }, true);
    assert.deepEqual((await files.download(b.teacher, file.id)).data, bytes);
    await assert.rejects(files.metadata(b.parent, file.id), notFound);
    await grading.transition(b.teacher, assessment.id, 'close');
    await grading.grade(b.teacher, submitted.id, { answers: [{ questionId: question.id, score: 2 }] });
    await grading.transition(b.teacher, assessment.id, 'release');
    assert.deepEqual((await files.download(b.parent, file.id)).data, bytes);
    await assert.rejects(files.metadata(a.parent, file.id), notFound);
  });

  await t.test('learner rows require verified school, participant and publication scope', async () => {
    const a = await fixtures('Fictional Learner Read Home');
    const b = await fixtures('Fictional Learner Read Partner');
    const draftFor = (fixture, student) => grading.save(student, fixture.assessment.id, {
      answers: [{ questionId: fixture.short.id, text: 'Fictional private response' }],
    }, false);
    const own = await draftFor(a, a.student);
    const peer = await draftFor(a, a.peer);
    const foreign = await draftFor(b, b.student);
    const scheduled = await grading.create(a.teacher, { sectionSubjectId: a.assignment.id, type: 'ASSIGNMENT', title: 'Fictional Scheduled',
      opensAt: new Date(Date.now() + 3600000).toISOString() });
    const laterBank = await learning.createQuestionBank(a.teacher, { subjectId: (await foundation.getAcademic(a.admin, 'sectionSubjects', a.assignment.id)).subjectId,
      name: 'Fictional future bank' });
    const laterQuestion = await learning.createQuestion(a.teacher, laterBank.id, { type: 'MULTIPLE_CHOICE', text: 'Fictional future prompt', points: 2,
      options: [{ text: 'Fictional correct', isCorrect: true }, { text: 'Fictional alternative', isCorrect: false }] });
    await grading.replaceQuestions(a.teacher, scheduled.id, { questions: [{ questionId: laterQuestion.id, order: 0 }] });
    await grading.publish(a.teacher, scheduled.id);
    const summary = await grading.get(a.student, scheduled.id);
    assert.equal(summary.questionCount, 1);
    assert.equal(summary.totalPoints, 2);
    assert.deepEqual(summary.questions, []);

    const read = tx => tx.$queryRaw`SELECT s.id FROM public.submissions s JOIN public.answers ans
      ON ans.submission_id = s.id WHERE s.id IN (${own.id}::uuid, ${peer.id}::uuid, ${foreign.id}::uuid) AND ans.response IS NOT NULL`;
    assert.deepEqual(await read(db), []);
    assert.deepEqual(await db.$queryRaw`SELECT id FROM public.parent_student_links`, []);
    const rollback = new Error('Fictional isolation rollback');
    let captured;
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.school_id', ${a.school.id}, true), set_config('app.user_id', ${a.student.sub}, true), set_config('app.bypass_rls', 'on', true)`;
      assert.deepEqual(await read(tx), []);
      const bound = await proof(tx, a.student, a.assessment.id, 'draft');
      for (const invalid of [{ ...bound, tag: '0'.repeat(64) }, await proof(tx, a.student, a.assessment.id, 'draft', { expired: true }),
        await proof(tx, a.student, a.assessment.id, 'draft', { school: b.school.id }), await proof(tx, a.student, a.assessment.id, 'draft', { actor: a.peer.sub })]) {
        await install(tx, invalid);
        assert.deepEqual(await read(tx), []);
      }
      captured = bound;
      await install(tx, bound);
      assert.deepEqual(await read(tx), [{ id: own.id }]);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.assessments WHERE id = ${scheduled.id}::uuid`, []);
      const labels = await tx.$queryRaw`SELECT question_id AS id FROM wasl_assessment.learner_options WHERE question_id IN (${a.choice.id}::uuid, ${b.choice.id}::uuid, ${laterQuestion.id}::uuid)`;
      assert.deepEqual(labels.map(q => q.id), [a.choice.id, a.choice.id]);
      await other.$transaction(async fresh => { await install(fresh, bound); assert.deepEqual(await read(fresh), []); });
      throw rollback;
    }), error => error === rollback);
    await db.$transaction(async later => {
      await install(later, captured);
      assert.deepEqual(await read(later), []);
      await install(later, await proof(later, a.student, a.student.sub, 'read'));
      assert.deepEqual(await later.$queryRaw`SELECT id FROM public.questions WHERE id = ${laterQuestion.id}::uuid`, []);
    });

    await assert.rejects(db.$transaction(async tx => {
      await install(tx, await proof(tx, a.student, a.student.sub, 'read'));
      return tx.$queryRaw`SELECT o.is_correct FROM public.questions q JOIN public.question_options o ON o.question_id = q.id`;
    }), denied);
    const staff = clients.assessmentStaff;
    assert.deepEqual(await staff.$queryRaw`SELECT id FROM public.assessments`, []);
    await staff.$transaction(async tx => {
      await install(tx, await proof(tx, a.unassignedTeacher, a.unassignedTeacher.sub, 'staff-write'));
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.assessments WHERE id = ${a.assessment.id}::uuid`, []);
      assert.deepEqual(await tx.$queryRaw`SELECT response FROM public.answers WHERE submission_id = ${own.id}::uuid`, []);
      assert.equal(await tx.$executeRaw`UPDATE public.assessments SET title = 'Unauthorized' WHERE id = ${a.assessment.id}::uuid`, 0);
    });
  });

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
    }, { isolationLevel: 'Serializable' }), e => e === rollback);
    assert.equal((await grading.ownSubmission(a.student, a.assessment.id)).answers.length, 2);
    assert.equal((await grading.save(a.student, a.assessment.id, request, true)).status, 'SUBMITTED');
    await grading.transition(a.teacher, a.assessment.id, 'close');
    const staff = clients.assessmentStaff;
    await assert.rejects(staff.$transaction(async tx => {
      await install(tx, await proof(tx, a.teacher, a.assessment.id, 'staff-release'));
      return tx.$executeRaw`UPDATE public.assessments SET status = 'RESULTS_RELEASED', results_released_at = CURRENT_TIMESTAMP
        WHERE id = ${a.assessment.id}::uuid`;
    }), denied);
    await assert.rejects(staff.$transaction(async tx => {
      await install(tx, await proof(tx, a.teacher, draft.id, 'staff-grade'));
      return tx.$executeRaw`UPDATE public.answers SET response = '"Fictional replacement"'::jsonb WHERE submission_id = ${draft.id}::uuid`;
    }), denied);
    await assert.rejects(staff.$transaction(async tx => {
      await install(tx, await proof(tx, a.teacher, draft.id, 'staff-grade'));
      return tx.$executeRaw`UPDATE public.assessments SET status = 'RESULTS_RELEASED', results_released_at = CURRENT_TIMESTAMP WHERE id = ${a.assessment.id}::uuid`;
    }), denied);
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
      for (const forged of [{ ...valid, tag: '0'.repeat(64) }, await proof(tx, a.student, a.student.sub, 'results', { expired: true }),
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

  await t.test('released parent reads are bound to one verified child and stop after revocation', async () => {
    const a = await fixtures('Fictional Parent Release');
    const submitted = await grading.save(a.student, a.assessment.id, { answers: [
      { questionId: a.choice.id, optionId: a.choice.options[0].id },
      { questionId: a.short.id, text: 'Fictional reply' },
    ] }, true);
    await grading.transition(a.teacher, a.assessment.id, 'close');
    await grading.grade(a.teacher, submitted.id, { answers: [
      { questionId: a.choice.id, score: 3 }, { questionId: a.short.id, score: 1 },
    ] });
    await grading.transition(a.teacher, a.assessment.id, 'release');
    const released = await grading.ownSubmission(a.student, a.assessment.id);
    const read = tx => tx.$queryRaw`SELECT ans.id FROM public.answers ans WHERE ans.submission_id = ${released.id}::uuid`;
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, a.parent, a.peer.sub, 'results'));
      assert.deepEqual(await read(tx), []);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.parent_student_links`, []);
      await install(tx, await proof(tx, a.parent, a.student.sub, 'results'));
      assert.equal((await read(tx)).length, 2);
      assert.equal((await readGrade(tx, released.id))[0].score, 4);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.parent_student_links`, [{ id: a.link.id }]);
    });
    await foundation.linkStatus(a.admin, a.link.id, 'REJECTED');
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, a.parent, a.student.sub, 'results'));
      assert.deepEqual(await read(tx), []);
      assert.deepEqual(await readGrade(tx, released.id), []);
      assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.parent_student_links`, []);
    });
    await assert.rejects(grading.childResults(a.parent, a.student.sub, page), notFound);
  });

  await t.test('release waits for all final submissions in an independently prepared assessment', async () => {
    const f = await fixtures('Fictional Mixed Grades');
    const request = { answers: [
      { questionId: f.choice.id, optionId: f.choice.options[0].id },
      { questionId: f.short.id, text: 'Fictional reply' },
    ] };
    const first = await grading.save(f.student, f.assessment.id, request, true);
    const second = await grading.save(f.peer, f.assessment.id, request, true);
    await grading.transition(f.teacher, f.assessment.id, 'close');
    const marks = { answers: [
      { questionId: f.choice.id, score: 3 },
      { questionId: f.short.id, score: 1 },
    ] };
    const staff = clients.assessmentStaff;
    const serializable = { isolationLevel: 'Serializable' };
    const gradeRow = (tx, total) => tx.$executeRaw`
      UPDATE public.submissions SET status = 'GRADED', score = ${String(total)}::text::float8, graded_at = CURRENT_TIMESTAMP
      WHERE id = ${first.id}::uuid`;
    for (const scenario of [
      { scores: [3], total: 3 },
      { scores: [4, 1], total: 5 },
      { scores: [3, 1], total: 5 },
      { scores: [3, 1], total: Infinity },
      { scores: [3, 1], total: NaN },
    ]) {
      await assert.rejects(staff.$transaction(async tx => {
        await install(tx, await proof(tx, f.teacher, first.id, 'staff-grade'));
        for (const [i, score] of scenario.scores.entries()) {
          const questionId = marks.answers[i].questionId;
          assert.equal(await tx.$executeRaw`UPDATE public.answers SET score = ${score}::float8
            WHERE submission_id = ${first.id}::uuid AND question_id = ${questionId}::uuid`, 1);
        }
        assert.equal(await gradeRow(tx, scenario.total), 1);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      }, serializable), error => error.meta?.code === '23514');
      assert.equal((await grading.submission(f.teacher, first.id)).status, 'SUBMITTED');
    }
    await grading.grade(f.teacher, first.id, marks);
    assert.equal((await grading.get(f.teacher, f.assessment.id)).status, 'GRADING');
    const releaseRow = tx => tx.$executeRaw`
      UPDATE public.assessments SET status = 'RESULTS_RELEASED', results_released_at = CURRENT_TIMESTAMP
      WHERE id = ${f.assessment.id}::uuid`;
    await assert.rejects(staff.$transaction(async tx => {
      await install(tx, await proof(tx, f.teacher, f.assessment.id, 'staff-release'));
      await releaseRow(tx);
    }, serializable), denied);
    await assert.rejects(grading.transition(f.teacher, f.assessment.id, 'release'), error => error.getStatus?.() === 409);
    assert.equal((await grading.ownSubmission(f.student, f.assessment.id)).score, null);
    await staff.$transaction(async tx => {
      await install(tx, await proof(tx, f.teacher, randomUUID(), 'staff-release'));
      assert.equal(await releaseRow(tx), 0);
    }, serializable);
    for (const change of [
      tx => tx.$executeRaw`UPDATE public.assessments SET status = 'DRAFT' WHERE id = ${f.assessment.id}::uuid`,
      tx => tx.$executeRaw`UPDATE public.assessments SET title = 'Invalid lifecycle edit' WHERE id = ${f.assessment.id}::uuid`,
    ]) {
      await assert.rejects(staff.$transaction(async tx => {
        await install(tx, await proof(tx, f.teacher, f.teacher.sub, 'staff-write'));
        await change(tx);
      }, serializable), denied);
    }
    const [lastGrade, release] = await Promise.allSettled([
      grading.grade(f.teacher, second.id, marks), grading.transition(f.teacher, f.assessment.id, 'release'),
    ]);
    assert.equal(lastGrade.status, 'fulfilled', String(lastGrade.reason ?? ''));
    if (release.status === 'rejected') {
      assert.equal(release.reason.getStatus?.(), 409);
      assert.equal((await grading.transition(f.teacher, f.assessment.id, 'release')).status, 'RESULTS_RELEASED');
    } else {
      assert.equal(release.value.status, 'RESULTS_RELEASED');
    }
    assert.equal((await grading.ownSubmission(f.student, f.assessment.id)).score, 4);
    assert.equal((await grading.ownSubmission(f.peer, f.assessment.id)).score, 4);
  });

  await t.test('school metadata and linked child profiles stay scoped across schools and revocation', async () => {
    const a = await fixtures('Fictional Directory Home');
    const b = await fixtures('Fictional Directory Partner');
    const schools = tx => tx.$queryRaw`SELECT id FROM public.schools ORDER BY id`;
    const names = tx => tx.$queryRaw`SELECT id FROM public.users ORDER BY id`;
    assert.deepEqual(await schools(db), []);
    const parentMembership = await foundation.addMembership(b.admin, { email: a.parent.email, role: 'PARENT' });
    const newLink = await foundation.createLink(b.admin, { parentId: a.parent.sub, studentId: b.student.sub });
    await foundation.linkStatus(b.admin, newLink.id, 'VERIFIED');
    const overview = await foundation.childOverview(a.parent, b.student.sub, b.school.id);
    assert.equal(overview.school.id, b.school.id);
    assert.equal(overview.student.id, b.student.sub);
    let captured;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.school_id', ${b.school.id}, true), set_config('app.user_id', ${a.parent.sub}, true), set_config('app.bypass_rls', 'on', true)`;
      assert.deepEqual(await schools(tx), []);
      const valid = await proof(tx, a.parent, b.student.sub, 'read', { school: b.school.id });
      captured = valid;
      for (const invalid of [{ ...valid, tag: '0'.repeat(64) }, await proof(tx, a.parent, b.student.sub, 'read', { school: b.school.id, expired: true }),
        await proof(tx, a.parent, b.student.sub, 'read', { school: b.school.id, actor: b.parent.sub })]) {
        await install(tx, invalid);
        assert.deepEqual(await names(tx), []);
        assert.deepEqual(await schools(tx), []);
      }
      await install(tx, valid);
      assert.deepEqual((await schools(tx)).map(row => row.id), [a.school.id, b.school.id].sort());
      assert.deepEqual((await names(tx)).map(row => row.id), [a.parent.sub, b.student.sub, b.teacher.sub].sort());
      await other.$transaction(async second => {
        await install(second, valid);
        assert.deepEqual(await names(second), []);
        assert.deepEqual(await schools(second), []);
      });
    });
    await db.$transaction(async later => { await install(later, captured); assert.deepEqual(await schools(later), []); });
    assert.deepEqual(await names(db), []);

    const second = await foundation.addMembership(b.admin, { email: a.student.email, role: 'STUDENT' });
    const switchedActor = { ...a.student, schoolId: b.school.id, membershipId: second.id };
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, a.student, a.student.sub, 'read'));
      assert.deepEqual(await schools(tx), [{ id: a.school.id }]);
      await install(tx, await proof(tx, switchedActor, a.student.sub, 'read'));
      assert.deepEqual(await schools(tx), [{ id: b.school.id }]);
    });
    await foundation.membership(b.admin, second.id, false);
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, switchedActor, a.student.sub, 'read'));
      assert.deepEqual(await names(tx), []);
      assert.deepEqual(await schools(tx), []);
    });

    // Revocation is visible in new transactions. A transaction that has
    // already taken a Serializable snapshot keeps that snapshot.
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, a.parent, b.student.sub, 'read', { school: b.school.id }));
      assert.deepEqual((await schools(tx)).map(row => row.id), [a.school.id, b.school.id].sort());
      await foundation.linkStatus(b.admin, newLink.id, 'REJECTED');
      assert.deepEqual((await schools(tx)).map(row => row.id), [a.school.id, b.school.id].sort());
    }, { isolationLevel: 'Serializable' });
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, a.parent, b.student.sub, 'read', { school: b.school.id }));
      assert.deepEqual(await names(tx), [{ id: a.parent.sub }]);
      assert.deepEqual(await schools(tx), [{ id: a.school.id }]);
    });
    await assert.rejects(foundation.childOverview(a.parent, b.student.sub, b.school.id), notFound);
    await foundation.membership(b.admin, parentMembership.id, false);
  });

});
