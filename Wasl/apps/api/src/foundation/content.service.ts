import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LessonDto, Page, UnitDto } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import { requireActor } from './authorization';
import type { Lesson, SectionSubject, Unit } from './entities';
import type { CreateLessonDto, CreateUnitDto, LessonListDto, UnitListDto, UpdateLessonDto, UpdateUnitDto } from './dto';
import { lessonDto, unitDto } from './mapping';
import { pageOf } from './foundation.service';
import { STORAGE } from './repositories';
import type { FoundationStorage, Repositories } from './repositories';

const notFound = () => new NotFoundException('Record not found');

@Injectable()
export class ContentService {
  constructor(@Inject(STORAGE) private storage: FoundationStorage) {}

  private school<T>(actor: AuthUser, work: (repositories: Repositories) => Promise<T>, write = false) {
    if (!actor.schoolId) throw new ForbiddenException('An active school role is required');
    return this.storage.run({ kind: 'school', userId: actor.sub, schoolId: actor.schoolId,
      assessment: { membershipId: actor.membershipId, operation: write ? 'content-write' : 'read', targetId: actor.sub } }, async repositories => {
      await requireActor(repositories, actor, ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT']);
      return work(repositories);
    });
  }

  private async assignments(repositories: Repositories, actor: AuthUser): Promise<SectionSubject[]> {
    const assignments = await repositories.academics.list('sectionSubjects');
    if (actor.role === 'SCHOOL_ADMIN') return assignments;
    if (actor.role === 'TEACHER') return assignments.filter(row => row.teacherId === actor.sub);
    const activeSections = new Set((await repositories.academics.list('enrollments'))
      .filter(row => row.studentId === actor.sub && row.status === 'ACTIVE')
      .map(row => row.sectionId));
    const openYears = new Set((await repositories.academics.list('academicYears')).filter(row => !row.archived).map(row => row.id));
    const visibleSections = new Set((await repositories.academics.list('sections'))
      .filter(row => activeSections.has(row.id) && openYears.has(row.academicYearId))
      .map(row => row.id));
    return assignments.filter(row => visibleSections.has(row.sectionId));
  }

  private async writableAssignment(repositories: Repositories, actor: AuthUser, id: string) {
    if (actor.role === 'STUDENT') throw new ForbiddenException('Students cannot manage educational content');
    const assignment = (await this.assignments(repositories, actor)).find(row => row.id === id);
    if (!assignment) throw notFound();
    const section = await repositories.academics.get('sections', assignment.sectionId);
    const year = section && await repositories.academics.get('academicYears', section.academicYearId);
    if (!section || !year) throw notFound();
    if (year.archived) throw new ConflictException('Educational content in an archived academic year is read-only');
    return assignment;
  }

  private async visibleUnits(repositories: Repositories, actor: AuthUser) {
    const assignmentIds = new Set((await this.assignments(repositories, actor)).map(row => row.id));
    return (await repositories.content.listUnits()).filter(row => assignmentIds.has(row.sectionSubjectId));
  }

  listUnits(actor: AuthUser, query: UnitListDto): Promise<Page<UnitDto>> {
    return this.school(actor, async repositories => {
      const rows = (await this.visibleUnits(repositories, actor)).filter(row => !query.sectionSubjectId || row.sectionSubjectId === query.sectionSubjectId);
      const page = pageOf(rows, query, row => row.title);
      return { ...page, items: page.items.map(unitDto) };
    });
  }

  getUnit(actor: AuthUser, id: string): Promise<UnitDto> {
    return this.school(actor, async repositories => {
      const row = (await this.visibleUnits(repositories, actor)).find(value => value.id === id);
      if (!row) throw notFound();
      return unitDto(row);
    });
  }

  createUnit(actor: AuthUser, input: CreateUnitDto): Promise<UnitDto> {
    return this.school(actor, async repositories => {
      await this.writableAssignment(repositories, actor, input.sectionSubjectId);
      const row: Unit = { id: randomUUID(), schoolId: actor.schoolId!, sectionSubjectId: input.sectionSubjectId, title: input.title, order: input.order ?? 0 };
      return unitDto(await repositories.content.createUnit(row));
    }, true);
  }

  updateUnit(actor: AuthUser, id: string, input: UpdateUnitDto): Promise<UnitDto> {
    return this.school(actor, async repositories => {
      const old = await repositories.content.getUnit(id);
      if (!old) throw notFound();
      await this.writableAssignment(repositories, actor, old.sectionSubjectId);
      return unitDto(await repositories.content.updateUnit({ ...old, title: input.title ?? old.title, order: input.order ?? old.order }));
    }, true);
  }

  private async visibleLessons(repositories: Repositories, actor: AuthUser) {
    const unitIds = new Set((await this.visibleUnits(repositories, actor)).map(row => row.id));
    return (await repositories.content.listLessons()).filter(row => unitIds.has(row.unitId) && (actor.role !== 'STUDENT' || row.status === 'PUBLISHED'));
  }

  listLessons(actor: AuthUser, query: LessonListDto): Promise<Page<LessonDto>> {
    return this.school(actor, async repositories => {
      const rows = (await this.visibleLessons(repositories, actor)).filter(row => (!query.unitId || row.unitId === query.unitId) && (!query.status || row.status === query.status));
      const page = pageOf(rows, query, row => row.title);
      return { ...page, items: page.items.map(lessonDto) };
    });
  }

  getLesson(actor: AuthUser, id: string): Promise<LessonDto> {
    return this.school(actor, async repositories => {
      const row = (await this.visibleLessons(repositories, actor)).find(value => value.id === id);
      if (!row) throw notFound();
      return lessonDto(row);
    });
  }

  createLesson(actor: AuthUser, input: CreateLessonDto): Promise<LessonDto> {
    return this.school(actor, async repositories => {
      const unit = await repositories.content.getUnit(input.unitId);
      if (!unit) throw notFound();
      await this.writableAssignment(repositories, actor, unit.sectionSubjectId);
      const row: Lesson = { id: randomUUID(), schoolId: actor.schoolId!, unitId: input.unitId, title: input.title, body: input.body ?? null, order: input.order ?? 0, status: 'DRAFT', publishedAt: null };
      return lessonDto(await repositories.content.createLesson(row));
    }, true);
  }

  updateLesson(actor: AuthUser, id: string, input: UpdateLessonDto): Promise<LessonDto> {
    return this.school(actor, async repositories => {
      const old = await repositories.content.getLesson(id);
      if (!old) throw notFound();
      const unit = await repositories.content.getUnit(old.unitId);
      if (!unit) throw notFound();
      await this.writableAssignment(repositories, actor, unit.sectionSubjectId);
      const contentChange = input.title !== undefined || input.body !== undefined || input.order !== undefined;
      if (old.status !== 'DRAFT' && contentChange) throw new ConflictException('Only draft lesson content can be edited');
      const status = input.status ?? old.status;
      const validTransition = status === old.status || old.status === 'DRAFT' && status === 'PUBLISHED' || old.status === 'PUBLISHED' && status === 'ARCHIVED';
      if (!validTransition) throw new ConflictException('Unsupported lesson lifecycle transition');
      const row: Lesson = {
        ...old,
        title: input.title ?? old.title,
        body: input.body === undefined ? old.body : input.body,
        order: input.order ?? old.order,
        status,
        publishedAt: old.status === 'DRAFT' && status === 'PUBLISHED' ? new Date() : old.publishedAt,
      };
      return lessonDto(await repositories.content.updateLesson(row));
    }, true);
  }
}
