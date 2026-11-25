import { requireLessonFile } from '../files/file-access';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Page, QuestionAuthorDto, QuestionBankDto, QuestionSafeDto, QuestionType, ResourceDto, ResourceType } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import { requireActor } from './authorization';
import { studentCanReadQuestions } from './assessment.policy';
import type { Lesson, Question, QuestionOption, QuestionWithOptions, Resource, SectionSubject } from './entities';
import type { CreateQuestionBankDto, CreateQuestionDto, CreateResourceDto, QuestionBankListDto, QuestionListDto, QuestionOptionInputDto, ResourceListDto, UpdateQuestionBankDto, UpdateQuestionDto, UpdateResourceDto } from './dto';
import { questionAuthorDto, questionBankDto, questionSafeDto, resourceDto } from './mapping';
import { pageOf } from './foundation.service';
import { STORAGE } from './repositories';
import type { FoundationStorage, Repositories } from './repositories';

const notFound = () => new NotFoundException('Record not found');

@Injectable()
export class LearningService {
  constructor(@Inject(STORAGE) private storage: FoundationStorage) {}

  private school<T>(actor: AuthUser, roles: readonly ('SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT')[], work: (repositories: Repositories) => Promise<T>, staff = false) {
    if (!actor.schoolId) throw new ForbiddenException('An active school role is required');
    return this.storage.run({ kind: staff ? 'assessment-staff' : 'school', userId: actor.sub, schoolId: actor.schoolId,
      subjects: { membershipId: actor.membershipId, access: { operation: 'read' } } }, async repositories => {
      await requireActor(repositories, actor, roles);
      return work(repositories);
    });
  }

  private async openAssignments(repositories: Repositories): Promise<SectionSubject[]> {
    const openYears = new Set((await repositories.academics.list('academicYears')).filter(year => !year.archived).map(year => year.id));
    const openSections = new Set((await repositories.academics.list('sections')).filter(section => openYears.has(section.academicYearId)).map(section => section.id));
    return (await repositories.academics.list('sectionSubjects')).filter(assignment => openSections.has(assignment.sectionId));
  }

  private async actorAssignments(repositories: Repositories, actor: AuthUser): Promise<SectionSubject[]> {
    const assignments = await this.openAssignments(repositories);
    if (actor.role === 'SCHOOL_ADMIN') return assignments;
    if (actor.role === 'TEACHER') return assignments.filter(assignment => assignment.teacherId === actor.sub);
    if (actor.role === 'STUDENT') {
      const sectionIds = new Set((await repositories.academics.list('enrollments')).filter(enrollment => enrollment.studentId === actor.sub && enrollment.status === 'ACTIVE').map(enrollment => enrollment.sectionId));
      return assignments.filter(assignment => sectionIds.has(assignment.sectionId));
    }
    return [];
  }

  private async lessonAssignment(repositories: Repositories, lesson: Lesson): Promise<SectionSubject | null> {
    const unit = await repositories.content.getUnit(lesson.unitId);
    return unit ? repositories.academics.get('sectionSubjects', unit.sectionSubjectId) : null;
  }

  private async visibleLesson(repositories: Repositories, actor: AuthUser, lessonId: string): Promise<Lesson | null> {
    const lesson = await repositories.content.getLesson(lessonId);
    if (!lesson) return null;
    const assignment = await this.lessonAssignment(repositories, lesson);
    if (!assignment) return null;
    if (actor.role === 'SCHOOL_ADMIN') return lesson;
    const visible = (await this.actorAssignments(repositories, actor)).some(row => row.id === assignment.id);
    if (!visible || actor.role === 'STUDENT' && lesson.status !== 'PUBLISHED') return null;
    return lesson;
  }

  private async writableLesson(repositories: Repositories, actor: AuthUser, lessonId: string): Promise<Lesson> {
    if (actor.role === 'STUDENT') throw new ForbiddenException('Students cannot manage educational content');
    const lesson = await repositories.content.getLesson(lessonId);
    if (!lesson) throw notFound();
    const assignment = await this.lessonAssignment(repositories, lesson);
    if (!assignment) throw notFound();
    if (actor.role === 'TEACHER' && assignment.teacherId !== actor.sub) throw notFound();
    const section = await repositories.academics.get('sections', assignment.sectionId);
    const year = section && await repositories.academics.get('academicYears', section.academicYearId);
    if (!year) throw notFound();
    if (year.archived) throw new ConflictException('Educational content in an archived academic year is read-only');
    if (lesson.status !== 'DRAFT') throw new ConflictException('Resources can only be changed while their lesson is a draft');
    return lesson;
  }

  private validateResource(type: ResourceType, storageKey: string | null, url: string | null) {
    if (type === 'FILE') {
      if (!storageKey || url !== null) throw new BadRequestException('FILE resources require storageKey metadata and do not accept a URL');
      if (storageKey.startsWith('/') || storageKey.startsWith('\\') || storageKey.includes('\\') || storageKey.split('/').includes('..')) throw new BadRequestException('storageKey must be a relative metadata key');
      return;
    }
    if (!url || storageKey !== null) throw new BadRequestException(`${type} resources require an HTTPS URL and do not accept storageKey`);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) throw new Error();
    } catch {
      throw new BadRequestException('Resource URL must be an HTTPS URL without embedded credentials');
    }
  }

  private async visibleResources(repositories: Repositories, actor: AuthUser): Promise<Resource[]> {
    const rows = await repositories.content.listResources();
    if (actor.role === 'SCHOOL_ADMIN') return rows;
    const visible: Resource[] = [];
    for (const row of rows) if (row.lessonId && await this.visibleLesson(repositories, actor, row.lessonId)) visible.push(row);
    return visible;
  }

  listResources(actor: AuthUser, query: ResourceListDto): Promise<Page<ResourceDto>> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT'], async repositories => {
      const rows = (await this.visibleResources(repositories, actor)).filter(row => (!query.lessonId || row.lessonId === query.lessonId) && (!query.type || row.type === query.type));
      const page = pageOf(rows, query, row => row.title);
      return { ...page, items: page.items.map(resourceDto) };
    });
  }

  getResource(actor: AuthUser, id: string): Promise<ResourceDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT'], async repositories => {
      const row = (await this.visibleResources(repositories, actor)).find(value => value.id === id);
      if (!row) throw notFound();
      return resourceDto(row);
    });
  }

  createResource(actor: AuthUser, input: CreateResourceDto): Promise<ResourceDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      if (!input.lessonId && actor.role !== 'SCHOOL_ADMIN') throw new ForbiddenException('Teachers must link resources to an assigned draft lesson');
      if (input.lessonId) await this.writableLesson(repositories, actor, input.lessonId);
      const storageKey = input.storageKey ?? null;
      const url = input.url ?? null;
      this.validateResource(input.type, storageKey, url);
      if (input.type === 'FILE') await requireLessonFile(repositories, actor, storageKey!, input.lessonId ?? null);
      return resourceDto(await repositories.content.createResource({ id: randomUUID(), schoolId: actor.schoolId!, lessonId: input.lessonId ?? null, type: input.type, title: input.title, storageKey, url, offlineAllowed: input.offlineAllowed ?? false, createdAt: new Date() }));
    });
  }

  updateResource(actor: AuthUser, id: string, input: UpdateResourceDto): Promise<ResourceDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      const old = await repositories.content.getResource(id);
      if (!old) throw notFound();
      if (old.lessonId) await this.writableLesson(repositories, actor, old.lessonId);
      else if (actor.role !== 'SCHOOL_ADMIN') throw notFound();
      const lessonId = input.lessonId === undefined ? old.lessonId : input.lessonId;
      if (!lessonId && actor.role !== 'SCHOOL_ADMIN') throw new ForbiddenException('Teachers cannot unlink resources');
      if (lessonId && lessonId !== old.lessonId) await this.writableLesson(repositories, actor, lessonId);
      const type = input.type ?? old.type;
      const storageKey = input.storageKey === undefined ? old.storageKey : input.storageKey;
      const url = input.url === undefined ? old.url : input.url;
      this.validateResource(type, storageKey, url);
      if (type === 'FILE') await requireLessonFile(repositories, actor, storageKey!, lessonId);
      return resourceDto(await repositories.content.updateResource({ ...old, lessonId, type, title: input.title ?? old.title, storageKey, url, offlineAllowed: input.offlineAllowed ?? old.offlineAllowed }));
    });
  }

  private async accessibleSubjectIds(repositories: Repositories, actor: AuthUser): Promise<Set<string>> {
    if (actor.role === 'SCHOOL_ADMIN') return new Set((await repositories.academics.list('subjects')).map(subject => subject.id));
    return new Set((await this.actorAssignments(repositories, actor)).map(assignment => assignment.subjectId));
  }

  private async visibleBanks(repositories: Repositories, actor: AuthUser) {
    const subjectIds = await this.accessibleSubjectIds(repositories, actor);
    return (await repositories.questions.listBanks()).filter(bank => subjectIds.has(bank.subjectId));
  }

  private async writableBank(repositories: Repositories, actor: AuthUser, id: string) {
    const bank = await repositories.questions.getBank(id);
    if (!bank) throw notFound();
    if (!(await this.accessibleSubjectIds(repositories, actor)).has(bank.subjectId)) throw notFound();
    if (actor.role === 'TEACHER' && bank.ownerId !== actor.sub) throw new ForbiddenException('Teachers can only modify their own question banks');
    return bank;
  }

  private async readableBank(repositories: Repositories, actor: AuthUser, id: string) {
    const bank = (await this.visibleBanks(repositories, actor)).find(row => row.id === id);
    if (!bank) throw notFound();
    return bank;
  }

  listQuestionBanks(actor: AuthUser, query: QuestionBankListDto): Promise<Page<QuestionBankDto>> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      const rows = (await this.visibleBanks(repositories, actor)).filter(bank => (!query.subjectId || bank.subjectId === query.subjectId) && (!query.ownerId || bank.ownerId === query.ownerId));
      const page = pageOf(rows, query, bank => bank.name);
      return { ...page, items: page.items.map(questionBankDto) };
    });
  }

  getQuestionBank(actor: AuthUser, id: string): Promise<QuestionBankDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      const bank = (await this.visibleBanks(repositories, actor)).find(row => row.id === id);
      if (!bank) throw notFound();
      return questionBankDto(bank);
    });
  }

  createQuestionBank(actor: AuthUser, input: CreateQuestionBankDto): Promise<QuestionBankDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      if (!await repositories.academics.get('subjects', input.subjectId)) throw notFound();
      const ownerId = actor.role === 'TEACHER' ? actor.sub : input.ownerId;
      if (!ownerId) throw new BadRequestException('School admins must select an active teacher owner');
      if (actor.role === 'TEACHER' && input.ownerId && input.ownerId !== actor.sub) throw new ForbiddenException('Teachers cannot assign another owner');
      if (!await repositories.people.eligible(ownerId, 'TEACHER')) throw notFound();
      const ownerAssigned = (await this.openAssignments(repositories)).some(assignment => assignment.subjectId === input.subjectId && assignment.teacherId === ownerId);
      if (!ownerAssigned) throw new BadRequestException('The owner must teach this subject in an active academic year');
      return questionBankDto(await repositories.questions.createBank({ id: randomUUID(), schoolId: actor.schoolId!, subjectId: input.subjectId, ownerId, name: input.name }));
    }, true);
  }

  updateQuestionBank(actor: AuthUser, id: string, input: UpdateQuestionBankDto): Promise<QuestionBankDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      const old = await this.writableBank(repositories, actor, id);
      return questionBankDto(await repositories.questions.updateBank({ ...old, name: input.name ?? old.name }));
    }, true);
  }

  private validateOptions(type: QuestionType, values: QuestionOptionInputDto[]): QuestionOptionInputDto[] {
    const options = values.map(option => ({ text: option.text.trim(), isCorrect: option.isCorrect }));
    const normalized = options.map(option => option.text.toLocaleLowerCase());
    if (new Set(normalized).size !== normalized.length) throw new BadRequestException('Question options must be unique');
    const correct = options.filter(option => option.isCorrect).length;
    if (type === 'MULTIPLE_CHOICE' && (options.length < 2 || correct !== 1)) throw new BadRequestException('Multiple-choice questions require at least two unique options and exactly one correct option');
    if (type === 'TRUE_FALSE' && (options.length !== 2 || new Set(normalized).size !== 2 || !normalized.includes('true') || !normalized.includes('false') || correct !== 1)) throw new BadRequestException('True/false questions require unique True and False options and exactly one correct option');
    if (type === 'SHORT_ANSWER' && (options.length !== 1 || correct !== 1)) throw new BadRequestException('Short-answer questions require exactly one correct accepted answer');
    if ((type === 'ESSAY' || type === 'FILE_UPLOAD') && options.length !== 0) throw new BadRequestException(`${type} questions do not accept answer options`);
    return options;
  }

  private buildOptions(actor: AuthUser, questionId: string, values: QuestionOptionInputDto[]): QuestionOption[] {
    return values.map(value => ({ id: randomUUID(), schoolId: actor.schoolId!, questionId, text: value.text, isCorrect: value.isCorrect }));
  }

  listQuestions(actor: AuthUser, bankId: string, query: QuestionListDto): Promise<Page<QuestionAuthorDto>> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      await this.readableBank(repositories, actor, bankId);
      const rows = (await repositories.questions.listQuestions()).filter(question => question.questionBankId === bankId && (!query.type || question.type === query.type));
      const page = pageOf(rows, query, question => question.text);
      return { ...page, items: page.items.map(questionAuthorDto) };
    }, true);
  }

  getQuestion(actor: AuthUser, id: string): Promise<QuestionAuthorDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      const question = await repositories.questions.getQuestion(id);
      if (!question) throw notFound();
      await this.readableBank(repositories, actor, question.questionBankId);
      return questionAuthorDto(question);
    }, true);
  }

  createQuestion(actor: AuthUser, bankId: string, input: CreateQuestionDto): Promise<QuestionAuthorDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      await this.writableBank(repositories, actor, bankId);
      const values = this.validateOptions(input.type, input.options ?? []);
      const id = randomUUID();
      const row: Question = { id, schoolId: actor.schoolId!, questionBankId: bankId, type: input.type, text: input.text, points: input.points ?? 1 };
      return questionAuthorDto(await repositories.questions.createQuestion(row, this.buildOptions(actor, id, values)));
    }, true);
  }

  updateQuestion(actor: AuthUser, id: string, input: UpdateQuestionDto): Promise<QuestionAuthorDto> {
    return this.school(actor, ['SCHOOL_ADMIN', 'TEACHER'], async repositories => {
      const old = await repositories.questions.getQuestion(id);
      if (!old) throw notFound();
      await this.writableBank(repositories, actor, old.questionBankId);
      if (await repositories.questions.isQuestionLocked(id)) throw new ConflictException('Questions referenced by non-draft assessments are immutable');
      const type = input.type ?? old.type;
      const rawOptions = input.options ?? old.options.map(option => ({ text: option.text, isCorrect: option.isCorrect }));
      const values = this.validateOptions(type, rawOptions);
      const row: Question = { id, schoolId: old.schoolId, questionBankId: old.questionBankId, type, text: input.text ?? old.text, points: input.points ?? old.points };
      return questionAuthorDto(await repositories.questions.updateQuestion(row, this.buildOptions(actor, id, values)));
    }, true);
  }

  private async studentQuestionIds(repositories: Repositories, actor: AuthUser): Promise<Set<string>> {
    const assignments = new Set((await this.actorAssignments(repositories, actor)).map(a => a.id));
    const ids = new Set<string>();
    for (const assessment of await repositories.assessments.list()) {
      if (!assignments.has(assessment.sectionSubjectId) || !studentCanReadQuestions(assessment)) continue;
      for (const question of await repositories.assessments.questions(assessment.id)) ids.add(question.questionId);
    }
    return ids;
  }

  listStudentQuestions(actor: AuthUser, query: QuestionListDto): Promise<Page<QuestionSafeDto>> {
    return this.school(actor, ['STUDENT'], async repositories => {
      const visibleIds = await this.studentQuestionIds(repositories, actor);
      const subjects = await this.accessibleSubjectIds(repositories, actor);
      const bankIds = new Set((await repositories.questions.listBanks()).filter(bank => subjects.has(bank.subjectId)).map(bank => bank.id));
      const rows = (await repositories.questions.listSafeQuestions()).filter(question => visibleIds.has(question.id) && bankIds.has(question.questionBankId) && (!query.questionBankId || question.questionBankId === query.questionBankId) && (!query.type || question.type === query.type));
      const page = pageOf(rows, query, question => question.text);
      return { ...page, items: page.items.map(questionSafeDto) };
    });
  }

  getStudentQuestion(actor: AuthUser, id: string): Promise<QuestionSafeDto> {
    return this.school(actor, ['STUDENT'], async repositories => {
      const question = await repositories.questions.getSafeQuestion(id);
      if (!question) throw notFound();
      const bank = await repositories.questions.getBank(question.questionBankId);
      if (!bank || !(await this.accessibleSubjectIds(repositories, actor)).has(bank.subjectId) || !(await this.studentQuestionIds(repositories, actor)).has(id)) throw notFound();
      return questionSafeDto(question);
    });
  }
}
