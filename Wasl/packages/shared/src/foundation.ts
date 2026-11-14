import type { Locale, Role } from './index';

/** API contracts, deliberately separate from the browser demo/snapshot model. */
export const SCHOOL_ROLES = ['SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT'] as const;
export type SchoolRole = typeof SCHOOL_ROLES[number];
export const LINK_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type LinkStatus = typeof LINK_STATUSES[number];
export const ENROLLMENT_STATUSES = ['ACTIVE', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN'] as const;
export type EnrollmentStatus = typeof ENROLLMENT_STATUSES[number];
export interface Page<T> { items: T[]; total: number; page: number; limit: number }
export interface ListQuery { page?: number; limit?: number; search?: string; sort?: 'name' | 'id'; order?: 'asc' | 'desc'; active?: 'true' | 'false'; role?: SchoolRole; status?: EnrollmentStatus | LinkStatus; academicYearId?: string; sectionId?: string }
export interface SchoolDto { id: string; name: string; nameAr: string | null; locale: Locale; active: boolean; createdAt: string }
export interface SchoolSummaryDto extends SchoolDto { studentCount: number; teacherCount: number }
export interface SchoolCreate { name: string; nameAr?: string | null; locale?: Locale }
export interface SchoolUpdate { name?: string; nameAr?: string | null; locale?: Locale; active?: boolean }
export interface UserDto { id: string; email: string; fullName: string; preferredLanguage: Locale; active: boolean; createdAt: string }
export interface UserCreate { email: string; fullName: string; password: string; preferredLanguage?: Locale; role: SchoolRole }
export interface ProfileUpdate { fullName?: string; preferredLanguage?: Locale }
export interface SchoolMembershipDto { id: string; userId: string; schoolId: string; role: SchoolRole; active: boolean; createdAt: string }
export interface MembershipCreate { email: string; role: SchoolRole }
export interface SchoolAdministratorCreate { email: string; fullName?: string; password?: string; preferredLanguage?: Locale }
export interface AcademicYearDto { id: string; schoolId: string; name: string; startDate: string; endDate: string; archived: boolean }
export interface SemesterDto { id: string; schoolId: string; academicYearId: string; name: string; startDate: string; endDate: string }
export interface GradeDto { id: string; schoolId: string; name: string; level: number }
export interface SectionDto { id: string; schoolId: string; gradeId: string; academicYearId: string; name: string }
export interface SubjectDto { id: string; schoolId: string; nameAr: string; nameEn: string; code: string | null }
export interface SectionSubjectDto { id: string; schoolId: string; sectionId: string; subjectId: string; teacherId: string | null }
export interface EnrollmentDto { id: string; schoolId: string; sectionId: string; studentId: string; status: EnrollmentStatus; createdAt: string }
export interface AcademicDtoMap { academicYears: AcademicYearDto; semesters: SemesterDto; grades: GradeDto; sections: SectionDto; subjects: SubjectDto; sectionSubjects: SectionSubjectDto; enrollments: EnrollmentDto }
export type AcademicKind = keyof AcademicDtoMap;
export const ACADEMIC_PATHS: Record<AcademicKind, string> = { academicYears: 'academic-years', semesters: 'semesters', grades: 'grades', sections: 'sections', subjects: 'subjects', sectionSubjects: 'section-subjects', enrollments: 'enrollments' };
export type AcademicCreate<K extends AcademicKind> = Omit<AcademicDtoMap[K], 'id' | 'schoolId' | 'createdAt' | 'archived' | 'status' | 'code' | 'teacherId'> &
  (K extends 'academicYears' ? { archived?: boolean } : K extends 'subjects' ? { code?: string | null } : K extends 'sectionSubjects' ? { teacherId?: string | null } : K extends 'enrollments' ? { status?: EnrollmentStatus } : object);
export type AcademicUpdate<K extends AcademicKind> = Partial<AcademicCreate<K>>;
export interface ParentLinkDto { id: string; schoolId: string; parentId: string; studentId: string; status: LinkStatus; verifiedAt: string | null; createdAt: string }
export interface ParentLinkCreate { parentId: string; studentId: string }
export interface ClassDto { assignment: SectionSubjectDto; subject: SubjectDto; section: SectionDto; grade: GradeDto; academicYear: AcademicYearDto; teacher: { id: string; fullName: string } | null }
export interface RosterEntryDto { enrollment: EnrollmentDto; student: { id: string; fullName: string } }
export interface ChildDto { link: ParentLinkDto; school: SchoolDto; student: { id: string; fullName: string } }
export interface AcademicOverviewDto { school: SchoolDto; student: { id: string; fullName: string } | null; classes: ClassDto[]; enrollments: EnrollmentDto[]; counts: { academicYears: number; sections: number; subjects: number; assignments: number; activeEnrollments: number } }
export interface StorageHealthDto { status: 'ok'; storageDriver: 'memory' | 'prisma' }
export interface ActiveContextDto { membershipId: string; activeRole: Role; activeSchoolId: string | null }
