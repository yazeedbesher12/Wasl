import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AcademicKind, AcademicMap, Membership } from './entities';
import type { FoundationStorage, Repositories, StorageScope } from './repositories';
import type { MemoryState } from './memory.seed';

const missing = () => new NotFoundException('Record not found');
/** Serialized copy-on-write units of work: failures roll back and refresh claims cannot race. */
export class MemoryStorage implements FoundationStorage {
  readonly driver = 'memory' as const; private tail: Promise<void> = Promise.resolve();
  constructor(private state: MemoryState) {}
  async ready() { if (!Array.isArray(this.state.schools) || !Array.isArray(this.state.users)) throw new Error('Memory storage is unavailable'); }
  async run<T>(scope: StorageScope, work: (r: Repositories) => Promise<T>): Promise<T> {
    let release!: () => void; const previous = this.tail; this.tail = new Promise<void>(resolve => { release = resolve; }); await previous;
    try { const draft = structuredClone(this.state); const result = structuredClone(await work(this.repositories(draft, scope))); this.state = draft; return result; }
    finally { release(); }
  }
  private repositories(s: MemoryState, scope: StorageScope): Repositories {
    const scoped = (row: { schoolId: string | null }) => scope.schoolId !== null && row.schoolId === scope.schoolId;
    const unique = (duplicate: boolean) => { if (duplicate) throw new ConflictException('A record with these unique fields already exists'); };
    const reference = (exists: unknown) => { if (!exists) throw new NotFoundException('Referenced record not found'); };
    const person = (id: string) => s.users.find(u => u.id === id);
    const eligible = (userId: string, role: Membership['role']) => !!person(userId)?.active && s.memberships.some(m => scoped(m) && m.userId === userId && m.role === role && m.active);
    const putAcademic = <K extends AcademicKind>(kind: K, row: AcademicMap[K], create: boolean): AcademicMap[K] => {
      if (!scoped(row)) throw missing();
      const table = s.academics[kind] as AcademicMap[K][]; const index = table.findIndex(r => r.id === row.id && scoped(r));
      if (create) unique(table.some(r => r.id === row.id)); else if (index < 0) throw missing();
      reference(s.schools.find(r => r.id === row.schoolId));
      const others = table.filter(r => r.id !== row.id);
      switch (kind) {
        case 'academicYears': { const r = row as AcademicMap['academicYears']; unique((others as AcademicMap['academicYears'][]).some(v => v.schoolId === r.schoolId && v.name === r.name)); break; }
        case 'semesters': { const r = row as AcademicMap['semesters']; reference(s.academics.academicYears.find(v => v.id === r.academicYearId && scoped(v))); break; }
        case 'grades': { const r = row as AcademicMap['grades']; unique((others as AcademicMap['grades'][]).some(v => v.schoolId === r.schoolId && v.level === r.level)); break; }
        case 'sections': { const r = row as AcademicMap['sections']; reference(s.academics.grades.find(v => v.id === r.gradeId && scoped(v))); reference(s.academics.academicYears.find(v => v.id === r.academicYearId && scoped(v))); unique((others as AcademicMap['sections'][]).some(v => v.gradeId === r.gradeId && v.academicYearId === r.academicYearId && v.name === r.name)); break; }
        case 'sectionSubjects': { const r = row as AcademicMap['sectionSubjects']; reference(s.academics.sections.find(v => v.id === r.sectionId && scoped(v))); reference(s.academics.subjects.find(v => v.id === r.subjectId && scoped(v))); if (r.teacherId) reference(eligible(r.teacherId, 'TEACHER')); unique((others as AcademicMap['sectionSubjects'][]).some(v => v.sectionId === r.sectionId && v.subjectId === r.subjectId)); break; }
        case 'enrollments': { const r = row as AcademicMap['enrollments']; reference(s.academics.sections.find(v => v.id === r.sectionId && scoped(v))); reference(person(r.studentId)); unique((others as AcademicMap['enrollments'][]).some(v => v.sectionId === r.sectionId && v.studentId === r.studentId)); break; }
      }
      if (create) table.push(row); else table[index] = row;
      return row;
    };
    return {
      identity: {
        personById: async id => person(id) ?? null, personByEmail: async email => s.users.find(u => u.email === email) ?? null,
        membershipsFor: async id => s.memberships.filter(m => m.userId === id),
        createPerson: async row => { unique(s.users.some(u => u.email === row.email || u.id === row.id)); s.users.push(row); return row; },
        updateProfile: async (id, patch) => { const user = person(id); if (!user) throw missing(); Object.assign(user, patch); return user; },
        refreshByHash: async hash => s.refresh.find(t => t.tokenHash === hash) ?? null,
        createRefresh: async row => { reference(person(row.userId)); unique(s.refresh.some(t => t.tokenHash === row.tokenHash || t.id === row.id)); s.refresh.push(row); },
        consumeRefresh: async (hash, at) => { const token = s.refresh.find(t => t.tokenHash === hash && !t.revokedAt && t.expiresAt > at); if (!token) return false; token.revokedAt = at; return true; },
        revokeRefresh: async (hash, at) => { const token = s.refresh.find(t => t.tokenHash === hash && !t.revokedAt); if (token) token.revokedAt = at; },
      },
      schools: {
        list: async () => { if (scope.kind !== 'platform') throw new ForbiddenException(); return s.schools; },
        get: async id => s.schools.find(v => v.id === id) ?? null,
        create: async row => { if (scope.kind !== 'platform') throw new ForbiddenException(); unique(s.schools.some(v => v.id === row.id)); s.schools.push(row); return row; },
        update: async (id, patch) => { if (scope.kind !== 'platform') throw new ForbiddenException(); const row = s.schools.find(v => v.id === id); if (!row) throw missing(); Object.assign(row, patch); return row; },
        countPeople: async (id, role) => new Set(s.memberships.filter(m => m.schoolId === id && m.role === role && m.active && person(m.userId)?.active).map(m => m.userId)).size,
      },
      people: {
        memberships: async () => s.memberships.filter(scoped), eligible: async (id, role) => eligible(id, role),
        createMembership: async row => { if (!scoped(row) || row.role === 'PLATFORM_ADMIN') throw missing(); reference(person(row.userId)); reference(s.schools.find(v => v.id === row.schoolId)); unique(s.memberships.some(m => m.id === row.id || m.userId === row.userId && m.schoolId === row.schoolId && m.role === row.role)); s.memberships.push(row); return row; },
        setMembershipActive: async (id, active) => { const row = s.memberships.find(m => m.id === id && scoped(m)); if (!row) throw missing(); row.active = active; return row; },
      },
      academics: {
        list: async <K extends AcademicKind>(kind: K) => (s.academics[kind] as AcademicMap[K][]).filter(scoped),
        get: async <K extends AcademicKind>(kind: K, id: string) => (s.academics[kind] as AcademicMap[K][]).find(v => v.id === id && scoped(v)) ?? null,
        create: async (kind, row) => putAcademic(kind, row, true), update: async (kind, row) => putAcademic(kind, row, false),
      },
      links: {
        list: async () => s.links.filter(scoped),
        forParent: async id => id === scope.userId ? s.links.filter(l => l.parentId === id && l.status === 'VERIFIED' && (scope.kind === 'parent-list' || scoped(l))) : [],
        get: async id => s.links.find(l => l.id === id && scoped(l)) ?? null,
        create: async row => { if (!scoped(row)) throw missing(); reference(eligible(row.parentId, 'PARENT')); reference(eligible(row.studentId, 'STUDENT')); unique(s.links.some(l => l.id === row.id || l.parentId === row.parentId && l.studentId === row.studentId)); s.links.push(row); return row; },
        update: async row => { const index = s.links.findIndex(l => l.id === row.id && scoped(l)); if (index < 0 || !scoped(row)) throw missing(); s.links[index] = row; return row; },
      },
    };
  }
}
