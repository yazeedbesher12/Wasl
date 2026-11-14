import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AcademicKind, AcademicMap } from './entities';
import type { FoundationStorage, Repositories, StorageScope } from './repositories';

/** Fixed Phase 1 persistence operations, not an arbitrary ORM/query language. */
export class PrismaStorage implements FoundationStorage, OnModuleDestroy {
  readonly driver = 'prisma' as const;
  constructor(private prisma: PrismaService) {}
  static async open(url: string) { const prisma = new PrismaService(url); try { await prisma.connect(); return new PrismaStorage(prisma); } catch (error) { await prisma.close(); throw error; } }
  async onModuleDestroy() { await this.prisma.close(); }
  async ready() { await this.prisma.base.$queryRaw`SELECT 1`; }
  async run<T>(scope: StorageScope, work: (r: Repositories) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.transaction(scope, tx => work(this.repositories(tx, scope))); }
      catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (code === 'P2034' && attempt < 2) continue;
        if (code === 'P2002') throw new ConflictException('A record with these unique fields already exists');
        if (code === 'P2003' || code === 'P2025') throw new NotFoundException('Referenced record not found');
        if (code === 'P2034') throw new ConflictException('Concurrent change; retry the operation');
        if (typeof code === 'string' && (/^P10\d\d$/.test(code) || code === 'P2024' || code === 'P2028')) throw new ServiceUnavailableException('Storage is unavailable');
        throw error;
      }
    }
  }
  private repositories(tx: Prisma.TransactionClient, scope: StorageScope): Repositories {
    const schoolId = scope.schoolId ?? '00000000-0000-4000-8000-000000000000';
    const where = { schoolId };
    const scoped = (row: { schoolId: string }) => { if (row.schoolId !== scope.schoolId) throw new NotFoundException('Record not found'); };
    const platform = () => { if (scope.kind !== 'platform') throw new ForbiddenException(); };
    type AcademicTable<T> = { list(): Promise<T[]>; get(id: string): Promise<T | null>; create(data: T): Promise<T>; update(data: T): Promise<T> };
    const tables: { [K in AcademicKind]: AcademicTable<AcademicMap[K]> } = {
      academicYears: {
        list: () => tx.academicYear.findMany({ where }), get: id => tx.academicYear.findFirst({ where: { id, schoolId } }),
        create: data => tx.academicYear.create({ data }), update: data => tx.academicYear.update({ where: { id: data.id, schoolId }, data }),
      },
      semesters: {
        list: () => tx.semester.findMany({ where }), get: id => tx.semester.findFirst({ where: { id, schoolId } }),
        create: data => tx.semester.create({ data }), update: data => tx.semester.update({ where: { id: data.id, schoolId }, data }),
      },
      grades: {
        list: () => tx.grade.findMany({ where }), get: id => tx.grade.findFirst({ where: { id, schoolId } }),
        create: data => tx.grade.create({ data }), update: data => tx.grade.update({ where: { id: data.id, schoolId }, data }),
      },
      sections: {
        list: () => tx.section.findMany({ where }), get: id => tx.section.findFirst({ where: { id, schoolId } }),
        create: data => tx.section.create({ data }), update: data => tx.section.update({ where: { id: data.id, schoolId }, data }),
      },
      subjects: {
        list: () => tx.subject.findMany({ where }), get: id => tx.subject.findFirst({ where: { id, schoolId } }),
        create: data => tx.subject.create({ data }), update: data => tx.subject.update({ where: { id: data.id, schoolId }, data }),
      },
      sectionSubjects: {
        list: () => tx.sectionSubject.findMany({ where }), get: id => tx.sectionSubject.findFirst({ where: { id, schoolId } }),
        create: data => tx.sectionSubject.create({ data }), update: data => tx.sectionSubject.update({ where: { id: data.id, schoolId }, data }),
      },
      enrollments: {
        list: () => tx.enrollment.findMany({ where }), get: id => tx.enrollment.findFirst({ where: { id, schoolId } }),
        create: data => tx.enrollment.create({ data }), update: data => tx.enrollment.update({ where: { id: data.id, schoolId }, data }),
      },
    };
    const table = <K extends AcademicKind>(kind: K): AcademicTable<AcademicMap[K]> => tables[kind];
    return {
      identity: {
        personById: id => tx.user.findUnique({ where: { id } }), personByEmail: email => tx.user.findUnique({ where: { email } }),
        membershipsFor: userId => tx.membership.findMany({ where: { userId } }),
        createPerson: data => tx.user.create({ data }), updateProfile: (id, data) => tx.user.update({ where: { id }, data }),
        refreshByHash: tokenHash => tx.refreshToken.findUnique({ where: { tokenHash } }),
        createRefresh: async data => { await tx.refreshToken.create({ data }); },
        consumeRefresh: async (tokenHash, now) => (await tx.refreshToken.updateMany({ where: { tokenHash, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } })).count === 1,
        revokeRefresh: async (tokenHash, now) => { await tx.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: now } }); },
      },
      schools: {
        list: () => { platform(); return tx.school.findMany(); }, get: id => tx.school.findUnique({ where: { id } }),
        create: data => { platform(); return tx.school.create({ data }); }, update: (id, data) => { platform(); return tx.school.update({ where: { id }, data }); },
        countPeople: (id, role) => tx.membership.count({ where: { schoolId: id, role, active: true, user: { active: true } } }),
      },
      people: {
        memberships: () => tx.membership.findMany({ where }),
        createMembership: data => { if (data.schoolId !== scope.schoolId || data.role === 'PLATFORM_ADMIN') throw new NotFoundException(); return tx.membership.create({ data }); },
        setMembershipActive: (id, active) => tx.membership.update({ where: { id, schoolId }, data: { active } }),
        eligible: async (userId, role) => !!await tx.membership.findFirst({ where: { ...where, userId, role, active: true, user: { active: true } } }),
      },
      academics: {
        list: kind => table(kind).list(), get: (kind, id) => table(kind).get(id),
        create: (kind, row) => { scoped(row); return table(kind).create(row); },
        update: (kind, row) => { scoped(row); return table(kind).update(row); },
      },
      links: {
        list: () => tx.parentStudentLink.findMany({ where }),
        forParent: parentId => parentId === scope.userId ? tx.parentStudentLink.findMany({ where: { parentId, status: 'VERIFIED', ...(scope.kind === 'parent-list' ? {} : where) } }) : Promise.resolve([]),
        get: id => tx.parentStudentLink.findFirst({ where: { ...where, id } }),
        create: data => { scoped(data); return tx.parentStudentLink.create({ data }); },
        update: data => { scoped(data); return tx.parentStudentLink.update({ where: { id: data.id, schoolId }, data }); },
      },
    };
  }
}
