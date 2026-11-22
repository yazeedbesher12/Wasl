import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Answer, SubmissionWithAnswers } from './entities';
import type { AssessmentRepository } from './repositories';

/** All calls use the operation's existing Serializable transaction and tenant. */
export function prismaAssessments(tx: Prisma.TransactionClient, schoolId: string): AssessmentRepository {
  const scope = (row: { schoolId: string }) => { if (row.schoolId !== schoolId) throw new NotFoundException('Record not found'); };
  const include = { answers: { where: { schoolId }, orderBy: { id: 'asc' as const } } };
  const map = (row: Omit<SubmissionWithAnswers, 'answers'> & { answers: (Omit<Answer, 'response'> & { response: Prisma.JsonValue })[] }): SubmissionWithAnswers => ({
    ...row, answers: row.answers.map(a => {
      if (a.response !== null && typeof a.response !== 'string') throw new ConflictException('Unsupported stored answer format');
      return { ...a, response: a.response };
    }),
  });
  return {
    list: () => tx.assessment.findMany({ where: { schoolId } }),
    get: id => tx.assessment.findFirst({ where: { id, schoolId } }),
    create: data => { scope(data); return tx.assessment.create({ data }); },
    update: data => { scope(data); return tx.assessment.update({ where: { id: data.id, schoolId }, data }); },
    questions: id => tx.assessmentQuestion.findMany({ where: { assessmentId: id, schoolId }, orderBy: [{ order: 'asc' }, { questionId: 'asc' }] }),
    replaceQuestions: async (id, rows) => {
      rows.forEach(row => { scope(row); if (row.assessmentId !== id) throw new NotFoundException(); });
      if (!await tx.assessment.findFirst({ where: { id, schoolId }, select: { id: true } })) throw new NotFoundException();
      await tx.assessmentQuestion.deleteMany({ where: { assessmentId: id, schoolId } });
      if (rows.length) await tx.assessmentQuestion.createMany({ data: rows });
    },
    submissions: async assessmentId => (await tx.submission.findMany({ where: { schoolId, assessmentId }, include })).map(map),
    submission: async id => { const row = await tx.submission.findFirst({ where: { id, schoolId }, include }); return row ? map(row) : null; },
    studentSubmission: async (assessmentId, studentId) => { const row = await tx.submission.findFirst({ where: { schoolId, assessmentId, studentId }, include }); return row ? map(row) : null; },
    saveSubmission: async (data, answers, create) => {
      scope(data); answers.forEach(a => { scope(a); if (a.submissionId !== data.id) throw new NotFoundException(); });
      if (create) await tx.submission.create({ data });
      else await tx.submission.update({ where: { id: data.id, schoolId }, data });
      await tx.answer.deleteMany({ where: { submissionId: data.id, schoolId } });
      if (answers.length) await tx.answer.createMany({ data: answers.map(a => ({ ...a, response: a.response ?? Prisma.DbNull })) });
      return map(await tx.submission.findUniqueOrThrow({ where: { id: data.id, schoolId }, include }));
    },
  };
}
