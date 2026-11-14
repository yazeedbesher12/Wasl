import type { EnrollmentStatus, LinkStatus, Locale, Role } from '@wasl/shared';

// Persistence entities mirror schema.prisma. Dates remain Date objects inside adapters.
export interface School { id: string; name: string; nameAr: string | null; locale: Locale; active: boolean; createdAt: Date }
export interface Person { id: string; email: string; fullName: string; passwordHash: string; preferredLanguage: Locale; active: boolean; createdAt: Date }
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
export interface AcademicMap { academicYears: AcademicYear; semesters: Semester; grades: Grade; sections: Section; subjects: Subject; sectionSubjects: SectionSubject; enrollments: Enrollment }
export type AcademicKind = keyof AcademicMap;
