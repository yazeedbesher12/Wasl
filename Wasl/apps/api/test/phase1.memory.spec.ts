import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import request from 'supertest';
import { STORAGE, type FoundationStorage } from '../src/foundation/repositories';
import { bearer, createMemoryApp, developmentId, login, TEST_PASSWORD } from './memory-harness';

describe('Backend Phase 1 with isolated memory storage', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createMemoryApp();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('health and authentication', () => {
    it('does not create a session for an inactive account with valid credentials', async () => {
      const userId = randomUUID();
      const email = 'inactive@wasl.test';
      const schoolId = developmentId(1);
      const passwordHash = await hash(TEST_PASSWORD, 12);
      const storage = app.get<FoundationStorage>(STORAGE);
      await storage.run({ kind: 'school-administration', userId: null, schoolId }, async r => {
        const createdAt = new Date();
        await r.identity.createPerson({
          id: userId, email, passwordHash, fullName: 'Fictional Inactive User',
          preferredLanguage: 'en', active: false, createdAt,
        });
        await r.people.createMembership({
          id: randomUUID(), userId, schoolId, role: 'STUDENT', active: true, createdAt,
        });
      });
      const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('refreshToken');
    });

    it('reports memory liveness and readiness without authentication', async () => {
      const health = await request(app.getHttpServer()).get('/api/v1/health');
      const ready = await request(app.getHttpServer()).get('/api/v1/health/ready');

      expect(health.status).toBe(200);
      expect(health.body).toEqual({ status: 'ok', storageDriver: 'memory' });
      expect(ready.status).toBe(200);
      expect(ready.body).toEqual({ status: 'ok', storageDriver: 'memory' });
    });

    it('logs in with normalized fictional credentials and returns active context', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: '  ADMIN1@WASL.TEST ', password: TEST_PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.refreshToken).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({
        id: developmentId(110),
        email: 'admin1@wasl.test',
        activeSchoolId: developmentId(1),
        activeRole: 'SCHOOL_ADMIN',
      });
    });

    it.each([
      ['unknown identity', 'missing@wasl.test', TEST_PASSWORD],
      ['wrong password', 'admin1@wasl.test', `${TEST_PASSWORD}x`],
    ])('rejects %s with a generic unauthorized response', async (_case, email, password) => {
      const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Wrong email or password');
    });

    it.each([
      [{ email: 'not-an-email', password: TEST_PASSWORD }],
      [{ email: 'admin1@wasl.test', password: 'short' }],
      [{ email: 'admin1@wasl.test', password: TEST_PASSWORD, schoolId: developmentId(2) }],
    ])('rejects malformed or non-whitelisted login input', async body => {
      const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send(body);
      expect(response.status).toBe(400);
    });

    it('requires an access token and rejects malformed or tampered JWTs', async () => {
      const session = await login(app, 'admin1@wasl.test');
      const anonymous = await request(app.getHttpServer()).get('/api/v1/me');
      const malformed = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', 'Bearer not-a-jwt');
      const final = session.accessToken.endsWith('a') ? 'b' : 'a';
      const tamperedToken = session.accessToken.slice(0, -1) + final;
      const tampered = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', bearer(tamperedToken));

      expect(anonymous.status).toBe(401);
      expect(malformed.status).toBe(401);
      expect(tampered.status).toBe(401);
    });

    it('rejects a correctly signed but expired access token', async () => {
      const session = await login(app, 'admin1@wasl.test');
      const jwt = app.get(JwtService);
      const decoded = jwt.decode(session.accessToken) as Record<string, unknown>;
      const { exp: _exp, iat: _iat, iss: _iss, aud: _aud, ...claims } = decoded;
      const expired = await jwt.signAsync(claims, { expiresIn: -1 });

      const response = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', bearer(expired));
      expect(response.status).toBe(401);
    });

    it('rotates refresh tokens and rejects replay of the consumed token', async () => {
      const session = await login(app, 'admin1@wasl.test');
      const rotated = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
      const replay = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });

      expect(rotated.status).toBe(200);
      expect(rotated.body.accessToken).toEqual(expect.any(String));
      expect(rotated.body.refreshToken).toEqual(expect.any(String));
      expect(rotated.body.refreshToken).not.toBe(session.refreshToken);
      expect(replay.status).toBe(401);
    });

    it('rejects malformed and unknown refresh tokens without exposing session details', async () => {
      const malformed = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: '' });
      const unknown = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: 'fictional-unknown-refresh-token' });

      expect(malformed.status).toBe(400);
      expect(unknown.status).toBe(401);
      expect(unknown.body.message).toBe('Invalid or unavailable session');
    });

    it('allows only one concurrent refresh consumer', async () => {
      const session = await login(app, 'admin1@wasl.test');
      const results = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }),
        request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }),
      ]);
      expect(results.map(result => result.status).sort()).toEqual([200, 401]);
    });

    it('revokes a refresh token on logout and keeps logout idempotent', async () => {
      const session = await login(app, 'admin1@wasl.test');
      const first = await request(app.getHttpServer()).post('/api/v1/auth/logout').send({ refreshToken: session.refreshToken });
      const second = await request(app.getHttpServer()).post('/api/v1/auth/logout').send({ refreshToken: session.refreshToken });
      const refresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });

      expect(first.status).toBe(204);
      expect(second.status).toBe(204);
      expect(refresh.status).toBe(401);
    });

    it('switches a parent to an available School 2 membership and rejects an unavailable role', async () => {
      const parent = await login(app, 'parent@wasl.test');
      const switched = await request(app.getHttpServer())
        .post('/api/v1/auth/switch-school')
        .set('Authorization', bearer(parent.accessToken))
        .send({ schoolId: developmentId(2), role: 'PARENT' });
      expect(switched.status).toBe(200);

      const me = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', bearer(switched.body.accessToken));
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ activeSchoolId: developmentId(2), activeRole: 'PARENT' });

      const forbidden = await request(app.getHttpServer())
        .post('/api/v1/auth/switch-school')
        .set('Authorization', bearer(parent.accessToken))
        .send({ schoolId: developmentId(2), role: 'TEACHER' });
      expect(forbidden.status).toBe(403);
    });
  });

  describe('role authorization and school administration', () => {
    it.each([
      ['platform@wasl.test', '/api/v1/admin/schools', 200, '/api/v1/users', 403],
      ['admin1@wasl.test', '/api/v1/users', 200, '/api/v1/admin/schools', 403],
      ['teacher1@wasl.test', '/api/v1/teacher/classes', 200, '/api/v1/users', 403],
      ['student1@wasl.test', '/api/v1/me/classes', 200, '/api/v1/teacher/classes', 403],
      ['parent@wasl.test', '/api/v1/parent/children', 200, '/api/v1/me/classes', 403],
    ])('%s receives role-appropriate allowed and forbidden responses', async (email, allowedPath, allowedStatus, deniedPath, deniedStatus) => {
      const session = await login(app, email);
      const allowed = await request(app.getHttpServer()).get(allowedPath).set('Authorization', bearer(session.accessToken));
      const denied = await request(app.getHttpServer()).get(deniedPath).set('Authorization', bearer(session.accessToken));
      expect(allowed.status).toBe(allowedStatus);
      expect(denied.status).toBe(deniedStatus);
    });

    it('allows a Platform Admin to create, update, and retrieve a school', async () => {
      const platform = await login(app, 'platform@wasl.test');
      const created = await request(app.getHttpServer())
        .post('/api/v1/admin/schools')
        .set('Authorization', bearer(platform.accessToken))
        .send({ name: 'QA Memory School', nameAr: 'مدرسة اختبار', locale: 'en' });
      expect(created.status).toBe(201);

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/admin/schools/${created.body.id}`)
        .set('Authorization', bearer(platform.accessToken))
        .send({ active: false });
      expect(updated.status).toBe(200);
      expect(updated.body.active).toBe(false);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/admin/schools/${created.body.id}`)
        .set('Authorization', bearer(platform.accessToken));
      expect(detail.status).toBe(200);
      expect(detail.body).toMatchObject({ id: created.body.id, active: false });
    });

    it('provisions a fictional School Admin atomically for a new school', async () => {
      const platform = await login(app, 'platform@wasl.test');
      const school = await request(app.getHttpServer())
        .post('/api/v1/admin/schools')
        .set('Authorization', bearer(platform.accessToken))
        .send({ name: 'Provisioning School', locale: 'ar' });
      const email = `qa-admin-${randomUUID()}@wasl.test`;
      const provisioned = await request(app.getHttpServer())
        .post(`/api/v1/admin/schools/${school.body.id}/administrator`)
        .set('Authorization', bearer(platform.accessToken))
        .send({ email, fullName: 'QA Administrator', password: TEST_PASSWORD });

      expect(provisioned.status).toBe(200);
      expect(provisioned.body.membership).toMatchObject({ schoolId: school.body.id, role: 'SCHOOL_ADMIN', active: true });
      const newAdmin = await login(app, email);
      expect(newAdmin.user).toMatchObject({ activeSchoolId: school.body.id, activeRole: 'SCHOOL_ADMIN' });
    });

    it('creates a school user and initial membership without exposing the password hash', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const email = `qa-student-${randomUUID()}@wasl.test`;
      const created = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', bearer(admin.accessToken))
        .send({ email, fullName: 'QA Student', password: TEST_PASSWORD, role: 'STUDENT' });

      expect(created.status).toBe(201);
      expect(created.body.user).toMatchObject({ email, fullName: 'QA Student', active: true });
      expect(created.body.membership).toMatchObject({ schoolId: developmentId(1), role: 'STUDENT', active: true });
      expect(created.body.user.passwordHash).toBeUndefined();
    });

    it('rejects duplicate identities and unknown writable user fields', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const duplicate = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', bearer(admin.accessToken))
        .send({ email: 'student1@wasl.test', fullName: 'Duplicate', password: TEST_PASSWORD, role: 'STUDENT' });
      const unknownField = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', bearer(admin.accessToken))
        .send({ email: `qa-${randomUUID()}@wasl.test`, fullName: 'QA', password: TEST_PASSWORD, role: 'STUDENT', schoolId: developmentId(2) });

      expect(duplicate.status).toBe(409);
      expect(unknownField.status).toBe(400);
    });

    it('attaches an existing identity to School 1 and toggles only that membership', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const attached = await request(app.getHttpServer())
        .post('/api/v1/memberships')
        .set('Authorization', bearer(admin.accessToken))
        .send({ email: 'teacher2@wasl.test', role: 'TEACHER' });
      expect(attached.status).toBe(201);
      expect(attached.body).toMatchObject({ userId: developmentId(121), schoolId: developmentId(1), role: 'TEACHER', active: true });

      const disabled = await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${attached.body.id}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ active: false });
      expect(disabled.status).toBe(200);
      expect(disabled.body.active).toBe(false);

      const teacher2 = await login(app, 'teacher2@wasl.test');
      expect(teacher2.user.activeSchoolId).toBe(developmentId(2));
    });

    it('allows an authenticated user to update only their own public profile fields', async () => {
      const student = await login(app, 'student1@wasl.test');
      const updated = await request(app.getHttpServer())
        .patch('/api/v1/me/profile')
        .set('Authorization', bearer(student.accessToken))
        .send({ fullName: 'QA Student Name', preferredLanguage: 'en' });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ id: developmentId(112), fullName: 'QA Student Name', preferredLanguage: 'en' });

      const forbiddenField = await request(app.getHttpServer())
        .patch('/api/v1/me/profile')
        .set('Authorization', bearer(student.accessToken))
        .send({ email: 'changed@wasl.test' });
      expect(forbiddenField.status).toBe(400);
    });
  });

  describe('multi-tenant isolation', () => {
    it('limits School 1 user and membership lists and hides the School 2 student directly', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const users = await request(app.getHttpServer()).get('/api/v1/users?limit=100').set('Authorization', bearer(admin.accessToken));
      const memberships = await request(app.getHttpServer()).get('/api/v1/memberships?limit=100').set('Authorization', bearer(admin.accessToken));
      const crossSchoolUser = await request(app.getHttpServer())
        .get(`/api/v1/users/${developmentId(122)}`)
        .set('Authorization', bearer(admin.accessToken));
      const crossSchoolMembership = await request(app.getHttpServer())
        .get(`/api/v1/memberships/${developmentId(532)}`)
        .set('Authorization', bearer(admin.accessToken));

      expect(users.status).toBe(200);
      expect(users.body.items.map((user: { id: string }) => user.id)).not.toContain(developmentId(122));
      expect(memberships.status).toBe(200);
      expect(memberships.body.items.every((membership: { schoolId: string }) => membership.schoolId === developmentId(1))).toBe(true);
      expect(crossSchoolUser.status).toBe(404);
      expect(crossSchoolMembership.status).toBe(404);
    });

    it.each([
      ['academic-years', 500],
      ['semesters', 501],
      ['grades', 502],
      ['sections', 503],
      ['subjects', 504],
      ['section-subjects', 505],
      ['enrollments', 506],
    ])('scopes %s lists and direct School 2 object access', async (path, school2Suffix) => {
      const admin = await login(app, 'admin1@wasl.test');
      const list = await request(app.getHttpServer()).get(`/api/v1/${path}?limit=100`).set('Authorization', bearer(admin.accessToken));
      const detail = await request(app.getHttpServer()).get(`/api/v1/${path}/${developmentId(school2Suffix)}`).set('Authorization', bearer(admin.accessToken));

      expect(list.status).toBe(200);
      expect(list.body.items.every((row: { schoolId: string }) => row.schoolId === developmentId(1))).toBe(true);
      expect(detail.status).toBe(404);
    });

    it('scopes parent-link lists and details to the authenticated admin school', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const list = await request(app.getHttpServer()).get('/api/v1/parent-links?limit=100').set('Authorization', bearer(admin.accessToken));
      const crossSchool = await request(app.getHttpServer()).get(`/api/v1/parent-links/${developmentId(602)}`).set('Authorization', bearer(admin.accessToken));

      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ id: developmentId(601), schoolId: developmentId(1), studentId: developmentId(112) });
      expect(crossSchool.status).toBe(404);
    });
  });

  describe('academic structure and visibility', () => {
    it('creates and reads a complete supported academic relationship chain', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const auth = bearer(admin.accessToken);
      const year = await request(app.getHttpServer()).post('/api/v1/academic-years').set('Authorization', auth).send({ name: '2028-2029 QA', startDate: '2028-09-01', endDate: '2029-06-30' });
      expect(year.status).toBe(201);
      const semester = await request(app.getHttpServer()).post('/api/v1/semesters').set('Authorization', auth).send({ academicYearId: year.body.id, name: 'QA Semester', startDate: '2028-09-01', endDate: '2029-01-31' });
      expect(semester.status).toBe(201);
      const grade = await request(app.getHttpServer()).post('/api/v1/grades').set('Authorization', auth).send({ name: 'QA Grade', level: 88 });
      expect(grade.status).toBe(201);
      const section = await request(app.getHttpServer()).post('/api/v1/sections').set('Authorization', auth).send({ gradeId: grade.body.id, academicYearId: year.body.id, name: 'QA Section' });
      expect(section.status).toBe(201);
      const subject = await request(app.getHttpServer()).post('/api/v1/subjects').set('Authorization', auth).send({ nameAr: 'مادة اختبار', nameEn: 'QA Subject', code: 'QA-88' });
      expect(subject.status).toBe(201);
      const assignment = await request(app.getHttpServer()).post('/api/v1/section-subjects').set('Authorization', auth).send({ sectionId: section.body.id, subjectId: subject.body.id, teacherId: developmentId(111) });
      expect(assignment.status).toBe(201);
      const enrollment = await request(app.getHttpServer()).post('/api/v1/enrollments').set('Authorization', auth).send({ sectionId: section.body.id, studentId: developmentId(112) });
      expect(enrollment.status).toBe(201);

      const roster = await request(app.getHttpServer()).get(`/api/v1/section-subjects/${assignment.body.id}/roster`).set('Authorization', auth);
      expect(roster.status).toBe(200);
      expect(roster.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ student: { id: developmentId(112), fullName: expect.any(String) } })]));

      const updatedSubject = await request(app.getHttpServer()).patch(`/api/v1/subjects/${subject.body.id}`).set('Authorization', auth).send({ code: 'QA-UPDATED' });
      expect(updatedSubject.status).toBe(200);
      expect(updatedSubject.body.code).toBe('QA-UPDATED');
    });

    it('rejects invalid dates, duplicate unique relationships, and cross-school references', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const auth = bearer(admin.accessToken);
      const reversed = await request(app.getHttpServer()).post('/api/v1/academic-years').set('Authorization', auth).send({ name: 'Bad Dates', startDate: '2029-06-30', endDate: '2028-09-01' });
      const duplicateGrade = await request(app.getHttpServer()).post('/api/v1/grades').set('Authorization', auth).send({ name: 'Duplicate Level', level: 7 });
      const crossSchoolSection = await request(app.getHttpServer()).post('/api/v1/sections').set('Authorization', auth).send({ gradeId: developmentId(502), academicYearId: developmentId(500), name: 'Cross School' });

      expect(reversed.status).toBe(400);
      expect(duplicateGrade.status).toBe(409);
      expect(crossSchoolSection.status).toBe(404);
    });

    it('rejects unknown academic fields and relationship reparenting', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const auth = bearer(admin.accessToken);
      const unknown = await request(app.getHttpServer()).post('/api/v1/subjects').set('Authorization', auth).send({ nameAr: 'اختبار', nameEn: 'QA', ownerId: developmentId(111) });
      const newGrade = await request(app.getHttpServer()).post('/api/v1/grades').set('Authorization', auth).send({ name: 'Another Grade', level: 99 });
      const reparent = await request(app.getHttpServer()).patch(`/api/v1/sections/${developmentId(403)}`).set('Authorization', auth).send({ gradeId: newGrade.body.id });

      expect(unknown.status).toBe(400);
      expect(newGrade.status).toBe(201);
      expect(reparent.status).toBe(409);
    });

    it('does not expose unsupported DELETE operations', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const response = await request(app.getHttpServer()).delete(`/api/v1/subjects/${developmentId(404)}`).set('Authorization', bearer(admin.accessToken));
      expect(response.status).toBe(404);
    });

    it('limits teacher classes and rosters to assigned classes', async () => {
      const teacher = await login(app, 'teacher1@wasl.test');
      const classes = await request(app.getHttpServer()).get('/api/v1/teacher/classes?limit=100').set('Authorization', bearer(teacher.accessToken));
      const roster = await request(app.getHttpServer()).get(`/api/v1/teacher/classes/${developmentId(405)}/roster`).set('Authorization', bearer(teacher.accessToken));
      const crossSchoolRoster = await request(app.getHttpServer()).get(`/api/v1/teacher/classes/${developmentId(505)}/roster`).set('Authorization', bearer(teacher.accessToken));

      expect(classes.status).toBe(200);
      expect(classes.body.items.map((row: { assignment: { id: string } }) => row.assignment.id)).toEqual([developmentId(405)]);
      expect(roster.status).toBe(200);
      expect(roster.body.items.map((row: { student: { id: string } }) => row.student.id)).toEqual([developmentId(112)]);
      expect(crossSchoolRoster.status).toBe(404);
    });

    it('limits student classes, subjects, and enrollments to the current student', async () => {
      const student = await login(app, 'student1@wasl.test');
      const auth = bearer(student.accessToken);
      const classes = await request(app.getHttpServer()).get('/api/v1/me/classes?limit=100').set('Authorization', auth);
      const subjects = await request(app.getHttpServer()).get('/api/v1/me/subjects?limit=100').set('Authorization', auth);
      const enrollments = await request(app.getHttpServer()).get('/api/v1/enrollments?limit=100').set('Authorization', auth);

      expect(classes.status).toBe(200);
      expect(classes.body.items.map((row: { assignment: { id: string } }) => row.assignment.id)).toEqual([developmentId(405)]);
      expect(subjects.status).toBe(200);
      expect(subjects.body.items.map((row: { id: string }) => row.id)).toEqual([developmentId(404)]);
      expect(enrollments.status).toBe(200);
      expect(enrollments.body.items.every((row: { studentId: string }) => row.studentId === developmentId(112))).toBe(true);
    });
  });

  describe('parent-student access', () => {
    it('lists only verified children across both active schools', async () => {
      const parent = await login(app, 'parent@wasl.test');
      const response = await request(app.getHttpServer()).get('/api/v1/parent/children?limit=100').set('Authorization', bearer(parent.accessToken));

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(2);
      expect(response.body.items.map((child: { student: { id: string } }) => child.student.id).sort()).toEqual([developmentId(112), developmentId(122)].sort());
      expect(response.body.items.map((child: { school: { id: string } }) => child.school.id).sort()).toEqual([developmentId(1), developmentId(2)].sort());
    });

    it('reads verified child overviews in both schools without arbitrary child access', async () => {
      const parent = await login(app, 'parent@wasl.test');
      const auth = bearer(parent.accessToken);
      const school1 = await request(app.getHttpServer()).get(`/api/v1/parent/children/${developmentId(112)}/overview?schoolId=${developmentId(1)}`).set('Authorization', auth);
      const school2 = await request(app.getHttpServer()).get(`/api/v1/parent/children/${developmentId(122)}/overview?schoolId=${developmentId(2)}`).set('Authorization', auth);
      const wrongSchool = await request(app.getHttpServer()).get(`/api/v1/parent/children/${developmentId(122)}/overview?schoolId=${developmentId(1)}`).set('Authorization', auth);
      const arbitrary = await request(app.getHttpServer()).get(`/api/v1/parent/children/${randomUUID()}/overview`).set('Authorization', auth);

      expect(school1.status).toBe(200);
      expect(school1.body).toMatchObject({ school: { id: developmentId(1) }, student: { id: developmentId(112) } });
      expect(school2.status).toBe(200);
      expect(school2.body).toMatchObject({ school: { id: developmentId(2) }, student: { id: developmentId(122) } });
      expect(wrongSchool.status).toBe(404);
      expect(arbitrary.status).toBe(404);
    });

    it('removes access immediately when a School Admin revokes a verified link', async () => {
      const parent = await login(app, 'parent@wasl.test');
      const admin = await login(app, 'admin1@wasl.test');
      const revoked = await request(app.getHttpServer())
        .patch(`/api/v1/parent-links/${developmentId(601)}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ status: 'REJECTED' });
      expect(revoked.status).toBe(200);

      const overview = await request(app.getHttpServer()).get(`/api/v1/parent/children/${developmentId(112)}/overview`).set('Authorization', bearer(parent.accessToken));
      const children = await request(app.getHttpServer()).get('/api/v1/parent/children?limit=100').set('Authorization', bearer(parent.accessToken));
      expect(overview.status).toBe(404);
      expect(children.status).toBe(200);
      expect(children.body.items.map((child: { student: { id: string } }) => child.student.id)).toEqual([developmentId(122)]);
    });

    it('removes parent access when the child school membership becomes inactive', async () => {
      const parent = await login(app, 'parent@wasl.test');
      const admin = await login(app, 'admin1@wasl.test');
      const disabled = await request(app.getHttpServer())
        .patch(`/api/v1/memberships/${developmentId(432)}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ active: false });
      expect(disabled.status).toBe(200);

      const overview = await request(app.getHttpServer()).get(`/api/v1/parent/children/${developmentId(112)}/overview`).set('Authorization', bearer(parent.accessToken));
      const children = await request(app.getHttpServer()).get('/api/v1/parent/children?limit=100').set('Authorization', bearer(parent.accessToken));
      expect(overview.status).toBe(404);
      expect(children.status).toBe(200);
      expect(children.body.items.map((child: { student: { id: string } }) => child.student.id)).toEqual([developmentId(122)]);
    });

    it('rejects parent-link creation when either identity lacks the required same-school role', async () => {
      const admin = await login(app, 'admin1@wasl.test');
      const response = await request(app.getHttpServer())
        .post('/api/v1/parent-links')
        .set('Authorization', bearer(admin.accessToken))
        .send({ parentId: developmentId(130), studentId: developmentId(122) });
      expect(response.status).toBe(404);
    });
  });
});
