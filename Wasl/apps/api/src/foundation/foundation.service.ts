import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import type { AcademicDtoMap, AcademicOverviewDto, ChildDto, ClassDto, Page, Role, RosterEntryDto } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import { requireActor } from './authorization';
import type { AcademicKind, AcademicMap, AcademicYear, Enrollment, ParentLink, Person, Section, SectionSubject, Semester } from './entities';
import { academicDto, linkDto, memberDto, schoolDto, userDto } from './mapping';
import { STORAGE } from './repositories';
import type { FoundationStorage, Repositories } from './repositories';
import type { AcademicListDto, CreateLinkDto, CreateMembershipDto, CreateSchoolDto, CreateUserDto, LinkListDto, ListDto, PeopleListDto, ProfileDto, SchoolAdministratorDto, SchoolListDto, UpdateSchoolDto } from './dto';

const notFound = () => new NotFoundException('Record not found');
const requireValue = <T>(value: T | undefined): T => { if (value === undefined) throw new BadRequestException('A required field is missing'); return value; };
const dateOnly = (value: string): Date => { const d = new Date(value + 'T00:00:00.000Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== value) throw new BadRequestException('Use a valid YYYY-MM-DD calendar date'); return d; };
const immutable = (before: string | undefined, after: string) => { if (before !== undefined && before !== after) throw new ConflictException('Relationship identifiers are immutable; create a new relationship to preserve history'); };
type AcademicWrite = { name?: string; startDate?: string; endDate?: string; archived?: boolean; academicYearId?: string; gradeId?: string; level?: number; nameAr?: string; nameEn?: string; code?: string | null; sectionId?: string; subjectId?: string; teacherId?: string | null; studentId?: string; status?: Enrollment['status'] };

/** Pagination and ordering happen AFTER relationship scope. No client-provided field names reach an ORM. */
export function pageOf<T extends { id: string }>(rows: T[], query: ListDto, name: (row: T) => string): Page<T> {
  const search = query.search?.toLocaleLowerCase() ?? '';
  const items = rows.filter(row => !search || name(row).toLocaleLowerCase().includes(search));
  items.sort((a,b) => (query.sort === 'id' ? a.id.localeCompare(b.id) : name(a).localeCompare(name(b))) * (query.order === 'desc' ? -1 : 1) || a.id.localeCompare(b.id));
  return { items: items.slice((query.page - 1) * query.limit, query.page * query.limit), total: items.length, page: query.page, limit: query.limit };
}

@Injectable()
export class FoundationService {
  constructor(@Inject(STORAGE) private storage: FoundationStorage) {}
  private school<T>(actor: AuthUser, roles: readonly Role[], work: (r: Repositories) => Promise<T>) {
    if (!actor.schoolId) throw new ForbiddenException('An active school role is required');
    return this.storage.run({ kind: 'school', userId: actor.sub, schoolId: actor.schoolId }, async r => { await requireActor(r, actor, roles); return work(r); });
  }
  private platform<T>(actor: AuthUser, work: (r: Repositories) => Promise<T>, targetSchoolId: string | null = null) {
    if (actor.role !== 'PLATFORM_ADMIN') throw new ForbiddenException();
    return this.storage.run({ kind: 'platform', userId: actor.sub, schoolId: targetSchoolId }, async r => { await requireActor(r, actor, ['PLATFORM_ADMIN']); return work(r); });
  }
  listSchools(actor: AuthUser, q: SchoolListDto) {
    return this.platform(actor, async r => {
      const schools = (await r.schools.list()).filter(s => !q.active || s.active === (q.active === 'true'));
      const page = pageOf(schools, q, s => s.name + ' ' + (s.nameAr ?? ''));
      return { ...page, items: await Promise.all(page.items.map(async s => ({ ...schoolDto(s), studentCount: await r.schools.countPeople(s.id, 'STUDENT'), teacherCount: await r.schools.countPeople(s.id, 'TEACHER') }))) };
    });
  }
  getSchool(actor: AuthUser, id: string) { return this.platform(actor, async r => { const s = await r.schools.get(id); if (!s) throw notFound(); return { ...schoolDto(s), studentCount: await r.schools.countPeople(id, 'STUDENT'), teacherCount: await r.schools.countPeople(id, 'TEACHER') }; }); }
  createSchool(actor: AuthUser, input: CreateSchoolDto) {
    return this.platform(actor, async r => schoolDto(await r.schools.create({ id: randomUUID(), name: input.name, nameAr: input.nameAr ?? null, locale: input.locale ?? 'ar', active: true, createdAt: new Date() })));
  }
  updateSchool(actor: AuthUser, id: string, input: UpdateSchoolDto) {
    return this.platform(actor, async r => {
      if (!await r.schools.get(id)) throw notFound();
      const patch: UpdateSchoolDto = {};
      for (const key of ['name', 'nameAr', 'locale', 'active'] as const) if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
      return schoolDto(await r.schools.update(id, patch));
    });
  }
  async provisionAdministrator(actor: AuthUser, schoolId: string, input: SchoolAdministratorDto) {
    if (actor.role !== 'PLATFORM_ADMIN') throw new ForbiddenException();
    if (input.password !== undefined && Buffer.byteLength(input.password, 'utf8') > 72) throw new BadRequestException('Password exceeds 72 UTF-8 bytes');
    const passwordHash = input.password === undefined ? undefined : await bcrypt.hash(input.password, 12);
    // Explicit platform school-management exception: only a SCHOOL_ADMIN can be provisioned.
    return this.platform(actor, async r => {
      if (!(await r.schools.get(schoolId))?.active) throw notFound();
      let user = await r.identity.personByEmail(input.email.trim().toLowerCase());
      if (user) {
        if (!user.active) throw notFound();
        if (input.fullName !== undefined || input.password !== undefined || input.preferredLanguage !== undefined) throw new BadRequestException('For an existing identity supply email only; profile and password are not overwritten');
      } else {
        if (!input.fullName || !passwordHash) throw new BadRequestException('A new identity requires fullName and password');
        user = await r.identity.createPerson({ id: randomUUID(), email: input.email.trim().toLowerCase(), fullName: input.fullName, passwordHash, preferredLanguage: input.preferredLanguage ?? 'ar', active: true, createdAt: new Date() });
      }
      const userId = user.id;
      const previous = (await r.people.memberships()).find(m => m.userId === userId && m.role === 'SCHOOL_ADMIN');
      if (previous?.active) throw new ConflictException('Administrator membership already exists');
      const membership = previous ? await r.people.setMembershipActive(previous.id, true) : await r.people.createMembership({ id: randomUUID(), userId: user.id, schoolId, role: 'SCHOOL_ADMIN', active: true, createdAt: new Date() });
      return { user: userDto(user), membership: memberDto(membership) };
    }, schoolId);
  }
  listUsers(actor: AuthUser, q: PeopleListDto) {
    return this.school(actor, ['SCHOOL_ADMIN'], async r => {
      const members = (await r.people.memberships()).filter(m => (!q.role || m.role === q.role) && (!q.active || m.active === (q.active === 'true')));
      const users: Person[] = [];
      for (const id of new Set(members.map(m => m.userId))) { const u = await r.identity.personById(id); if (u) users.push(u); }
      const page = pageOf(users, q, u => u.fullName + ' ' + u.email); return { ...page, items: page.items.map(userDto) };
    });
  }
  getUser(actor: AuthUser, id: string) { return this.school(actor, ['SCHOOL_ADMIN'], async r => { if (!(await r.people.memberships()).some(m => m.userId === id)) throw notFound(); const u = await r.identity.personById(id); if (!u) throw notFound(); return userDto(u); }); }
  async createUser(actor: AuthUser, input: CreateUserDto) {
    if (actor.role !== 'SCHOOL_ADMIN' || !actor.schoolId) throw new ForbiddenException();
    if (Buffer.byteLength(input.password, 'utf8') > 72) throw new BadRequestException('Password exceeds 72 UTF-8 bytes');
    const passwordHash = await bcrypt.hash(input.password, 12);
    return this.school(actor, ['SCHOOL_ADMIN'], async r => {
      const email = input.email.trim().toLowerCase();
      if (await r.identity.personByEmail(email)) throw new ConflictException('Identity already exists; use the membership endpoint');
      const user = await r.identity.createPerson({ id: randomUUID(), email, fullName: input.fullName, passwordHash, preferredLanguage: input.preferredLanguage ?? 'ar', active: true, createdAt: new Date() });
      const membership = await r.people.createMembership({ id: randomUUID(), schoolId: actor.schoolId!, userId: user.id, role: input.role, active: true, createdAt: new Date() });
      return { user: userDto(user), membership: memberDto(membership) };
    });
  }
  addMembership(actor: AuthUser, input: CreateMembershipDto) {
    return this.school(actor, ['SCHOOL_ADMIN'], async r => {
      const user = await r.identity.personByEmail(input.email.trim().toLowerCase()); if (!user?.active) throw notFound();
      const row = await r.people.createMembership({ id: randomUUID(), userId: user.id, schoolId: actor.schoolId!, role: input.role, active: true, createdAt: new Date() });
      return memberDto(row);
    });
  }
  listMemberships(actor: AuthUser, q: PeopleListDto) {
    return this.school(actor, ['SCHOOL_ADMIN'], async r => {
      const rows = (await r.people.memberships()).filter(m => (!q.role || m.role === q.role) && (!q.active || m.active === (q.active === 'true')));
      const names = new Map<string, string>(); for (const m of rows) { const u = await r.identity.personById(m.userId); names.set(m.id, (u?.fullName ?? '') + ' ' + (u?.email ?? '') + ' ' + m.role); }
      const page = pageOf(rows, q, m => names.get(m.id) ?? m.id); return { ...page, items: page.items.map(memberDto) };
    });
  }
  membership(actor: AuthUser, id: string, active?: boolean) { return this.school(actor, ['SCHOOL_ADMIN'], async r => {
    const found = (await r.people.memberships()).find(m => m.id === id); if (!found) throw notFound();
    if (active === true && !(await r.identity.personById(found.userId))?.active) throw new ConflictException('The global user is inactive');
    return memberDto(active === undefined ? found : await r.people.setMembershipActive(id, active));
  }); }
  updateProfile(actor: AuthUser, input: ProfileDto) {
    return this.storage.run({ kind: 'identity', schoolId: null, userId: actor.sub }, async r => {
      await requireActor(r, actor); const u = await r.identity.personById(actor.sub); if (!u) throw notFound();
      return userDto(await r.identity.updateProfile(actor.sub, { fullName: input.fullName ?? u.fullName, preferredLanguage: input.preferredLanguage ?? u.preferredLanguage }));
    });
  }
  private async visibleAcademic<K extends AcademicKind>(r: Repositories, actor: Pick<AuthUser, 'role' | 'sub'>, kind: K): Promise<AcademicMap[K][]> {
    const rows = await r.academics.list(kind); if (actor.role === 'SCHOOL_ADMIN') return rows;
    if (!['TEACHER', 'STUDENT'].includes(actor.role)) throw new ForbiddenException();
    const years = await r.academics.list('academicYears'); const grades = await r.academics.list('grades');
    const sections = (await r.academics.list('sections')).filter(s => years.some(y => y.id === s.academicYearId && !y.archived) && grades.some(g => g.id === s.gradeId));
    const enrollments = (await r.academics.list('enrollments')).filter(e => e.status === 'ACTIVE' && sections.some(s => s.id === e.sectionId));
    const subjects = await r.academics.list('subjects');
    const allAssignments = (await r.academics.list('sectionSubjects')).filter(a => sections.some(s => s.id === a.sectionId) && subjects.some(s => s.id === a.subjectId));
    const assignments = actor.role === 'TEACHER' ? allAssignments.filter(a => a.teacherId === actor.sub) : allAssignments.filter(a => enrollments.some(e => e.studentId === actor.sub && e.sectionId === a.sectionId));
    const sectionIds = new Set(actor.role === 'TEACHER' ? assignments.map(a => a.sectionId) : enrollments.filter(e => e.studentId === actor.sub).map(e => e.sectionId));
    const yearIds = new Set(sections.filter(s => sectionIds.has(s.id)).map(s => s.academicYearId)); const gradeIds = new Set(sections.filter(s => sectionIds.has(s.id)).map(s => s.gradeId));
    if (kind === 'sectionSubjects') return assignments as AcademicMap[K][];
    if (kind === 'enrollments') {
      const result: Enrollment[] = []; for (const e of enrollments) if ((actor.role === 'TEACHER' ? sectionIds.has(e.sectionId) : e.studentId === actor.sub) && await r.people.eligible(e.studentId, 'STUDENT')) result.push(e);
      return result as AcademicMap[K][];
    }
    return rows.filter(row => kind === 'sections' ? sectionIds.has(row.id) : kind === 'academicYears' ? yearIds.has(row.id) : kind === 'grades' ? gradeIds.has(row.id) : kind === 'subjects' ? assignments.some(a => a.subjectId === row.id) : kind === 'semesters' ? yearIds.has((row as Semester).academicYearId) : false);
  }
  listAcademic<K extends AcademicKind>(actor: AuthUser, kind: K, q: AcademicListDto): Promise<Page<AcademicDtoMap[K]>> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT'], async r => {
      const sections = await this.visibleAcademic(r, actor, 'sections');
      const assignments = await this.visibleAcademic(r, actor, 'sectionSubjects');
      const matchesSection = (row: AcademicMap[K], section: Section) => kind === 'sections' ? row.id === section.id : kind === 'academicYears' ? row.id === section.academicYearId : kind === 'grades' ? row.id === section.gradeId : kind === 'semesters' ? (row as Semester).academicYearId === section.academicYearId : kind === 'subjects' ? assignments.some(a => a.sectionId === section.id && a.subjectId === row.id) : 'sectionId' in row && row.sectionId === section.id;
      const rows = (await this.visibleAcademic(r, actor, kind)).filter(row =>
        (!q.sectionId || sections.some(s => s.id === q.sectionId && matchesSection(row,s))) &&
        (!q.academicYearId || (kind === 'academicYears' ? row.id === q.academicYearId : 'academicYearId' in row ? row.academicYearId === q.academicYearId : sections.some(s => s.academicYearId === q.academicYearId && matchesSection(row,s)))) &&
        (!q.status || 'status' in row && row.status === q.status));
      const page = pageOf(rows, q, row => 'name' in row ? row.name : 'nameEn' in row ? row.nameEn + ' ' + row.nameAr : row.id);
      return { ...page, items: page.items.map(row => academicDto(kind, row)) };
    });
  }
  getAcademic<K extends AcademicKind>(actor: AuthUser, kind: K, id: string) { return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT'], async r => { const row = (await this.visibleAcademic(r, actor, kind)).find(v => v.id === id); if (!row) throw notFound(); return academicDto(kind, row); }); }
  saveAcademic<K extends AcademicKind>(actor: AuthUser, kind: K, input: AcademicWrite, id?: string): Promise<AcademicDtoMap[K]> {
    return this.school(actor, ['SCHOOL_ADMIN'], async r => {
      const old = id ? await r.academics.get(kind, id) : null; if (id && !old) throw notFound();
      const base = { id: old?.id ?? randomUUID(), schoolId: actor.schoolId! };
      const builders = {
        academicYears: () => { const o = old as AcademicYear | null; return { ...base, name: requireValue(input.name ?? o?.name), startDate: input.startDate !== undefined ? dateOnly(input.startDate) : requireValue(o?.startDate), endDate: input.endDate !== undefined ? dateOnly(input.endDate) : requireValue(o?.endDate), archived: input.archived ?? o?.archived ?? false }; },
        semesters: () => { const o = old as Semester | null; const academicYearId = requireValue(input.academicYearId ?? o?.academicYearId); immutable(o?.academicYearId, academicYearId); return { ...base, academicYearId, name: requireValue(input.name ?? o?.name), startDate: input.startDate !== undefined ? dateOnly(input.startDate) : requireValue(o?.startDate), endDate: input.endDate !== undefined ? dateOnly(input.endDate) : requireValue(o?.endDate) }; },
        grades: () => { const o = old as AcademicMap['grades'] | null; return { ...base, name: requireValue(input.name ?? o?.name), level: requireValue(input.level ?? o?.level) }; },
        sections: () => { const o = old as Section | null; const gradeId = requireValue(input.gradeId ?? o?.gradeId); const academicYearId = requireValue(input.academicYearId ?? o?.academicYearId); immutable(o?.gradeId, gradeId); immutable(o?.academicYearId, academicYearId); return { ...base, gradeId, academicYearId, name: requireValue(input.name ?? o?.name) }; },
        subjects: () => { const o = old as AcademicMap['subjects'] | null; return { ...base, nameAr: requireValue(input.nameAr ?? o?.nameAr), nameEn: requireValue(input.nameEn ?? o?.nameEn), code: input.code === undefined ? o?.code ?? null : input.code }; },
        sectionSubjects: () => { const o = old as SectionSubject | null; const sectionId = requireValue(input.sectionId ?? o?.sectionId); const subjectId = requireValue(input.subjectId ?? o?.subjectId); immutable(o?.sectionId, sectionId); immutable(o?.subjectId, subjectId); return { ...base, sectionId, subjectId, teacherId: input.teacherId === undefined ? o?.teacherId ?? null : input.teacherId }; },
        enrollments: () => { const o = old as Enrollment | null; const sectionId = requireValue(input.sectionId ?? o?.sectionId); const studentId = requireValue(input.studentId ?? o?.studentId); immutable(o?.sectionId, sectionId); immutable(o?.studentId, studentId); return { ...base, sectionId, studentId, status: input.status ?? o?.status ?? 'ACTIVE', createdAt: o?.createdAt ?? new Date() }; },
      };
      const row = builders[kind]() as AcademicMap[K]; await this.validateAcademic(r, kind, row, !old);
      return academicDto(kind, old ? await r.academics.update(kind, row) : await r.academics.create(kind, row));
    });
  }
  private async validateAcademic<K extends AcademicKind>(r: Repositories, kind: K, row: AcademicMap[K], create: boolean) {
    const year = async (id: string, open = false) => { const y = await r.academics.get('academicYears', id); if (!y) throw notFound(); if (open && y.archived) throw new ConflictException('Academic year is archived'); return y; };
    if (kind === 'academicYears' || kind === 'semesters') {
      const value = row as AcademicYear | Semester;
      if (value.startDate > value.endDate) throw new BadRequestException('Start date must not follow end date');
      if (kind === 'semesters') { const y = await year((value as Semester).academicYearId, create); if (value.startDate < y.startDate || value.endDate > y.endDate) throw new BadRequestException('Semester dates must be inside its academic year'); }
      else for (const semester of await r.academics.list('semesters')) if (semester.academicYearId === row.id && (semester.startDate < value.startDate || semester.endDate > value.endDate)) throw new ConflictException('Existing semester dates would fall outside this year');
    }
    if (kind === 'sections') { const v = row as Section; if (!await r.academics.get('grades', v.gradeId)) throw notFound(); await year(v.academicYearId, create); }
    if (kind === 'sectionSubjects' || kind === 'enrollments') {
      const v = row as SectionSubject | Enrollment; const section = await r.academics.get('sections', v.sectionId); if (!section) throw notFound();
      if (!await r.academics.get('grades', section.gradeId)) throw notFound();
      await year(section.academicYearId, create || kind === 'enrollments' && (v as Enrollment).status === 'ACTIVE');
      if (kind === 'sectionSubjects') { const a = v as SectionSubject; if (!await r.academics.get('subjects', a.subjectId)) throw notFound(); if (a.teacherId && !await r.people.eligible(a.teacherId, 'TEACHER')) throw notFound(); }
      else {
        const e = v as Enrollment;
        if (e.status === 'ACTIVE') { if (!await r.people.eligible(e.studentId, 'STUDENT')) throw notFound(); }
        else if (!(await r.people.memberships()).some(m => m.userId === e.studentId && m.role === 'STUDENT') || !await r.identity.personById(e.studentId)) throw notFound();
      }
    }
  }
  private async classDto(r: Repositories, assignment: SectionSubject): Promise<ClassDto> {
    const section = await r.academics.get('sections', assignment.sectionId); const subject = await r.academics.get('subjects', assignment.subjectId); if (!section || !subject) throw notFound();
    const grade = await r.academics.get('grades', section.gradeId); const year = await r.academics.get('academicYears', section.academicYearId); if (!grade || !year) throw notFound();
    const teacher = assignment.teacherId && await r.people.eligible(assignment.teacherId, 'TEACHER') ? await r.identity.personById(assignment.teacherId) : null;
    return { assignment: academicDto('sectionSubjects', assignment), section: academicDto('sections', section), subject: academicDto('subjects', subject), grade: academicDto('grades', grade), academicYear: academicDto('academicYears', year), teacher: teacher ? { id: teacher.id, fullName: teacher.fullName } : null };
  }
  classes(actor: AuthUser, q: ListDto) { return this.school(actor, ['TEACHER', 'STUDENT'], async r => {
    const rows = await Promise.all((await this.visibleAcademic(r, actor, 'sectionSubjects')).map(a => this.classDto(r, a)));
    const page = pageOf(rows.map(c => ({ ...c, id: c.assignment.id })), q, c => c.subject.nameEn + ' ' + c.subject.nameAr + ' ' + c.section.name);
    return { ...page, items: page.items.map(({ id: _id, ...c }) => c) };
  }); }
  roster(actor: AuthUser, assignmentId: string, q: ListDto) { return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async r => {
    const assignment = (await this.visibleAcademic(r, actor, 'sectionSubjects')).find(a => a.id === assignmentId); if (!assignment) throw notFound();
    const entries: (RosterEntryDto & { id: string })[] = [];
    for (const e of await this.visibleAcademic(r, actor, 'enrollments')) if (e.sectionId === assignment.sectionId && e.status === 'ACTIVE' && await r.people.eligible(e.studentId, 'STUDENT')) {
      const student = await r.identity.personById(e.studentId); if (student) entries.push({ id: e.id, enrollment: academicDto('enrollments', e), student: { id: student.id, fullName: student.fullName } });
    }
    const page = pageOf(entries, q, e => e.student.fullName); return { ...page, items: page.items.map(({ id: _id, ...row }) => row) };
  }); }
  overview(actor: AuthUser) { return this.school(actor, ['SCHOOL_ADMIN'], r => this.overviewInside(r, actor)); }
  private async overviewInside(r: Repositories, actor: Pick<AuthUser, 'role' | 'sub' | 'schoolId'>, student?: Person): Promise<AcademicOverviewDto> {
    const school = await r.schools.get(actor.schoolId!); if (!school) throw notFound();
    const rows = await this.visibleAcademic(r, actor, 'sectionSubjects'); const enrollments = await this.visibleAcademic(r, actor, 'enrollments');
    return { school: schoolDto(school), student: student ? { id: student.id, fullName: student.fullName } : null, classes: await Promise.all(rows.map(a => this.classDto(r, a))), enrollments: enrollments.map(e => academicDto('enrollments', e)), counts: { academicYears: (await this.visibleAcademic(r, actor, 'academicYears')).length, sections: (await this.visibleAcademic(r, actor, 'sections')).length, subjects: (await this.visibleAcademic(r, actor, 'subjects')).length, assignments: rows.length, activeEnrollments: enrollments.filter(e => e.status === 'ACTIVE').length } };
  }
  links(actor: AuthUser, q: LinkListDto) { return this.school(actor, ['SCHOOL_ADMIN'], async r => { const page = pageOf((await r.links.list()).filter(l => !q.status || l.status === q.status), q, l => l.parentId + ' ' + l.studentId); return { ...page, items: page.items.map(linkDto) }; }); }
  getLink(actor: AuthUser, id: string) { return this.school(actor, ['SCHOOL_ADMIN'], async r => { const link = await r.links.get(id); if (!link) throw notFound(); return linkDto(link); }); }
  createLink(actor: AuthUser, input: CreateLinkDto) { return this.school(actor, ['SCHOOL_ADMIN'], async r => {
    if (input.parentId === input.studentId || !await r.people.eligible(input.parentId, 'PARENT') || !await r.people.eligible(input.studentId, 'STUDENT')) throw notFound();
    return linkDto(await r.links.create({ id: randomUUID(), schoolId: actor.schoolId!, parentId: input.parentId, studentId: input.studentId, status: 'PENDING', verifiedAt: null, createdAt: new Date() }));
  }); }
  linkStatus(actor: AuthUser, id: string, status: ParentLink['status']) { return this.school(actor, ['SCHOOL_ADMIN'], async r => {
    const link = await r.links.get(id); if (!link) throw notFound();
    if (status === 'VERIFIED' && (!await r.people.eligible(link.parentId, 'PARENT') || !await r.people.eligible(link.studentId, 'STUDENT'))) throw notFound();
    return linkDto(await r.links.update({ ...link, status, verifiedAt: status === 'VERIFIED' ? link.status === 'VERIFIED' ? link.verifiedAt ?? new Date() : new Date() : null }));
  }); }
  private async parentLinks(actor: AuthUser) {
    if (actor.role !== 'PARENT') throw new ForbiddenException();
    // Exact own-parent identity lookup without tenant bypass. No arbitrary child lookup here.
    return this.storage.run({ kind: 'parent-list', userId: actor.sub, schoolId: null }, async r => { await requireActor(r, actor, ['PARENT']); return r.links.forParent(actor.sub); });
  }
  private parentChild<T>(actor: AuthUser, link: ParentLink, work: (r: Repositories, student: Person) => Promise<T>) {
    return this.storage.run({ kind: 'school', userId: actor.sub, schoolId: link.schoolId }, async r => {
      await requireActor(r, actor, ['PARENT']);
      const current = (await r.links.forParent(actor.sub)).find(l => l.id === link.id && l.studentId === link.studentId && l.status === 'VERIFIED');
      if (!current || !(await r.schools.get(link.schoolId))?.active || !await r.people.eligible(actor.sub, 'PARENT') || !await r.people.eligible(link.studentId, 'STUDENT')) throw notFound();
      const student = await r.identity.personById(link.studentId); if (!student?.active) throw notFound(); return work(r, student);
    });
  }
  async children(actor: AuthUser, q: ListDto): Promise<Page<ChildDto>> {
    const links = await this.parentLinks(actor); const items: (ChildDto & { id: string })[] = [];
    for (const link of links) {
      try { items.push(await this.parentChild(actor, link, async (r, student) => { const current = await r.links.get(link.id); const school = await r.schools.get(link.schoolId); if (!current || !school) throw notFound(); return { id: link.id, link: linkDto(current), school: schoolDto(school), student: { id: student.id, fullName: student.fullName } }; })); }
      catch (e) { if (!(e instanceof NotFoundException)) throw e; }
    }
    const page = pageOf(items, q, c => c.student.fullName + ' ' + c.school.name); return { ...page, items: page.items.map(({ id: _id, ...c }) => c) };
  }
  async childOverview(actor: AuthUser, studentId: string, schoolId?: string) {
    const link = (await this.parentLinks(actor)).find(l => l.studentId === studentId && (!schoolId || l.schoolId === schoolId)); if (!link) throw notFound();
    // Reuse the enrolled-student read projection AFTER link authorization; this is not a token/session.
    return this.parentChild(actor, link, (r, student) => this.overviewInside(r, { sub: student.id, schoolId: link.schoolId, role: 'STUDENT' }, student));
  }
}
