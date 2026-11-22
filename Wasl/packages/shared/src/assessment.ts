import type { ListQuery, QuestionAuthorDto, QuestionSafeDto } from './foundation';

export const ASSESSMENT_TYPES = ['ASSIGNMENT', 'EXAM'] as const;
export type AssessmentType = typeof ASSESSMENT_TYPES[number];
export const ASSESSMENT_STATUSES = ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'GRADING', 'RESULTS_RELEASED', 'ARCHIVED'] as const;
export type AssessmentStatus = typeof ASSESSMENT_STATUSES[number];
export const SUBMISSION_STATUSES = ['IN_PROGRESS', 'SUBMITTED', 'LATE', 'GRADED'] as const;
export type SubmissionStatus = typeof SUBMISSION_STATUSES[number];
export type AssessmentQuery = Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { sectionSubjectId?: string; type?: AssessmentType; status?: AssessmentStatus };
export type SubmissionQuery = Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { studentId?: string; status?: SubmissionStatus };
export interface AssessmentCreate { sectionSubjectId: string; type: AssessmentType; title: string; instructions?: string | null; opensAt?: string | null; dueAt?: string | null }
export type AssessmentUpdate = Partial<Omit<AssessmentCreate, 'sectionSubjectId'>>;
export interface AssessmentQuestionInput { questionId: string; order: number }
export interface AssessmentQuestionsUpdate { questions: AssessmentQuestionInput[] }
export interface AssessmentDto { id: string; schoolId: string; sectionSubjectId: string; type: AssessmentType; title: string; instructions: string | null; opensAt: string | null; dueAt: string | null; status: AssessmentStatus; resultsReleasedAt: string | null; createdAt: string; questionCount: number; totalPoints: number }
export interface AssessmentDetailDto extends AssessmentDto { questions: (QuestionSafeDto & { order: number })[] }
export interface AssessmentAuthorDetailDto extends AssessmentDto { questions: (QuestionAuthorDto & { order: number })[] }
/** Choice answers use optionId. Written answers use text. File keys are metadata only. */
export interface AnswerInput { questionId: string; optionId?: string; text?: string; fileKey?: string }
export interface SaveAnswersInput { answers: AnswerInput[] }
export interface AnswerDto { id: string; questionId: string; response: string | null; fileKey: string | null; score: number | null }
export interface SubmissionDto { id: string; schoolId: string; assessmentId: string; studentId: string; status: SubmissionStatus; submittedAt: string | null; score: number | null; feedback: string | null; gradedAt: string | null; resultsReleased: boolean; answers: AnswerDto[] }
export interface AnswerGradeInput { questionId: string; score: number }
export interface GradeSubmissionInput { answers: AnswerGradeInput[]; feedback?: string | null }
export interface ReleasedResultDto { id: string; assessment: AssessmentDto; submission: SubmissionDto }
