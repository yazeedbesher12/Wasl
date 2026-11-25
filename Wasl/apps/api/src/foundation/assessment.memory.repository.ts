import { ConflictException, NotFoundException } from '@nestjs/common';
import type { MemoryState } from './memory.seed';
import type { AssessmentRepository } from './repositories';

export function memoryAssessments(s: MemoryState, schoolId: string | null): AssessmentRepository {
  const scoped = (row: { schoolId: string }) => schoolId !== null && row.schoolId === schoolId;
  const missing = () => new NotFoundException('Record not found');
  return {
    list: async () => s.assessments.filter(scoped),
    get: async id => s.assessments.find(a => a.id === id && scoped(a)) ?? null,
    create: async row => {
      if (!scoped(row) || !s.academics.sectionSubjects.some(a => a.id === row.sectionSubjectId && scoped(a))) throw missing();
      if (s.assessments.some(a => a.id === row.id)) throw new ConflictException();
      s.assessments.push(row); return row;
    },
    update: async row => {
      const index = s.assessments.findIndex(a => a.id === row.id && scoped(a));
      if (index < 0 || !scoped(row)) throw missing();
      s.assessments[index] = row; return row;
    },
    questionStats: async id => {
      const links = s.assessmentQuestions.filter(q => q.assessmentId === id && scoped(q));
      return { questionCount: links.length, totalPoints: links.reduce((total, link) =>
        total + (s.questions.find(q => q.id === link.questionId && scoped(q))?.points ?? 0), 0) };
    },
    questions: async id => s.assessmentQuestions.filter(q => q.assessmentId === id && scoped(q)).sort((a, b) => a.order - b.order || a.questionId.localeCompare(b.questionId)),
    replaceQuestions: async (id, rows) => {
      if (!s.assessments.some(a => a.id === id && scoped(a)) || rows.some(q => !scoped(q) || q.assessmentId !== id || !s.questions.some(v => v.id === q.questionId && scoped(v)))) throw missing();
      if (new Set(rows.map(q => q.questionId)).size !== rows.length) throw new ConflictException();
      s.assessmentQuestions = s.assessmentQuestions.filter(q => !(q.assessmentId === id && scoped(q))).concat(rows);
    },
    submissions: async id => s.submissions.filter(v => v.assessmentId === id && scoped(v)),
    submission: async id => s.submissions.find(v => v.id === id && scoped(v)) ?? null,
    studentSubmission: async (assessmentId, studentId) => s.submissions.find(v => v.assessmentId === assessmentId && v.studentId === studentId && scoped(v)) ?? null,
    saveSubmission: async (row, answers, create) => {
      if (!scoped(row) || !s.assessments.some(a => a.id === row.assessmentId && scoped(a)) || answers.some(a => !scoped(a) || a.submissionId !== row.id)) throw missing();
      const index = s.submissions.findIndex(v => v.id === row.id && scoped(v));
      if (create && s.submissions.some(v => v.id === row.id || v.assessmentId === row.assessmentId && v.studentId === row.studentId)) throw new ConflictException();
      if (!create && index < 0) throw missing();
      if (new Set(answers.map(a => a.questionId)).size !== answers.length || answers.some(a => !s.assessmentQuestions.some(q => q.assessmentId === row.assessmentId && q.questionId === a.questionId && scoped(q)))) throw new ConflictException();
      const result = { ...row, answers };
      if (create) s.submissions.push(result); else s.submissions[index] = result;
      return result;
    },
  };
}
