import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import type { FileObject } from '../foundation/entities';
import type { Repositories } from '../foundation/repositories';
import type { FileUploadDto } from '../foundation/communication.dto';
import { canReadAssignment } from '../foundation/communication.policy';
import { assessmentStatus } from '../foundation/assessment.policy';

const missing = () => new NotFoundException('File or target not found');
async function openYear(r: Repositories, assignmentId: string) {
  const a = await r.academics.get('sectionSubjects', assignmentId);
  const section = a && await r.academics.get('sections', a.sectionId);
  const year = section && await r.academics.get('academicYears', section.academicYearId);
  if (!year) throw missing();
  if (year.archived) throw new ConflictException('Files in archived academic years are read-only');
}
export async function authorizeUpload(r: Repositories, actor: AuthUser, input: FileUploadDto) {
  if (input.purpose === 'LESSON_RESOURCE') {
    if (!input.lessonId || input.assessmentId !== undefined) throw new BadRequestException('Lesson uploads require only lessonId');
    const lesson = await r.content.getLesson(input.lessonId);
    const unit = lesson && await r.content.getUnit(lesson.unitId);
    if (!lesson || !unit || !['TEACHER', 'SCHOOL_ADMIN'].includes(actor.role) || !await canReadAssignment(r, actor, unit.sectionSubjectId)) throw missing();
    await openYear(r, unit.sectionSubjectId);
    if (lesson.status !== 'DRAFT') throw new ConflictException('Upload files to a draft lesson');
    return;
  }
  if (!input.assessmentId || input.lessonId !== undefined) throw new BadRequestException('Answer uploads require only assessmentId');
  const a = await r.assessments.get(input.assessmentId);
  if (!a || actor.role !== 'STUDENT' || a.status === 'DRAFT' || !await canReadAssignment(r, actor, a.sectionSubjectId)) throw missing();
  await openYear(r, a.sectionSubjectId);
  if (assessmentStatus(a) !== 'OPEN') throw new ConflictException('This assessment is not open for files');
  const old = await r.assessments.studentSubmission(a.id, actor.sub);
  if (old && old.status !== 'IN_PROGRESS') throw new ConflictException('This assessment has already been submitted');
  const links = await r.assessments.questions(a.id);
  let acceptsFiles = false;
  for (const q of links) if ((await r.questions.getQuestion(q.questionId))?.type === 'FILE_UPLOAD') acceptsFiles = true;
  if (!acceptsFiles) throw new BadRequestException('The assessment has no file-upload question');
}
export async function authorizeFile(r: Repositories, actor: AuthUser, file: FileObject) {
  if (file.purpose === 'LESSON_RESOURCE') {
    const lesson = file.lessonId && await r.content.getLesson(file.lessonId);
    const unit = lesson && await r.content.getUnit(lesson.unitId);
    if (!lesson || !unit || !await canReadAssignment(r, actor, unit.sectionSubjectId)) throw missing();
    if (actor.role === 'SCHOOL_ADMIN' || actor.role === 'TEACHER') return;
    const attached = (await r.content.listResources()).some(v => v.type === 'FILE' && v.storageKey === file.storageKey && v.lessonId === lesson.id);
    if (lesson.status !== 'PUBLISHED' || !attached) throw missing();
    return;
  }
  const a = file.assessmentId && await r.assessments.get(file.assessmentId);
  if (!a || !await canReadAssignment(r, actor, a.sectionSubjectId, file.ownerId)) throw missing();
  if (actor.role === 'STUDENT') { if (actor.sub !== file.ownerId) throw missing(); return; }
  const submission = await r.assessments.studentSubmission(a.id, file.ownerId);
  if (!submission || submission.status === 'IN_PROGRESS' || !submission.answers.some(answer => answer.fileKey === file.storageKey)) throw missing();
  if (actor.role === 'PARENT' && (!a.resultsReleasedAt || !['RESULTS_RELEASED', 'ARCHIVED'].includes(a.status))) throw missing();
}
export async function requireLessonFile(r: Repositories, actor: AuthUser, key: string, lessonId: string | null) {
  const f = await r.files.byKey(key);
  if (!f || f.purpose !== 'LESSON_RESOURCE' || !lessonId || f.lessonId !== lessonId || actor.role === 'TEACHER' && f.ownerId !== actor.sub) throw new BadRequestException('Use an uploaded file belonging to this lesson and author');
}
export async function requireAnswerFile(r: Repositories, actor: AuthUser, key: string, assessmentId: string) {
  const f = await r.files.byKey(key);
  if (!f || f.purpose !== 'ASSESSMENT_ANSWER' || f.ownerId !== actor.sub || f.assessmentId !== assessmentId) throw new BadRequestException('Use your own uploaded file for this assessment');
}
