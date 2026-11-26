import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { requireActor } from './authorization';
import { STORAGE, type FoundationStorage, type Repositories } from './repositories';
import { lessonDto, resourceDto, unitDto, questionSafeDto } from './mapping';
import { canReadAnnouncement, canReadAssignment } from './communication.policy';
import { assessmentStatus, studentCanReadQuestions } from './assessment.policy';
import type { Assessment } from './entities';

export async function withVerifiedChild<T>(
  storage: FoundationStorage,
  actor: AuthUser,
  studentId: string,
  schoolId: string | undefined,
  work: (r: Repositories) => Promise<T>,
) {
  if (actor.role !== 'PARENT') throw new ForbiddenException();
  const link = await storage.run(
    { kind: 'parent-list', userId: actor.sub, schoolId: actor.schoolId,
      assessment: { membershipId: actor.membershipId, operation: 'discover', targetId: actor.sub } },
    async (r) => {
      await requireActor(r, actor, ['PARENT']);
      return (await r.links.forParent(actor.sub)).find(
        (l) => l.studentId === studentId && (!schoolId || l.schoolId === schoolId),
      );
    },
  );
  if (!link) throw new NotFoundException('Record not found');
  return storage.run(
    { kind: 'school', userId: actor.sub, schoolId: link.schoolId,
      assessment: { membershipId: actor.membershipId, operation: 'read', targetId: studentId } },
    async (r) => {
      await requireActor(r, actor, ['PARENT']);
      const current = (await r.links.forParent(actor.sub)).find(
        (l) => l.id === link.id && l.studentId === studentId && l.status === 'VERIFIED',
      );
      if (
        !current ||
        !(await r.schools.get(link.schoolId))?.active ||
        !(await r.people.eligible(actor.sub, 'PARENT')) ||
        !(await r.people.eligible(studentId, 'STUDENT'))
      )
        throw new NotFoundException('Record not found');
      return work(r);
    },
  );
}

@Injectable()
export class ParentLearningService {
  constructor(@Inject(STORAGE) private storage: FoundationStorage) {}
  private async summary(r: Repositories, a: Assessment) {
    const stats = await r.assessments.questionStats(a.id);
    return {
      ...a,
      createdAt: a.createdAt.toISOString(),
      opensAt: a.opensAt?.toISOString() ?? null,
      dueAt: a.dueAt?.toISOString() ?? null,
      resultsReleasedAt: a.resultsReleasedAt?.toISOString() ?? null,
      status: assessmentStatus(a),
      ...stats,
    };
  }
  bundle(actor: AuthUser, studentId: string, schoolId?: string) {
    return withVerifiedChild(this.storage, actor, studentId, schoolId, async (r) => {
      const classes = new Set<string>();
      for (const a of await r.academics.list('sectionSubjects'))
        if (await canReadAssignment(r, { sub: studentId, role: 'STUDENT' }, a.id))
          classes.add(a.id);
      const units = (await r.content.listUnits()).filter((u) => classes.has(u.sectionSubjectId));
      const unitIds = new Set(units.map((u) => u.id));
      const lessons = (await r.content.listLessons()).filter(
        (l) => unitIds.has(l.unitId) && l.status === 'PUBLISHED',
      );
      const lessonIds = new Set(lessons.map((l) => l.id));
      const resources = (await r.content.listResources()).filter(
        (f) => f.lessonId && lessonIds.has(f.lessonId),
      );
      const assessments = (await r.assessments.list()).filter(
        (a) => classes.has(a.sectionSubjectId) && a.status !== 'DRAFT',
      );
      const announcements = [];
      for (const a of await r.communication.announcements())
        if (
          a.status === 'PUBLISHED' &&
          (!a.sectionSubjectId || classes.has(a.sectionSubjectId)) &&
          (await canReadAnnouncement(r, actor, a))
        )
          announcements.push({
            ...a,
            createdAt: a.createdAt.toISOString(),
            publishedAt: a.publishedAt?.toISOString() ?? null,
          });
      return {
        units: units.map(unitDto),
        lessons: lessons.map(lessonDto),
        resources: resources.map(resourceDto),
        assessments: await Promise.all(assessments.map((a) => this.summary(r, a))),
        announcements,
      };
    });
  }
  assessment(actor: AuthUser, studentId: string, id: string, schoolId?: string) {
    return withVerifiedChild(this.storage, actor, studentId, schoolId, async (r) => {
      const a = await r.assessments.get(id);
      if (
        !a ||
        a.status === 'DRAFT' ||
        !(await canReadAssignment(r, { sub: studentId, role: 'STUDENT' }, a.sectionSubjectId))
      )
        throw new NotFoundException('Record not found');
      const questions = [];
      if (studentCanReadQuestions(a))
        for (const link of await r.assessments.questions(a.id)) {
          const q = await r.questions.getSafeQuestion(link.questionId);
          if (q) questions.push({ ...questionSafeDto(q), order: link.order });
        }
      return { ...(await this.summary(r, a)), questions };
    });
  }
}
