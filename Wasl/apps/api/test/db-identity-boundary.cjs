// Run against a freshly marked disposable PostgreSQL 17 database after migrate deploy.
// Load with node -r ts-node/register/transpile-only --test test/db-identity-boundary.cjs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { AuthService } = require('../src/auth/session.service');
const { FoundationService } = require('../src/foundation/foundation.service');
const { PrismaStorage } = require('../src/foundation/prisma.adapter');

const marker = process.env.WASL_LAB_ID;
const roles = { auth: 'wasl_auth', platform: 'wasl_platform', tenant: 'wasl_tenant', academicAdmin: 'wasl_academic_admin', assessmentStaff: 'wasl_assessment_staff' };

function target(key, role) {
  const url = new URL(process.env[key] ?? '');
  assert.ok(/^wasl-pg17-lab-[a-f0-9]{10}$/.test(marker ?? ''), 'Disposable lab marker is required');
  assert.ok(url.protocol === 'postgresql:' && url.hostname === '127.0.0.1' && +url.port > 1024 &&
    !['5432', '5433'].includes(url.port) && url.pathname === '/wasl_db02_disposable' &&
    url.username === role && !!url.password && url.search === '?schema=public' && !url.hash,
  'Unexpected disposable lab target');
  return url;
}

async function verify(client, role) {
  const [result] = await client.$queryRaw`
    SELECT current_database() = 'wasl_db02_disposable' AND current_user::text = ${role}
      AND pg_catalog.shobj_description(oid, 'pg_database') = ${marker}
      AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
      AND pg_catalog.pg_get_userbyid(datdba) = 'wasl_migrate' AS valid
    FROM pg_catalog.pg_database WHERE datname = current_database()`;
  assert.equal(result?.valid, true, 'Restricted disposable lab identity');
}

const denied = error => error.meta?.code === '42501';
const rollback = new Error('Security probe unexpectedly succeeded');

test('actual PostgreSQL execution credentials enforce the identity boundary', async t => {
  const urls = {
    auth: target('AUTH_DATABASE_URL', roles.auth),
    platform: target('PLATFORM_DATABASE_URL', roles.platform),
    tenant: target('DATABASE_URL', roles.tenant),
    academicAdmin: target('ACADEMIC_ADMIN_DATABASE_URL', roles.academicAdmin),
    assessmentStaff: target('ASSESSMENT_STAFF_DATABASE_URL', roles.assessmentStaff),
  };
  assert.equal(new Set(Object.values(urls).map(url => url.port)).size, 1);
  assert.ok(!process.env.MIGRATION_DATABASE_URL, 'Migration credentials must be absent');
  const pools = Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, new PrismaClient({ datasources: { db: { url: url.href } } })]));
  t.after(() => Promise.all(Object.values(pools).map(client => client.$disconnect())));
  for (const [key, role] of Object.entries(roles)) await verify(pools[key], role);

  const { auth, platform, tenant } = pools;
  const [administrator] = await platform.membership.findMany({ where: { role: 'PLATFORM_ADMIN', active: true } });
  assert.ok(administrator, 'Fictional platform administrator fixture');
  const [platformUser] = await platform.$queryRaw`SELECT id, email FROM public.users WHERE id = ${administrator.userId}::uuid`;
  const platformActor = { sub: platformUser.id, email: platformUser.email, schoolId: null, role: 'PLATFORM_ADMIN', membershipId: administrator.id };
  const storage = await PrismaStorage.open(Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, url.href])),
    Buffer.from(process.env.WASL_SUBJECT_PROOF_KEY ?? '', 'hex'));
  t.after(() => storage.onModuleDestroy());
  const foundation = new FoundationService(storage);
  const school = await foundation.createSchool(platformActor, { name: 'Fictional DB-02 School' });

  async function rejectSql(client, operation, check = denied, forge = false) {
    await assert.rejects(client.$transaction(async tx => {
      if (forge) {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${platformUser.id}, true), set_config('app.school_id', ${school.id}, true), set_config('app.role', 'PLATFORM_ADMIN', true), set_config('app.bypass_rls', 'on', true)`;
      }
      await operation(tx);
      throw rollback;
    }), check);
  }

  await t.test('tenant SQL cannot reach sensitive data or administrative writes, even with forged context', async () => {
    const operations = [
      tx => tx.$queryRaw`SELECT password_hash FROM public.users LIMIT 0`,
      tx => tx.$queryRaw`SELECT token_hash FROM public.refresh_tokens LIMIT 0`,
      tx => tx.$queryRaw`SELECT id FROM public.session_families LIMIT 0`,
      tx => tx.$executeRaw`UPDATE public.refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE false`,
      tx => tx.$executeRaw`UPDATE public.users SET full_name = 'Forged' WHERE false`,
      tx => tx.$executeRaw`UPDATE public.memberships SET active = false WHERE false`,
      tx => tx.$executeRaw`INSERT INTO public.memberships (id, user_id, role) VALUES (${randomUUID()}::uuid, ${platformUser.id}::uuid, 'PLATFORM_ADMIN')`,
      tx => tx.$executeRaw`INSERT INTO wasl_admin.school_memberships (id, user_id, school_id, role) VALUES (${randomUUID()}::uuid, ${platformUser.id}::uuid, ${school.id}::uuid, 'SCHOOL_ADMIN')`,
      tx => tx.$executeRaw`UPDATE wasl_admin.school_memberships SET active = false WHERE false`,
      tx => tx.$executeRaw`CREATE TABLE public.db02_ddl_probe (id integer)`,
      tx => tx.$executeRaw`CREATE TEMP TABLE db02_temp_probe (id integer)`,
      tx => tx.$executeRaw`UPDATE public._prisma_migrations SET checksum = checksum WHERE false`,
      tx => tx.$executeRaw`SET ROLE wasl_auth`,
      tx => tx.$executeRaw`SET ROLE wasl_platform`,
      tx => tx.$executeRaw`SET ROLE wasl_migrate`,
    ];
    for (const operation of operations) await rejectSql(tenant, operation, denied, true);
    // The original positive projection belongs to platform provisioning. The
    // same read is now explicitly denied on the ordinary tenant credential.
    assert.deepEqual(await platform.$queryRaw`SELECT id, email FROM public.users WHERE id = ${platformUser.id}::uuid`, [platformUser]);
    await assert.rejects(tenant.$queryRaw`SELECT id, email FROM public.users WHERE id = ${platformUser.id}::uuid`, denied);
    assert.deepEqual(await tenant.$queryRaw`SELECT id FROM public.users WHERE id = ${platformUser.id}::uuid`, []);
  });

  await t.test('authentication and administration have distinct privileges', async () => {
    await rejectSql(auth, tx => tx.$executeRaw`UPDATE public.schools SET active = false WHERE false`);
    await rejectSql(auth, tx => tx.$executeRaw`UPDATE public.memberships SET active = false WHERE false`);
    await rejectSql(platform, tx => tx.$queryRaw`SELECT password_hash FROM public.users LIMIT 0`);
    await rejectSql(platform, tx => tx.$queryRaw`SELECT token_hash FROM public.refresh_tokens LIMIT 0`);
    for (const restricted of [platform, pools.academicAdmin, pools.assessmentStaff]) {
      await rejectSql(restricted, tx => tx.$queryRaw`SELECT id FROM public.session_families LIMIT 0`);
      await rejectSql(restricted, tx => tx.$executeRaw`UPDATE public.session_families SET revoked_at = CURRENT_TIMESTAMP WHERE false`);
    }
    await rejectSql(auth, tx => tx.$executeRaw`UPDATE public.session_families SET user_id = user_id WHERE false`);
    await rejectSql(auth, tx => tx.$executeRaw`UPDATE public.refresh_tokens SET family_id = family_id WHERE false`);
    await rejectSql(platform, tx => tx.$queryRaw`SELECT id FROM public.academic_years LIMIT 0`);
    await rejectSql(platform, tx => tx.$executeRaw`UPDATE public.memberships SET active = false WHERE false`);
    await rejectSql(platform, tx => tx.$executeRaw`UPDATE wasl_admin.school_memberships SET role = 'PLATFORM_ADMIN' WHERE false`);
    await rejectSql(platform, tx => tx.$executeRaw`INSERT INTO wasl_admin.school_memberships (id, user_id, school_id, role) VALUES (${randomUUID()}::uuid, ${platformUser.id}::uuid, ${school.id}::uuid, 'PLATFORM_ADMIN')`,
      error => error.meta?.code === '44000');
  });

  await t.test('school provisioning commits both writes and rolls back on membership failure', async () => {
    const password = randomUUID();
    const admin = await foundation.provisionAdministrator(platformActor, school.id, {
      email: `admin-${randomUUID()}@wasl.test`, fullName: 'Fictional Admin', password,
    });
    const actor = { sub: admin.user.id, email: admin.user.email, schoolId: school.id, role: 'SCHOOL_ADMIN', membershipId: admin.membership.id };
    assert.equal((await foundation.updateProfile(actor, { fullName: 'Fictional Updated Admin' })).fullName, 'Fictional Updated Admin');
    const student = await foundation.createUser(actor, { email: `student-${randomUUID()}@wasl.test`, fullName: 'Fictional Student', password, role: 'STUDENT' });
    assert.equal((await platform.membership.findUnique({ where: { id: student.membership.id } }))?.userId, student.user.id);
    assert.equal((await foundation.membership(actor, student.membership.id, false)).active, false);
    assert.equal((await foundation.membership(actor, student.membership.id, true)).active, true);
    const missingSchool = randomUUID();
    const email = `rollback-${randomUUID()}@wasl.test`;
    const userId = randomUUID();
    const membershipId = randomUUID();
    const createdAt = new Date();
    await assert.rejects(storage.run({ kind: 'school-administration', schoolId: missingSchool, userId: actor.sub }, async r => {
      await r.identity.createPerson({ id: userId, email, fullName: 'Fictional Rollback', passwordHash: 'unused-fixture', preferredLanguage: 'en', active: true, createdAt });
      await r.people.createMembership({ id: membershipId, userId, schoolId: missingSchool, role: 'STUDENT', active: true, createdAt });
    }), error => error.getStatus?.() === 404);
    assert.deepEqual(await platform.$queryRaw`SELECT id FROM public.users WHERE id = ${userId}::uuid`, []);
    assert.equal(await platform.membership.findUnique({ where: { id: membershipId } }), null);
  });

  await t.test('school switching issues a session for an active membership on the auth connection', async () => {
    const anotherSchool = await foundation.createSchool(platformActor, { name: 'Fictional DB-02 Switching School' });
    const password = randomUUID();
    const email = `switch-${randomUUID()}@wasl.test`;
    const first = await foundation.provisionAdministrator(platformActor, school.id, { email, fullName: 'Fictional Switch Admin', password });
    const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
    const config = new ConfigService({ JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET, JWT_REFRESH_TTL_DAYS: 30 });
    const sessions = new AuthService(storage, jwt, config);
    const initial = await sessions.login(email, password);
    const actor = await sessions.validateAccess(await jwt.verifyAsync(initial.accessToken));
    assert.equal(actor.schoolId, school.id);
    const second = await foundation.provisionAdministrator(platformActor, anotherSchool.id, { email });
    assert.equal(first.user.id, second.user.id);
    const switched = await sessions.switchSchool(actor, anotherSchool.id, 'SCHOOL_ADMIN');
    const claims = await jwt.verifyAsync(switched.accessToken);
    assert.equal(claims.schoolId, anotherSchool.id);
    assert.equal(claims.membershipId, second.membership.id);
    assert.equal((await sessions.validateAccess(claims)).schoolId, anotherSchool.id);
    await assert.rejects(sessions.switchSchool(actor, null, 'PLATFORM_ADMIN'), error => error.getStatus?.() === 403);
    const independent = await sessions.login(email, password);
    const rotated = await sessions.refresh(switched.refreshToken);
    const invalid = error => error.getStatus?.() === 401;
    await assert.rejects(sessions.refresh(switched.refreshToken), invalid);
    // An already consumed token can still identify its own family for logout.
    await sessions.logout(switched.refreshToken);
    await sessions.logout(rotated.refreshToken);
    await sessions.logout('fictional-unknown-token');
    for (const session of [initial, switched, rotated]) {
      await assert.rejects(sessions.refresh(session.refreshToken), invalid);
      const accessClaims = await jwt.verifyAsync(session.accessToken);
      await assert.rejects(sessions.validateAccess(accessClaims), invalid);
    }
    await assert.rejects(sessions.switchSchool(actor, anotherSchool.id, 'SCHOOL_ADMIN'), invalid);
    assert.equal(!!(await sessions.refresh(independent.refreshToken)).refreshToken, true);

    const schoolSession = await sessions.login(email, password);
    const schoolActor = await sessions.validateAccess(await jwt.verifyAsync(schoolSession.accessToken));
    const secondContext = await sessions.switchSchool(schoolActor, anotherSchool.id, 'SCHOOL_ADMIN');
    const secondActor = await sessions.validateAccess(await jwt.verifyAsync(secondContext.accessToken));
    await foundation.membership(secondActor, second.membership.id, false);
    await assert.rejects(sessions.refresh(secondContext.refreshToken), invalid);

    const expired = new AuthService(storage, jwt, new ConfigService({
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET, JWT_REFRESH_TTL_DAYS: 0,
    }));
    const short = await expired.login(email, password);
    await assert.rejects(sessions.refresh(short.refreshToken), invalid);
    await assert.rejects(sessions.refresh('fictional-invalid-token'), invalid);
  });

  await t.test('concurrent refresh and logout serialize on the family through restricted Prisma transactions', async () => {
    const password = randomUUID();
    const email = `race-${randomUUID()}@wasl.test`;
    await foundation.provisionAdministrator(platformActor, school.id, { email, fullName: 'Fictional Race Admin', password });
    const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
    const config = new ConfigService({ JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET, JWT_REFRESH_TTL_DAYS: 30 });
    const sessions = new AuthService(storage, jwt, config);
    const initial = await sessions.login(email, password);
    let reachedClaim, releaseClaim, reachedLogout;
    const claimed = new Promise(resolve => { reachedClaim = resolve; });
    const release = new Promise(resolve => { releaseClaim = resolve; });
    const logoutStarted = new Promise(resolve => { reachedLogout = resolve; });
    function wrap(method, before) {
      return { run: (scope, action) => storage.run(scope, r => {
        const authentication = r.authentication;
        const original = authentication[method];
        authentication[method] = (...args) => before(original, args);
        return action({ ...r, authentication });
      }) };
    }
    const issuing = new AuthService(wrap('consumeRefresh', async (consume, args) => {
      reachedClaim();
      await release;
      return consume(...args);
    }), jwt, config);
    const revoking = new AuthService(wrap('revokeFamily', (revoke, args) => {
      const result = revoke(...args);
      reachedLogout();
      return result;
    }), jwt, config);
    const rotation = issuing.refresh(initial.refreshToken);
    await Promise.race([claimed, rotation.then(() => assert.fail('Refresh did not reach the gate'))]);
    const logout = revoking.logout(initial.refreshToken);
    try {
      await Promise.race([logoutStarted, logout.then(() => assert.fail('Logout did not reach the gate'))]);
    } finally {
      releaseClaim();
    }
    const [descendant] = await Promise.all([rotation, logout]);
    const invalid = error => error.getStatus?.() === 401;
    await assert.rejects(sessions.refresh(descendant.refreshToken), invalid);
    await assert.rejects(sessions.refresh(initial.refreshToken), invalid);
  });
});
