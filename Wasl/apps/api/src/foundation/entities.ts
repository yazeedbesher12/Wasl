import type { EnrollmentStatus, LinkStatus, Locale, QuestionType, ResourceType, Role } from '@wasl/shared';
import type { AssessmentStatus, AssessmentType, SubmissionStatus } from '@wasl/shared';
import type { FilePurpose, NotificationPayload, NotificationType } from '@wasl/shared';

// Persistence entities mirror schema.prisma. Dates remain Date objects inside adapters.
export interface School { id: string; name: string; nameAr: string | null; locale: Locale; active: boolean; createdAt: Date }
export interface PersonProfile { id: string; email: string; fullName: string; preferredLanguage: Locale; active: boolean; createdAt: Date }
export interface Person extends PersonProfile { passwordHash: string }
export interface Membership { id: string; userId: string; schoolId: string | null; role: Role; active: boolean; createdAt: Date }
export interface ParentLink { id: string; schoolId: string; parentId: string; studentId: string; status: LinkStatus; verifiedAt: Date | null; createdAt: Date }
export interface RefreshRecord { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date }
export interface AcademicYear { id: string; schoolId: string; name: string; startDate: Date; endDate: Date; archived: boolean }
export interface Semester { id: string; schoolId: string; academicYearId: string; name: string; startDate: Date; endDate: Date }
export interface Grade { id: string; schoolId: string; name: string; level: number }
export interface Section { id: string; schoolId: string; gradeId: string; academicYearId: string; name: string }
export interface Subject { id: string; schoolId: string; nameAr: string; nameEn: string; code: string | null }
export interface SectionSubject { id: string; schoolId: string; sectionId: string; subjectId: string; teacherId: string | null }
export interface Enrollment { id: string; schoolId: string; sectionId: string; studentId: string; status: EnrollmentStatus; createdAt: Date }
export interface Unit { id: string; schoolId: string; sectionSubjectId: string; title: string; order: number }
export type PublishStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export interface Lesson { id: string; schoolId: string; unitId: string; title: string; body: string | null; order: number; status: PublishStatus; publishedAt: Date | null }
export interface Resource { id: string; schoolId: string; lessonId: string | null; type: ResourceType; title: string; storageKey: string | null; url: string | null; offlineAllowed: boolean; createdAt: Date }
export interface QuestionBank { id: string; schoolId: string; subjectId: string; ownerId: string; name: string }
export interface Question { id: string; schoolId: string; questionBankId: string; type: QuestionType; text: string; points: number }
export interface QuestionOption { id: string; schoolId: string; questionId: string; text: string; isCorrect: boolean }
export interface QuestionWithOptions extends Question { options: QuestionOption[] }
export interface SafeQuestionWithOptions extends Question { options: Omit<QuestionOption, 'isCorrect'>[] }
export interface AcademicMap { academicYears: AcademicYear; semesters: Semester; grades: Grade; sections: Section; subjects: Subject; sectionSubjects: SectionSubject; enrollments: Enrollment }
export type AcademicKind = keyof AcademicMap;
export interface Assessment { id: string; schoolId: string; sectionSubjectId: string; type: AssessmentType; title: string; instructions: string | null; opensAt: Date | null; dueAt: Date | null; status: AssessmentStatus; resultsReleasedAt: Date | null; createdAt: Date }
export interface AssessmentQuestion { schoolId: string; assessmentId: string; questionId: string; order: number }
export interface Submission { id: string; schoolId: string; assessmentId: string; studentId: string; clientId: string | null; status: SubmissionStatus; submittedAt: Date | null; score: number | null; feedback: string | null; gradedAt: Date | null }
export interface Answer { id: string; schoolId: string; submissionId: string; questionId: string; response: string | null; fileKey: string | null; score: number | null }
export interface SubmissionWithAnswers extends Submission { answers: Answer[] }
export interface FileObject { id: string; schoolId: string; ownerId: string; purpose: FilePurpose; lessonId: string | null; assessmentId: string | null; storageKey: string; storageDriver: string; originalName: string; contentType: string; size: number; sha256: string; createdAt: Date }
export interface Announcement { id: string; schoolId: string; authorId: string; sectionSubjectId: string | null; title: string; body: string; status: PublishStatus; publishedAt: Date | null; createdAt: Date }
export interface Notification { id: string; schoolId: string; userId: string; type: NotificationType; payload: NotificationPayload; readAt: Date | null; createdAt: Date }
