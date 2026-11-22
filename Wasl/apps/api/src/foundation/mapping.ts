import type { AcademicDtoMap, AcademicKind as ApiAcademicKind, ParentLinkDto, QuestionAuthorDto, QuestionBankDto, QuestionSafeDto, ResourceDto, SchoolDto, SchoolMembershipDto, UserDto } from '@wasl/shared';
import type { AcademicMap, Lesson, Membership, ParentLink, Person, QuestionBank, QuestionWithOptions, Resource, School, Unit } from './entities';
export const schoolDto = (s: School): SchoolDto => ({ id: s.id, name: s.name, nameAr: s.nameAr, locale: s.locale, active: s.active, createdAt: s.createdAt.toISOString() });
export const userDto = (u: Person): UserDto => ({ id: u.id, email: u.email, fullName: u.fullName, preferredLanguage: u.preferredLanguage, active: u.active, createdAt: u.createdAt.toISOString() });
export const memberDto = (m: Membership): SchoolMembershipDto => {
  if (!m.schoolId || m.role === 'PLATFORM_ADMIN') throw new Error('School membership mapping requires a school role');
  return { id: m.id, userId: m.userId, schoolId: m.schoolId, role: m.role, active: m.active, createdAt: m.createdAt.toISOString() };
};
export const linkDto = (l: ParentLink): ParentLinkDto => ({ id: l.id, schoolId: l.schoolId, parentId: l.parentId, studentId: l.studentId, status: l.status, verifiedAt: l.verifiedAt?.toISOString() ?? null, createdAt: l.createdAt.toISOString() });
export const unitDto = (u: Unit) => ({ id: u.id, schoolId: u.schoolId, sectionSubjectId: u.sectionSubjectId, title: u.title, order: u.order });
export const lessonDto = (l: Lesson) => ({ id: l.id, schoolId: l.schoolId, unitId: l.unitId, title: l.title, body: l.body, order: l.order, status: l.status, publishedAt: l.publishedAt?.toISOString() ?? null });
export const resourceDto = (r: Resource): ResourceDto => ({ id: r.id, schoolId: r.schoolId, lessonId: r.lessonId, type: r.type, title: r.title, storageKey: r.storageKey, url: r.url, offlineAllowed: r.offlineAllowed, createdAt: r.createdAt.toISOString() });
export const questionBankDto = (b: QuestionBank): QuestionBankDto => ({ id: b.id, schoolId: b.schoolId, subjectId: b.subjectId, ownerId: b.ownerId, name: b.name });
export const questionAuthorDto = (q: QuestionWithOptions): QuestionAuthorDto => ({ id: q.id, schoolId: q.schoolId, questionBankId: q.questionBankId, type: q.type, text: q.text, points: q.points, options: q.options.map(o => ({ id: o.id, text: o.text, isCorrect: o.isCorrect })) });
export const questionSafeDto = (q: QuestionWithOptions): QuestionSafeDto => ({ id: q.id, schoolId: q.schoolId, questionBankId: q.questionBankId, type: q.type, text: q.text, points: q.points, options: (q.type === 'SHORT_ANSWER' ? [] : q.options).map(o => ({ id: o.id, text: o.text })) });
export function academicDto<K extends ApiAcademicKind>(kind: K, row: AcademicMap[K]): AcademicDtoMap[K] {
  const base = { id: row.id, schoolId: row.schoolId };
  const map = {
    academicYears: () => { const s = row as AcademicMap['academicYears']; return { ...base, name: s.name, startDate: s.startDate.toISOString().slice(0,10), endDate: s.endDate.toISOString().slice(0,10), archived: s.archived }; },
    semesters: () => { const s = row as AcademicMap['semesters']; return { ...base, academicYearId: s.academicYearId, name: s.name, startDate: s.startDate.toISOString().slice(0,10), endDate: s.endDate.toISOString().slice(0,10) }; },
    grades: () => { const s = row as AcademicMap['grades']; return { ...base, name: s.name, level: s.level }; },
    sections: () => { const s = row as AcademicMap['sections']; return { ...base, gradeId: s.gradeId, academicYearId: s.academicYearId, name: s.name }; },
    subjects: () => { const s = row as AcademicMap['subjects']; return { ...base, nameAr: s.nameAr, nameEn: s.nameEn, code: s.code }; },
    sectionSubjects: () => { const s = row as AcademicMap['sectionSubjects']; return { ...base, sectionId: s.sectionId, subjectId: s.subjectId, teacherId: s.teacherId }; },
    enrollments: () => { const s = row as AcademicMap['enrollments']; return { ...base, sectionId: s.sectionId, studentId: s.studentId, status: s.status, createdAt: s.createdAt.toISOString() }; },
  };
  return map[kind]() as AcademicDtoMap[K];
}
