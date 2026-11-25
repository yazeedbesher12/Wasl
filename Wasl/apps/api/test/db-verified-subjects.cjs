// Run with the marked disposable-lab environment and the restricted tenant URL.
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { PrismaStorage } = require('../src/foundation/prisma.adapter');
const { FoundationService } = require('../src/foundation/foundation.service');

const denied = error => error.meta?.code === '42501';

test('Subjects proofs bind SQL authority to a verified operation and transaction', async t => {
  const urls = { tenant: process.env.DATABASE_URL, auth: process.env.AUTH_DATABASE_URL,
    platform: process.env.PLATFORM_DATABASE_URL, academicAdmin: process.env.ACADEMIC_ADMIN_DATABASE_URL, assessmentStaff: process.env.ASSESSMENT_STAFF_DATABASE_URL };
  const roles = { tenant: 'wasl_tenant', auth: 'wasl_auth', platform: 'wasl_platform', academicAdmin: 'wasl_academic_admin', assessmentStaff: 'wasl_assessment_staff' };
  const parsed = Object.entries(urls).map(([key, value]) => {
    const url = new URL(value);
    assert.ok(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && +url.port > 1024 && !['5432', '5433'].includes(url.port) &&
      url.pathname === '/wasl_db02_disposable' && url.username === roles[key] && !!url.password && url.search === '?schema=public' && !url.hash,
    'Unexpected marked disposable lab target');
    return url;
  });
  assert.equal(new Set(parsed.map(url => url.port)).size, 1);
  assert.ok(/^wasl-pg17-lab-[a-f0-9]{10}$/.test(process.env.WASL_LAB_ID ?? ''));
  assert.ok(!process.env.MIGRATION_DATABASE_URL);
  const key = Buffer.from(process.env.WASL_SUBJECT_PROOF_KEY ?? '', 'hex');
  assert.equal(key.length, 32);
  const makeClient = value => {
    const url = new URL(value);
    url.searchParams.set('connection_limit', '1');
    const client = new PrismaClient({ datasources: { db: { url: url.href } } });
    t.after(() => client.$disconnect());
    return client;
  };
  const db = makeClient(urls.tenant);
  const other = makeClient(urls.tenant);
  for (const [name, url] of Object.entries(urls)) {
    const client = name === 'tenant' ? db : makeClient(url);
    const [check] = await client.$queryRaw`
      SELECT current_database() = 'wasl_db02_disposable' AND current_user::text = ${roles[name]}
        AND pg_catalog.shobj_description(oid, 'pg_database') = ${process.env.WASL_LAB_ID}
        AND pg_catalog.pg_get_userbyid(datdba) = 'wasl_migrate' AND
          current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AS valid
      FROM pg_catalog.pg_database WHERE datname = current_database()`;
    assert.equal(check.valid, true, 'Database identity must match the marked lab');
  }
  const [p] = await db.$queryRaw`SELECT m.id AS "membershipId", m.user_id AS sub, u.email FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id WHERE m.role = 'PLATFORM_ADMIN' AND m.active ORDER BY m.id LIMIT 1`;
  const platform = { ...p, schoolId: null, role: 'PLATFORM_ADMIN' };
  const storage = await PrismaStorage.open(urls, key);
  t.after(() => storage.onModuleDestroy());
  const foundation = new FoundationService(storage);
  const password = randomUUID();
  const email = role => `${role.toLowerCase()}-${randomUUID()}@wasl.test`;
  const actor = ({ user, membership }) => ({ sub: user.id, email: user.email, role: membership.role, schoolId: membership.schoolId, membershipId: membership.id });
  async function fixtures(name) {
    const school = await foundation.createSchool(platform, { name });
    const admin = actor(await foundation.provisionAdministrator(platform, school.id, { email: email('admin'), fullName: 'Fictional Admin', password }));
    const first = await foundation.saveAcademic(admin, 'subjects', { nameAr: 'Fictional', nameEn: name });
    const second = await foundation.saveAcademic(admin, 'subjects', { nameAr: 'Fictional', nameEn: `${name} unassigned` });
    return { school, admin, first, second };
  }
  const [a, b] = await Promise.all([fixtures('Subjects Alpha'), fixtures('Subjects Beta')]);
  async function proof(tx, who, schoolId, { operation = 'read', subjectId = null, child = null, expires = Date.now() + 15000 } = {}) {
    const [binding] = await tx.$queryRaw`SELECT oid::text AS database, pg_backend_pid()::text AS backend,
      pg_current_xact_id()::text AS transaction, session_user::text AS login FROM pg_catalog.pg_database WHERE datname = current_database()`;
    const payload = JSON.stringify([binding.database, binding.backend, binding.transaction, binding.login, expires,
      who.sub, who.membershipId, schoolId, operation, subjectId, child]);
    return { binding, payload, tag: createHmac('sha256', key).update(payload).digest('hex') };
  }
  const install = (tx, { payload, tag }) => tx.$queryRaw`SELECT set_config('app.subject_proof', ${payload}, true) IS NOT NULL,
    set_config('app.subject_tag', ${tag}, true) IS NOT NULL`;
  const select = (tx, id) => tx.$queryRaw`SELECT id FROM public.subjects WHERE id = ${id}::uuid`;

  await t.test('missing, forged, expired, wrong actor and wrong school are denied', async () => {
    await db.$transaction(async tx => {
      assert.deepEqual(await select(tx, a.first.id), []);
      await tx.$queryRaw`SELECT set_config('app.school_id', ${a.school.id}, true), set_config('app.user_id', ${a.admin.sub}, true), set_config('app.bypass_rls', 'on', true)`;
      assert.deepEqual(await select(tx, a.first.id), []);
      const valid = await proof(tx, a.admin, a.school.id);
      await install(tx, { ...valid, tag: '0'.repeat(64) });
      assert.deepEqual(await select(tx, a.first.id), []);
      for (const value of [await proof(tx, a.admin, a.school.id, { expires: Date.now() - 5000 }),
        await proof(tx, { ...a.admin, sub: b.admin.sub }, a.school.id), await proof(tx, a.admin, b.school.id)]) {
        await install(tx, value);
        assert.deepEqual(await tx.$queryRaw`SELECT id FROM public.subjects`, []);
      }
    });
  });

  await t.test('writes require the exact operation and immutable subject ownership', async () => {
    await assert.rejects(db.$executeRaw`INSERT INTO public.subjects (id,school_id,name_ar,name_en)
      VALUES (${randomUUID()}::uuid,${a.school.id}::uuid,'Fictional','Unauthorized')`, denied);
    await assert.rejects(db.$executeRaw`DELETE FROM public.subjects WHERE false`, denied);
    await assert.rejects(db.$executeRaw`UPDATE public.subjects SET school_id = ${b.school.id}::uuid WHERE false`, denied);
    await db.$transaction(async tx => {
      await install(tx, await proof(tx, a.admin, a.school.id, { operation: 'update', subjectId: a.first.id }));
      assert.equal(await tx.$executeRaw`UPDATE public.subjects SET name_en = name_en WHERE id = ${a.first.id}::uuid`, 1);
      assert.equal(await tx.$executeRaw`UPDATE public.subjects SET name_en = name_en WHERE id = ${a.second.id}::uuid`, 0);
      assert.equal(await tx.$executeRaw`UPDATE public.subjects SET name_en = name_en WHERE id = ${b.first.id}::uuid`, 0);
    });
    assert.equal((await foundation.saveAcademic(a.admin, 'subjects', { nameEn: 'Verified new name' }, a.first.id)).nameEn, 'Verified new name');
  });

  await t.test('concurrent connections, rollback and pool reuse cannot replay captured proof', async () => {
    const rolledBack = new Error('Fictional rollback');
    let captured;
    await assert.rejects(db.$transaction(async tx => {
      captured = await proof(tx, a.admin, a.school.id, { operation: 'update', subjectId: a.first.id });
      await install(tx, captured);
      assert.equal((await select(tx, a.first.id)).length, 1);
      assert.equal(await tx.$executeRaw`UPDATE public.subjects SET name_en = 'Rolled back' WHERE id = ${a.first.id}::uuid`, 1);
      await other.$transaction(async second => {
        const independent = await proof(second, b.admin, b.school.id);
        assert.notEqual(captured.binding.backend, independent.binding.backend);
        await install(second, captured);
        assert.deepEqual(await select(second, a.first.id), []);
        await install(second, independent);
        assert.equal((await select(second, b.first.id)).length, 1);
        assert.deepEqual(await select(second, a.first.id), []);
      });
      throw rolledBack;
    }), error => error === rolledBack);
    assert.equal((await foundation.getAcademic(a.admin, 'subjects', a.first.id)).nameEn, 'Verified new name');
    await db.$transaction(async tx => {
      const fresh = await proof(tx, a.admin, a.school.id);
      assert.equal(fresh.binding.backend, captured.binding.backend);
      assert.notEqual(fresh.binding.transaction, captured.binding.transaction);
      assert.deepEqual(await select(tx, a.first.id), []);
      await install(tx, captured);
      assert.deepEqual(await select(tx, a.first.id), []);
    });
  });

  await t.test('tenant cannot write the authorization inputs or assume the verifier', async () => {
    await assert.rejects(db.$queryRaw`SELECT secret FROM wasl_subject_scope.signing_key`, denied);
    await assert.rejects(db.$executeRaw`SET ROLE wasl_subject_verifier`, denied);
    await assert.rejects(db.$executeRaw`SET ROLE wasl_academic_admin`, denied);
    await assert.rejects(db.$executeRaw`UPDATE public.section_subjects SET teacher_id = NULL WHERE false`, denied);
    await assert.rejects(db.$executeRaw`UPDATE public.enrollments SET status = 'ACTIVE' WHERE false`, denied);
    await assert.rejects(db.$executeRaw`UPDATE public.parent_student_links SET status = 'VERIFIED' WHERE false`, denied);
    const [grants] = await db.$queryRaw`
      SELECT owner.rolname::text AS owner, p.prosecdef AS definer,
        'search_path=pg_catalog, pg_temp' = ANY(p.proconfig) AS search_path_fixed,
        NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) WHERE grantee = 0) AS public_denied,
        pg_catalog.has_function_privilege('wasl_tenant', p.oid, 'EXECUTE') AS tenant_execute,
        pg_catalog.has_function_privilege('wasl_auth', p.oid, 'EXECUTE') AS auth_execute,
        pg_catalog.has_function_privilege('wasl_platform', p.oid, 'EXECUTE') AS platform_execute
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = p.proowner
      WHERE n.nspname = 'wasl_subject_scope' AND p.proname = 'permits'`;
    assert.deepEqual(grants, { owner: 'wasl_subject_verifier', definer: true, search_path_fixed: true,
      public_denied: true, tenant_execute: true, auth_execute: false, platform_execute: false });
  });

  await t.test('teacher, student and verified parent subject visibility follows their relationships', async () => {
    const parent = actor(await foundation.createUser(a.admin, { email: email('parent'), fullName: 'Fictional Parent', password, role: 'PARENT' }));
    await foundation.addMembership(b.admin, { email: parent.email, role: 'PARENT' });
    async function enroll(fixture) {
      const { admin, first } = fixture;
      const teacher = actor(await foundation.createUser(admin, { email: email('teacher'), fullName: 'Fictional Teacher', password, role: 'TEACHER' }));
      const student = actor(await foundation.createUser(admin, { email: email('student'), fullName: 'Fictional Student', password, role: 'STUDENT' }));
      const year = await foundation.saveAcademic(admin, 'academicYears', { name: 'Fictional year', startDate: '2026-09-01', endDate: '2027-06-30' });
      const grade = await foundation.saveAcademic(admin, 'grades', { name: 'Fictional grade', level: 9 });
      const section = await foundation.saveAcademic(admin, 'sections', { name: 'Fictional section', gradeId: grade.id, academicYearId: year.id });
      const foreign = fixture === a ? b : a;
      await assert.rejects(foundation.saveAcademic(admin, 'sectionSubjects', { sectionId: section.id, subjectId: foreign.first.id, teacherId: teacher.sub }), error => error.getStatus?.() === 404);
      await foundation.saveAcademic(admin, 'sectionSubjects', { sectionId: section.id, subjectId: first.id, teacherId: teacher.sub });
      await foundation.saveAcademic(admin, 'enrollments', { sectionId: section.id, studentId: student.sub });
      const link = await foundation.createLink(admin, { parentId: parent.sub, studentId: student.sub });
      await assert.rejects(foundation.childOverview(parent, student.sub, fixture.school.id), error => error.getStatus?.() === 404);
      await foundation.linkStatus(admin, link.id, 'VERIFIED');
      return { teacher, student };
    }
    const [alpha, beta] = await Promise.all([enroll(a), enroll(b)]);
    for (const [fixture, people] of [[a, alpha], [b, beta]]) {
      for (const reader of [people.teacher, people.student]) {
        assert.equal((await foundation.getAcademic(reader, 'subjects', fixture.first.id)).id, fixture.first.id);
        await assert.rejects(foundation.getAcademic(reader, 'subjects', fixture.second.id), error => error.getStatus?.() === 404);
      }
      const overview = await foundation.childOverview(parent, people.student.sub, fixture.school.id);
      assert.deepEqual(overview.classes.map(c => c.subject.id), [fixture.first.id]);
    }
  });
});
