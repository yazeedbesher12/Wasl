import { prismaFiles, prismaCommunication } from './communication.prisma.repository';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { prismaAssessments } from './assessment.prisma.repository';
import { PrismaService } from '../prisma/prisma.service';
import type { AcademicKind, AcademicMap, Membership, SafeQuestionWithOptions } from './entities';
import type { FoundationStorage, Repositories, StorageScope } from './repositories';

const profileFields = { id: true, email: true, fullName: true, preferredLanguage: true, active: true, createdAt: true } satisfies Prisma.UserSelect;
const credentialFields = { id: true, email: true, active: true, passwordHash: true } satisfies Prisma.UserSelect;
const runtimeRoles = { auth: 'wasl_auth', platform: 'wasl_platform', tenant: 'wasl_tenant', academicAdmin: 'wasl_academic_admin', assessmentStaff: 'wasl_assessment_staff' } as const;
type RuntimePools<T> = Record<keyof typeof runtimeRoles, T>;

/** Fixed Phase 1 persistence operations, not an arbitrary ORM/query language. */
export class PrismaStorage implements FoundationStorage, OnModuleDestroy {
  readonly driver = 'prisma' as const;
  constructor(private pools: RuntimePools<PrismaService>) {}
  static async open(urls: RuntimePools<string>, subjectKey: Buffer) {
    const pools = { auth: new PrismaService(urls.auth), platform: new PrismaService(urls.platform), tenant: new PrismaService(urls.tenant, subjectKey), academicAdmin: new PrismaService(urls.academicAdmin, subjectKey), assessmentStaff: new PrismaService(urls.assessmentStaff, subjectKey) };
    const storage = new PrismaStorage(pools);
    try {
      for (const pool of Object.keys(runtimeRoles) as (keyof typeof runtimeRoles)[]) await pools[pool].connect(runtimeRoles[pool]);
      return storage;
    } catch {
      await storage.onModuleDestroy();
      throw new Error('Prisma could not connect using the configured restricted execution identities');
    }
  }
  async onModuleDestroy() { await Promise.allSettled(Object.values(this.pools).map(pool => pool.close())); }
  async ready() { await Promise.all(Object.values(this.pools).map(pool => pool.base.$queryRaw`SELECT 1`)); }
  async run<T>(scope: StorageScope, work: (r: Repositories) => Promise<T>): Promise<T> {
    const pool = scope.kind === 'authentication' ? this.pools.auth
      : scope.kind === 'academic-administration' ? this.pools.academicAdmin
      : scope.kind === 'assessment-staff' ? this.pools.assessmentStaff
      : scope.kind === 'platform' || scope.kind === 'school-administration' || scope.kind === 'identity' ? this.pools.platform
      : this.pools.tenant;
    for (let attempt = 0; ; attempt++) {
      try { return await pool.transaction(scope, tx => work(this.repositories(tx, scope))); }
      catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        const sqlState = code === 'P2010' ? (error as { meta?: { code?: string } }).meta?.code : undefined;
        const concurrent = code === 'P2034' || sqlState === '40001' || sqlState === '40P01';
        if (concurrent && attempt < 2) continue;
        if (code === 'P2002' || sqlState === '23505') throw new ConflictException('A record with these unique fields already exists');
        if (code === 'P2003' || code === 'P2025' || sqlState === '23503') throw new NotFoundException('Referenced record not found');
        if (concurrent) throw new ConflictException('Concurrent change; retry the operation');
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
        create: data => tx.subject.create({ data }),
        update: ({ id, nameAr, nameEn, code }) => tx.subject.update({ where: { id, schoolId }, data: { nameAr, nameEn, code } }),
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
      files: prismaFiles(tx, schoolId),
      communication: prismaCommunication(tx, schoolId, scope.userId),
      assessments: prismaAssessments(tx, schoolId, scope.kind === 'assessment-staff', scope.assessment?.operation === 'results'),
      identity: {
        personById: id => tx.user.findUnique({ where: { id }, select: profileFields }),
        personByEmail: email => tx.user.findUnique({ where: { email }, select: profileFields }),
        membershipsFor: userId => tx.membership.findMany({ where: { userId } }),
        createPerson: data => tx.user.create({ data, select: profileFields }),
        updateProfile: (id, data) => tx.user.update({ where: { id }, data, select: profileFields }),
      },
      get authentication(): Repositories['authentication'] {
        if (scope.kind !== 'authentication') throw new ForbiddenException();
        return {
          credentialById: id => tx.user.findUnique({ where: { id }, select: credentialFields }),
          credentialByEmail: email => tx.user.findUnique({ where: { email }, select: credentialFields }),
          refreshByHash: tokenHash => tx.refreshToken.findUnique({ where: { tokenHash }, select: { userId: true, expiresAt: true, revokedAt: true } }),
          createRefresh: async data => { await tx.refreshToken.create({ data, select: { id: true } }); },
          consumeRefresh: async (tokenHash, now) => (await tx.refreshToken.updateMany({ where: { tokenHash, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now } })).count === 1,
          revokeRefresh: async (tokenHash, now) => { await tx.refreshToken.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: now } }); },
        };
      },
      schools: {
        list: () => { platform(); return tx.school.findMany(); }, get: id => tx.school.findUnique({ where: { id } }),
        create: data => { platform(); return tx.school.create({ data }); }, update: (id, data) => { platform(); return tx.school.update({ where: { id }, data }); },
        countPeople: (id, role) => tx.membership.count({ where: { schoolId: id, role, active: true, user: { active: true } } }),
      },
      people: {
        memberships: () => tx.membership.findMany({ where }),
        createMembership: async data => {
          if (!data.schoolId || data.schoolId !== scope.schoolId || data.role === 'PLATFORM_ADMIN') throw new NotFoundException();
          const [membership] = await tx.$queryRaw<Membership[]>`
            INSERT INTO wasl_admin.school_memberships (id, user_id, school_id, role, active, created_at)
            VALUES (${data.id}::uuid, ${data.userId}::uuid, ${data.schoolId}::uuid, ${data.role}::public."Role", ${data.active}, ${data.createdAt})
            RETURNING id, user_id AS "userId", school_id AS "schoolId", role::text, active, created_at AS "createdAt"`;
          return membership;
        },
        setMembershipActive: async (id, active) => {
          const [membership] = await tx.$queryRaw<Membership[]>`
            UPDATE wasl_admin.school_memberships SET active = ${active}
            WHERE id = ${id}::uuid AND school_id = ${schoolId}::uuid
            RETURNING id, user_id AS "userId", school_id AS "schoolId", role::text, active, created_at AS "createdAt"`;
          if (!membership) throw new NotFoundException('Referenced record not found');
          return membership;
        },
        eligible: async (userId, role) => !!await tx.membership.findFirst({ where: { ...where, userId, role, active: true, user: { active: true } } }),
      },
      academics: {
        list: kind => table(kind).list(), get: (kind, id) => table(kind).get(id),
        create: (kind, row) => { scoped(row); return table(kind).create(row); },
        update: (kind, row) => { scoped(row); return table(kind).update(row); },
      },
      content: {
        listUnits: () => tx.unit.findMany({ where }),
        getUnit: id => tx.unit.findFirst({ where: { id, schoolId } }),
        createUnit: data => { scoped(data); return tx.unit.create({ data }); },
        updateUnit: data => { scoped(data); return tx.unit.update({ where: { id: data.id, schoolId }, data }); },
        listLessons: () => tx.lesson.findMany({ where }),
        getLesson: id => tx.lesson.findFirst({ where: { id, schoolId } }),
        createLesson: data => { scoped(data); return tx.lesson.create({ data }); },
        updateLesson: data => { scoped(data); return tx.lesson.update({ where: { id: data.id, schoolId }, data }); },
        listResources: () => tx.resource.findMany({ where }),
        getResource: id => tx.resource.findFirst({ where: { id, schoolId } }),
        createResource: data => { scoped(data); return tx.resource.create({ data }); },
        updateResource: data => { scoped(data); return tx.resource.update({ where: { id: data.id, schoolId }, data }); },
      },
      questions: {
        listBanks: () => tx.questionBank.findMany({ where }),
        getBank: id => tx.questionBank.findFirst({ where: { id, schoolId } }),
        createBank: data => { scoped(data); return tx.questionBank.create({ data }); },
        updateBank: data => { scoped(data); return tx.questionBank.update({ where: { id: data.id, schoolId }, data: { name: data.name } }); },
        listQuestions: () => tx.question.findMany({ where, include: { options: true } }),
        getQuestion: id => tx.question.findFirst({ where: { id, schoolId }, include: { options: true } }),
        listSafeQuestions: async () => {
          const questions = await tx.question.findMany({ where });
          const options = await tx.$queryRaw<SafeQuestionWithOptions['options']>`
            SELECT id, school_id AS "schoolId", question_id AS "questionId", text
            FROM wasl_assessment.learner_options WHERE school_id = ${schoolId}::uuid`;
          return questions.map(question => ({ ...question, options: options.filter(option => option.questionId === question.id) }));
        },
        getSafeQuestion: async id => {
          const question = await tx.question.findFirst({ where: { id, schoolId } });
          if (!question) return null;
          const options = await tx.$queryRaw<SafeQuestionWithOptions['options']>`
            SELECT id, school_id AS "schoolId", question_id AS "questionId", text
            FROM wasl_assessment.learner_options WHERE school_id = ${schoolId}::uuid AND question_id = ${id}::uuid`;
          return { ...question, options };
        },
        createQuestion: async (data, options) => {
          scoped(data); options.forEach(scoped);
          await tx.question.create({ data });
          if (options.length) await tx.questionOption.createMany({ data: options });
          return tx.question.findUniqueOrThrow({ where: { id: data.id }, include: { options: true } });
        },
        updateQuestion: async (data, options) => {
          scoped(data); options.forEach(scoped);
          const { type, text, points } = data;
          await tx.question.update({ where: { id: data.id, schoolId }, data: { type, text, points } });
          await tx.questionOption.deleteMany({ where: { questionId: data.id, schoolId } });
          if (options.length) await tx.questionOption.createMany({ data: options });
          return tx.question.findUniqueOrThrow({ where: { id: data.id }, include: { options: true } });
        },
        isQuestionLocked: async id => {
          const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT wasl_assessment.question_locked(${schoolId}::uuid, ${id}::uuid) AS locked`;
          return row.locked;
        },
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
