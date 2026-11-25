import { requireAnswerFile } from '../files/file-access';
import { notify, studentAndParentRecipients } from './communication.policy';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AssessmentAuthorDetailDto, AssessmentDetailDto, AssessmentDto, Page, ReleasedResultDto, Role, SubmissionDto } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import { requireActor } from './authorization';
import type { Answer, Assessment, QuestionWithOptions, SafeQuestionWithOptions, SectionSubject, Submission, SubmissionWithAnswers } from './entities';
import type { FoundationStorage, Repositories, StorageScope } from './repositories';
import { STORAGE } from './repositories';
import { pageOf } from './foundation.service';
import { questionAuthorDto, questionSafeDto } from './mapping';
import type { ListDto } from './dto';
import type { AssessmentListDto, CreateAssessmentDto, GradeSubmissionDto, ReplaceAssessmentQuestionsDto, SaveAnswersDto, SubmissionListDto, UpdateAssessmentDto } from './assessment.dto';
import { assessmentStatus, studentCanReadQuestions } from './assessment.policy';

const missing = () => new NotFoundException('Record not found');
function conflict(message: string): never { throw new ConflictException(message); }
const readers: readonly Role[] = ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT'];
const teacherWriter: readonly Role[] = ['TEACHER'];

@Injectable()
export class AssessmentService {
  constructor(@Inject(STORAGE) private storage: FoundationStorage) {}

  private school<T>(actor: AuthUser, roles: readonly Role[], work: (r: Repositories) => Promise<T>, assessment?: Omit<NonNullable<StorageScope['assessment']>, 'membershipId'>) {
    if (!actor.schoolId) throw new ForbiddenException('An active school role is required');
    const kind = actor.role === 'TEACHER' || actor.role === 'SCHOOL_ADMIN' ? 'assessment-staff' : 'school';
    const operation = kind === 'assessment-staff' ? (roles === teacherWriter ? 'staff-write' : 'staff-read') : 'read';
    return this.storage.run({ kind, userId: actor.sub, schoolId: actor.schoolId,
      assessment: { ...(assessment ?? { operation, targetId: actor.sub }), membershipId: actor.membershipId } }, async r => {
      await requireActor(r, actor, roles); return work(r);
    });
  }

  private async accessibleAssignments(r: Repositories, actor: Pick<AuthUser, 'sub' | 'role'>): Promise<SectionSubject[]> {
    const assignments = await r.academics.list('sectionSubjects');
    if (actor.role === 'SCHOOL_ADMIN') return assignments;
    if (actor.role === 'TEACHER') return assignments.filter(a => a.teacherId === actor.sub);
    const sections = new Set((await r.academics.list('enrollments')).filter(e => e.studentId === actor.sub && e.status === 'ACTIVE').map(e => e.sectionId));
    return assignments.filter(a => sections.has(a.sectionId));
  }

  private async assignment(r: Repositories, actor: AuthUser, id: string, write = false) {
    const a = (await this.accessibleAssignments(r, actor)).find(a => a.id === id);
    if (!a) throw missing();
    if (write) {
      const section = await r.academics.get('sections', a.sectionId);
      const year = section && await r.academics.get('academicYears', section.academicYearId);
      if (!year) throw missing();
      if (year.archived) conflict('Assessments in an archived academic year are read-only');
    }
    return a;
  }

  private async readable(r: Repositories, actor: AuthUser, id: string) {
    const a = await r.assessments.get(id);
    if (!a || actor.role === 'STUDENT' && a.status === 'DRAFT') throw missing();
    await this.assignment(r, actor, a.sectionSubjectId);
    return a;
  }

  private async writable(r: Repositories, actor: AuthUser, id: string, draft = false) {
    if (actor.role !== 'TEACHER') throw new ForbiddenException('Only the assigned teacher may manage assessments');
    const a = await this.readable(r, actor, id);
    await this.assignment(r, actor, a.sectionSubjectId, true);
    if (draft && a.status !== 'DRAFT') conflict('Only draft assessments can be edited');
    return a;
  }

  private dates(opensAt: Date | null, dueAt: Date | null) {
    if (opensAt && !Number.isFinite(opensAt.getTime()) || dueAt && !Number.isFinite(dueAt.getTime())) throw new BadRequestException('Invalid assessment timestamp');
    if (opensAt && dueAt && dueAt <= opensAt) throw new BadRequestException('The deadline must be after the opening time');
  }

  private async questions(r: Repositories, a: Assessment, author: true): Promise<(QuestionWithOptions & { order: number })[]>;
  private async questions(r: Repositories, a: Assessment, author?: false): Promise<(SafeQuestionWithOptions & { order: number })[]>;
  private async questions(r: Repositories, a: Assessment, author = false) {
    const result: (SafeQuestionWithOptions & { order: number })[] = [];
    for (const link of await r.assessments.questions(a.id)) {
      const q = author ? await r.questions.getQuestion(link.questionId) : await r.questions.getSafeQuestion(link.questionId);
      if (!q) conflict('An assessment question is unavailable');
      result.push({ ...q, order: link.order });
    }
    return result;
  }

  private async summary(r: Repositories, a: Assessment): Promise<AssessmentDto> {
    const { questionCount, totalPoints } = await r.assessments.questionStats(a.id);
    return { id: a.id, schoolId: a.schoolId, sectionSubjectId: a.sectionSubjectId, type: a.type, title: a.title, instructions: a.instructions, opensAt: a.opensAt?.toISOString() ?? null, dueAt: a.dueAt?.toISOString() ?? null, status: assessmentStatus(a), resultsReleasedAt: a.resultsReleasedAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString(), questionCount, totalPoints: Number(totalPoints.toFixed(10)) };
  }

  private async detail(r: Repositories, a: Assessment, author: boolean): Promise<AssessmentAuthorDetailDto | AssessmentDetailDto> {
    const summary = await this.summary(r, a);
    if (author) {
      const questions = await this.questions(r, a, true);
      return { ...summary, questions: questions.map(q => ({ ...questionAuthorDto(q), order: q.order })) };
    }
    const questions = studentCanReadQuestions(a) ? await this.questions(r, a) : [];
    return { ...summary, questions: questions.map(q => ({ ...questionSafeDto(q), order: q.order })) };
  }

  list(actor: AuthUser, query: AssessmentListDto): Promise<Page<AssessmentDto>> {
    return this.school(actor, readers, async r => {
      const assignments = new Set((await this.accessibleAssignments(r, actor)).map(a => a.id));
      const rows = (await r.assessments.list()).filter(a => assignments.has(a.sectionSubjectId) && (actor.role !== 'STUDENT' || a.status !== 'DRAFT') && (!query.sectionSubjectId || a.sectionSubjectId === query.sectionSubjectId) && (!query.type || a.type === query.type) && (!query.status || assessmentStatus(a) === query.status));
      const page = pageOf(rows, query, a => a.title);
      return { ...page, items: await Promise.all(page.items.map(a => this.summary(r, a))) };
    });
  }

  get(actor: AuthUser, id: string) { return this.school(actor, readers, async r => this.detail(r, await this.readable(r, actor, id), actor.role !== 'STUDENT')); }

  create(actor: AuthUser, input: CreateAssessmentDto) {
    return this.school(actor, teacherWriter, async r => {
      await this.assignment(r, actor, input.sectionSubjectId, true);
      const opensAt = input.opensAt ? new Date(input.opensAt) : null;
      const dueAt = input.dueAt ? new Date(input.dueAt) : null;
      this.dates(opensAt, dueAt);
      const a = await r.assessments.create({ id: randomUUID(), schoolId: actor.schoolId!, sectionSubjectId: input.sectionSubjectId, type: input.type, title: input.title, instructions: input.instructions ?? null, opensAt, dueAt, status: 'DRAFT', resultsReleasedAt: null, createdAt: new Date() });
      return this.detail(r, a, true);
    });
  }

  update(actor: AuthUser, id: string, input: UpdateAssessmentDto) {
    return this.school(actor, teacherWriter, async r => {
      const a = await this.writable(r, actor, id, true);
      const opensAt = input.opensAt === undefined ? a.opensAt : input.opensAt === null ? null : new Date(input.opensAt);
      const dueAt = input.dueAt === undefined ? a.dueAt : input.dueAt === null ? null : new Date(input.dueAt);
      this.dates(opensAt, dueAt);
      return this.detail(r, await r.assessments.update({ ...a, type: input.type ?? a.type, title: input.title ?? a.title, instructions: input.instructions === undefined ? a.instructions : input.instructions, opensAt, dueAt }), true);
    });
  }

  replaceQuestions(actor: AuthUser, id: string, input: ReplaceAssessmentQuestionsDto) {
    return this.school(actor, teacherWriter, async r => {
      const a = await this.writable(r, actor, id, true);
      const assignment = await this.assignment(r, actor, a.sectionSubjectId, true);
      for (const link of input.questions) {
        const q = await r.questions.getQuestion(link.questionId);
        const bank = q && await r.questions.getBank(q.questionBankId);
        if (!bank || bank.subjectId !== assignment.subjectId) throw missing();
      }
      await r.assessments.replaceQuestions(id, input.questions.map(q => ({ ...q, schoolId: a.schoolId, assessmentId: id })));
      return this.detail(r, a, true);
    });
  }

  publish(actor: AuthUser, id: string) {
    return this.school(actor, teacherWriter, async r => {
      const a = await this.writable(r, actor, id, true);
      const questions = await this.questions(r, a);
      if (!questions.length) throw new BadRequestException('Add at least one question before publishing');
      const assignment = await this.assignment(r, actor, a.sectionSubjectId, true);
      for (const q of questions) {
        const bank = await r.questions.getBank(q.questionBankId);
        if (!bank || bank.subjectId !== assignment.subjectId) throw missing();
      }
      this.dates(a.opensAt, a.dueAt);
      const now = new Date();
      if (a.dueAt && a.dueAt <= now) throw new BadRequestException('The deadline must be in the future when publishing');
      const published = await r.assessments.update({ ...a, status: a.opensAt && a.opensAt > now ? 'SCHEDULED' : 'OPEN' });
      await notify(r, a.schoolId, 'ASSESSMENT_PUBLISHED', await studentAndParentRecipients(r, a.sectionSubjectId), { entityId: a.id, sectionSubjectId: a.sectionSubjectId });
      return this.detail(r, published, true);
    });
  }

  transition(actor: AuthUser, id: string, action: 'close' | 'unpublish' | 'start-grading' | 'release' | 'archive') {
    return this.school(actor, teacherWriter, async r => {
      const a = await this.writable(r, actor, id);
      const state = assessmentStatus(a);
      const submissions = await r.assessments.submissions(id);
      let status = a.status;
      let resultsReleasedAt = a.resultsReleasedAt;
      if (action === 'close') {
        if (!['SCHEDULED', 'OPEN', 'CLOSED'].includes(state)) conflict('Only a published assessment can be closed');
        status = 'CLOSED';
      } else if (action === 'unpublish') {
        if (!['SCHEDULED', 'OPEN'].includes(state) || submissions.length) conflict('Unpublish requires an open or scheduled assessment without any student drafts or submissions');
        status = 'DRAFT';
      } else if (action === 'start-grading') {
        if (!['CLOSED', 'GRADING'].includes(state)) conflict('Close the assessment before grading');
        status = 'GRADING';
      } else if (action === 'release') {
        if (state !== 'GRADING') conflict('Results can only be released after grading');
        const final = submissions.filter(s => s.status !== 'IN_PROGRESS');
        if (!final.length || final.some(s => s.status !== 'GRADED' || s.score === null || !s.gradedAt)) conflict('Grade every final submission before releasing results');
        status = 'RESULTS_RELEASED'; resultsReleasedAt = new Date();
      } else {
        if (state !== 'RESULTS_RELEASED') conflict('Only released assessments can be archived');
        status = 'ARCHIVED';
      }
      const updated = await r.assessments.update({ ...a, status, resultsReleasedAt });
      if (action === 'release') for (const submission of submissions.filter(s => s.status === 'GRADED')) {
        await notify(r, a.schoolId, 'RESULTS_RELEASED', await studentAndParentRecipients(r, a.sectionSubjectId, submission.studentId), { entityId: a.id, sectionSubjectId: a.sectionSubjectId });
      }
      return this.detail(r, updated, true);
    });
  }

  private submissionDto(a: Assessment, s: SubmissionWithAnswers, staff = false): SubmissionDto {
    const released = !!a.resultsReleasedAt && ['RESULTS_RELEASED', 'ARCHIVED'].includes(a.status);
    const show = staff || released;
    return { id: s.id, schoolId: s.schoolId, assessmentId: s.assessmentId, studentId: s.studentId, status: !show && s.status === 'GRADED' ? 'SUBMITTED' : s.status, submittedAt: s.submittedAt?.toISOString() ?? null, score: show ? s.score : null, feedback: show ? s.feedback : null, gradedAt: show ? s.gradedAt?.toISOString() ?? null : null, resultsReleased: released, answers: s.answers.map(v => ({ id: v.id, questionId: v.questionId, response: v.response, fileKey: v.fileKey, score: show ? v.score : null })) };
  }

  ownSubmission(actor: AuthUser, id: string): Promise<SubmissionDto> {
    return this.school(actor, ['STUDENT'], async r => {
      const a = await this.readable(r, actor, id);
      const s = await r.assessments.studentSubmission(id, actor.sub);
      if (!s) throw missing();
      return this.submissionDto(a, s);
    }, { operation: 'results', targetId: actor.sub });
  }

  save(actor: AuthUser, id: string, input: SaveAnswersDto, final: boolean): Promise<SubmissionDto> {
    return this.school(actor, ['STUDENT'], async r => {
      const a = await this.readable(r, actor, id);
      await this.assignment(r, actor, a.sectionSubjectId, true);
      const old = await r.assessments.studentSubmission(id, actor.sub);
      if (old && old.status !== 'IN_PROGRESS') conflict('This assessment has already been submitted');
      const questions = await this.questions(r, a);
      const submissionId = old?.id ?? randomUUID();
      const answers: Answer[] = [];
      for (const value of input.answers) {
        const q = questions.find(q => q.id === value.questionId);
        if (!q) throw new BadRequestException('Answers must reference questions in this assessment');
        let response: string | null = null;
        let fileKey: string | null = null;
        if (q.type === 'MULTIPLE_CHOICE' || q.type === 'TRUE_FALSE') {
          if (!value.optionId || value.text !== undefined || value.fileKey !== undefined || !q.options.some(o => o.id === value.optionId)) throw new BadRequestException('Select one valid option for this question');
          response = value.optionId;
        } else if (q.type === 'FILE_UPLOAD') {
          const prefix = `schools/${a.schoolId}/students/${actor.sub}/`;
          if (!value.fileKey || !value.fileKey.startsWith(prefix) || value.fileKey.length <= prefix.length || /[^A-Za-z0-9_./-]/.test(value.fileKey) || value.fileKey.includes('..') || value.fileKey.includes('//') || value.optionId !== undefined || value.text !== undefined) throw new BadRequestException('File metadata must use the current student school namespace');
          await requireAnswerFile(r, actor, value.fileKey, a.id);
          fileKey = value.fileKey;
        } else {
          if (value.text === undefined || value.optionId !== undefined || value.fileKey !== undefined || final && !value.text.trim()) throw new BadRequestException('Provide a written response for this question');
          response = value.text;
        }
        answers.push({ id: old?.answers.find(v => v.questionId === q.id)?.id ?? randomUUID(), schoolId: a.schoolId, submissionId, questionId: q.id, response, fileKey, score: null });
      }
      if (final && (answers.length !== questions.length || !questions.length)) throw new BadRequestException('Answer every question before final submission');
      // Recheck time after authorization and answer validation, in the same operation.
      const now = new Date();
      if (assessmentStatus(a, now) !== 'OPEN') conflict('This assessment is not open for answers');
      const row: Submission = { id: submissionId, schoolId: a.schoolId, assessmentId: id, studentId: actor.sub, clientId: null, status: final ? 'SUBMITTED' : 'IN_PROGRESS', submittedAt: final ? now : null, score: null, feedback: null, gradedAt: null };
      const saved = await r.assessments.saveSubmission(row, answers, !old);
      if (final) {
        const assignment = await r.academics.get('sectionSubjects', a.sectionSubjectId);
        const recipients = [{ userId: actor.sub, studentId: actor.sub }];
        if (assignment?.teacherId && await r.people.eligible(assignment.teacherId, 'TEACHER')) recipients.push({ userId: assignment.teacherId, studentId: actor.sub });
        await notify(r, a.schoolId, 'SUBMISSION_RECEIVED', recipients, { entityId: row.id, sectionSubjectId: a.sectionSubjectId });
      }
      return this.submissionDto(a, saved);
    }, { operation: final ? 'submit' : 'draft', targetId: id });
  }

  submissions(actor: AuthUser, id: string, query: SubmissionListDto): Promise<Page<SubmissionDto>> {
    return this.school(actor, ['TEACHER', 'SCHOOL_ADMIN'], async r => {
      const a = await this.readable(r, actor, id);
      const rows = (await r.assessments.submissions(id)).filter(s => s.status !== 'IN_PROGRESS' && (!query.studentId || s.studentId === query.studentId) && (!query.status || s.status === query.status));
      const page = pageOf(rows, query, s => s.studentId);
      return { ...page, items: page.items.map(s => this.submissionDto(a, s, true)) };
    });
  }

  submission(actor: AuthUser, id: string): Promise<SubmissionDto> {
    return this.school(actor, readers, async r => {
      const s = await r.assessments.submission(id);
      if (!s || actor.role === 'STUDENT' && s.studentId !== actor.sub || actor.role !== 'STUDENT' && s.status === 'IN_PROGRESS') throw missing();
      const a = await this.readable(r, actor, s.assessmentId);
      return this.submissionDto(a, s, actor.role !== 'STUDENT');
    }, actor.role === 'STUDENT' ? { operation: 'results', targetId: actor.sub } : undefined);
  }

  grade(actor: AuthUser, id: string, input: GradeSubmissionDto): Promise<SubmissionDto> {
    return this.school(actor, teacherWriter, async r => {
      const s = await r.assessments.submission(id);
      if (!s || s.status === 'IN_PROGRESS') throw missing();
      const a = await this.writable(r, actor, s.assessmentId);
      if (!['CLOSED', 'GRADING'].includes(assessmentStatus(a))) conflict('Grading requires a closed assessment with unreleased results');
      const questions = await this.questions(r, a);
      if (input.answers.length !== questions.length || s.answers.length !== questions.length) throw new BadRequestException('Grade every submitted answer');
      const answers: Answer[] = [];
      for (const q of questions) {
        const mark = input.answers.find(v => v.questionId === q.id);
        const answer = s.answers.find(v => v.questionId === q.id);
        if (!mark || !answer || mark.score > q.points) throw new BadRequestException('Each answer score must be between zero and the question maximum');
        answers.push({ ...answer, score: mark.score });
      }
      const { answers: _answers, ...row } = s;
      const score = Number(answers.reduce((sum, v) => sum + v.score!, 0).toFixed(10));
      const graded = await r.assessments.saveSubmission({ ...row, status: 'GRADED', score, feedback: input.feedback === undefined ? s.feedback : input.feedback, gradedAt: new Date() }, answers, false);
      const updated = await r.assessments.update({ ...a, status: 'GRADING' });
      return this.submissionDto(updated, graded, true);
    }, { operation: 'staff-grade', targetId: id });
  }

  private async releasedResults(r: Repositories, studentId: string, query: ListDto): Promise<Page<ReleasedResultDto>> {
    const assignments = new Set((await this.accessibleAssignments(r, { sub: studentId, role: 'STUDENT' })).map(a => a.id));
    const rows: ReleasedResultDto[] = [];
    for (const a of await r.assessments.list()) {
      if (!assignments.has(a.sectionSubjectId) || !a.resultsReleasedAt || !['RESULTS_RELEASED', 'ARCHIVED'].includes(a.status)) continue;
      const s = await r.assessments.studentSubmission(a.id, studentId);
      if (s?.status === 'GRADED') rows.push({ id: s.id, assessment: await this.summary(r, a), submission: this.submissionDto(a, s) });
    }
    return pageOf(rows, query, v => v.assessment.title);
  }

  myResults(actor: AuthUser, query: ListDto) { return this.school(actor, ['STUDENT'], r => this.releasedResults(r, actor.sub, query), { operation: 'results', targetId: actor.sub }); }

  async childResults(actor: AuthUser, studentId: string, query: ListDto, schoolId?: string) {
    if (actor.role !== 'PARENT') throw new ForbiddenException();
    const link = await this.storage.run({ kind: 'parent-list', userId: actor.sub, schoolId: actor.schoolId,
      assessment: { membershipId: actor.membershipId, operation: 'discover', targetId: actor.sub } }, async r => {
      await requireActor(r, actor, ['PARENT']);
      return (await r.links.forParent(actor.sub)).find(l => l.studentId === studentId && (!schoolId || l.schoolId === schoolId));
    });
    if (!link) throw missing();
    return this.storage.run({ kind: 'school', userId: actor.sub, schoolId: link.schoolId,
      assessment: { membershipId: actor.membershipId, operation: 'results', targetId: studentId } }, async r => {
      await requireActor(r, actor, ['PARENT']);
      const current = (await r.links.forParent(actor.sub)).find(l => l.id === link.id && l.studentId === studentId && l.status === 'VERIFIED');
      if (!current || !(await r.schools.get(link.schoolId))?.active || !await r.people.eligible(actor.sub, 'PARENT') || !await r.people.eligible(studentId, 'STUDENT')) throw missing();
      return this.releasedResults(r, studentId, query);
    });
  }
}
