import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Answer, SubmissionWithAnswers } from './entities';
import type { AssessmentRepository } from './repositories';

/** All calls use the operation's existing Serializable transaction and tenant. */
export function prismaAssessments(tx: Prisma.TransactionClient, schoolId: string, staff: boolean, releasedResults: boolean): AssessmentRepository {
  const scope = (row: { schoolId: string }) => { if (row.schoolId !== schoolId) throw new NotFoundException('Record not found'); };
  const grade = staff ? { score: true, feedback: true, gradedAt: true } as const : {};
  const select = {
    id: true, schoolId: true, assessmentId: true, studentId: true, clientId: true, status: true, submittedAt: true, ...grade,
    answers: { where: { schoolId }, orderBy: { id: 'asc' }, select: {
      id: true, schoolId: true, submissionId: true, questionId: true, response: true, fileKey: true, ...(staff ? { score: true } : {}),
    } },
  } satisfies Prisma.SubmissionSelect;
  type Projected = Prisma.SubmissionGetPayload<{ select: typeof select }>;
  type Grade = { score: number | null; feedback: string | null; gradedAt: Date | null; answerScores: Record<string, number | null> };
  const map = async (row: Projected): Promise<SubmissionWithAnswers> => {
    const [released] = releasedResults && row.status === 'GRADED' ? await tx.$queryRaw<Grade[]>`
      SELECT score, feedback, graded_at AS "gradedAt", answer_scores AS "answerScores"
      FROM wasl_assessment.released_grade(${row.id}::uuid)` : [];
    return {
      ...row, score: row.score ?? released?.score ?? null, feedback: row.feedback ?? released?.feedback ?? null,
      gradedAt: row.gradedAt ?? released?.gradedAt ?? null,
      answers: row.answers.map(a => {
        if (a.response !== null && typeof a.response !== 'string') throw new ConflictException('Unsupported stored answer format');
        return { ...a, response: a.response, score: a.score ?? released?.answerScores[a.id] ?? null };
      }),
    };
  };
  return {
    questionStats: async id => {
      const [stats] = await tx.$queryRaw<{ questionCount: number; totalPoints: number }[]>`
        SELECT question_count AS "questionCount", total_points AS "totalPoints"
        FROM wasl_assessment.question_stats(${schoolId}::uuid, ${id}::uuid)`;
      return stats;
    },
    list: () => tx.assessment.findMany({ where: { schoolId } }),
    get: id => tx.assessment.findFirst({ where: { id, schoolId } }),
    create: data => { scope(data); return tx.assessment.create({ data }); },
    update: row => {
      scope(row);
      const { type, title, instructions, opensAt, dueAt, status, resultsReleasedAt } = row;
      return tx.assessment.update({ where: { id: row.id, schoolId }, data: { type, title, instructions, opensAt, dueAt, status, resultsReleasedAt } });
    },
    questions: id => tx.assessmentQuestion.findMany({ where: { assessmentId: id, schoolId }, orderBy: [{ order: 'asc' }, { questionId: 'asc' }] }),
    replaceQuestions: async (id, rows) => {
      rows.forEach(row => { scope(row); if (row.assessmentId !== id) throw new NotFoundException(); });
      if (!await tx.assessment.findFirst({ where: { id, schoolId }, select: { id: true } })) throw new NotFoundException();
      await tx.assessmentQuestion.deleteMany({ where: { assessmentId: id, schoolId } });
      if (rows.length) await tx.assessmentQuestion.createMany({ data: rows });
    },
    submissions: async assessmentId => Promise.all((await tx.submission.findMany({ where: { schoolId, assessmentId }, select })).map(map)),
    submission: async id => { const row = await tx.submission.findFirst({ where: { id, schoolId }, select }); return row ? map(row) : null; },
    studentSubmission: async (assessmentId, studentId) => { const row = await tx.submission.findFirst({ where: { schoolId, assessmentId, studentId }, select }); return row ? map(row) : null; },
    saveSubmission: async (data, answers, create) => {
      scope(data); answers.forEach(a => { scope(a); if (a.submissionId !== data.id) throw new NotFoundException(); });
      if (staff) {
        if (create) throw new ConflictException('Grading requires an existing submission');
        const { status, score, feedback, gradedAt } = data;
        await tx.submission.update({ where: { id: data.id, schoolId }, data: { status, score, feedback, gradedAt } });
        for (const answer of answers) await tx.answer.update({
          where: { id: answer.id, schoolId, submissionId: data.id }, data: { score: answer.score }, select: { id: true },
        });
        return map(await tx.submission.findUniqueOrThrow({ where: { id: data.id, schoolId }, select }));
      }
      if (create) {
        await tx.$executeRaw`INSERT INTO public.submissions (id, school_id, assessment_id, student_id)
          VALUES (${data.id}::uuid, ${schoolId}::uuid, ${data.assessmentId}::uuid, ${data.studentId}::uuid)`;
      }
      await tx.answer.deleteMany({ where: { submissionId: data.id, schoolId } });
      if (answers.length) {
        const values = answers.map(a => Prisma.sql`(${a.id}::uuid, ${schoolId}::uuid, ${a.submissionId}::uuid,
          ${a.questionId}::uuid, ${a.response === null ? null : JSON.stringify(a.response)}::jsonb, ${a.fileKey})`);
        await tx.$executeRaw`INSERT INTO public.answers (id, school_id, submission_id, question_id, response, file_key)
          VALUES ${Prisma.join(values)}`;
      }
      const updated = await tx.$executeRaw`UPDATE public.submissions SET status = ${data.status}::public."SubmissionStatus",
        submitted_at = ${data.submittedAt} WHERE id = ${data.id}::uuid AND school_id = ${schoolId}::uuid`;
      if (updated !== 1) throw new ConflictException('This assessment has already been submitted');
      return map(await tx.submission.findUniqueOrThrow({ where: { id: data.id, schoolId }, select }));
    },
  };
}
