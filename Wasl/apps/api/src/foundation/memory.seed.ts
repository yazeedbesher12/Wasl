import * as bcrypt from 'bcryptjs';
import type { AcademicMap, Membership, ParentLink, Person, RefreshRecord, School } from './entities';

export interface MemoryState { schools: School[]; users: Person[]; memberships: Membership[]; links: ParentLink[]; refresh: RefreshRecord[]; academics: { [K in keyof AcademicMap]: AcademicMap[K][] } }
export const developmentId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Development-only server bootstrap. Independent of frontend fixtures and IDs. Never logs credentials. */
export async function developmentState(password: string): Promise<MemoryState> {
  const at = new Date('2026-09-01T00:00:00.000Z'); const passwordHash = await bcrypt.hash(password, 12);
  const s: MemoryState = { schools: [], users: [], memberships: [], links: [], refresh: [], academics: { academicYears: [], semesters: [], grades: [], sections: [], subjects: [], sectionSubjects: [], enrollments: [] } };
  const person = (id: number, email: string, fullName: string) => s.users.push({ id: developmentId(id), email, fullName, passwordHash, preferredLanguage: 'ar', active: true, createdAt: at });
  person(100, 'platform@wasl.test', 'مدير منصة وصل'); person(130, 'parent@wasl.test', 'رنا خليل');
  s.memberships.push({ id: developmentId(300), userId: developmentId(100), schoolId: null, role: 'PLATFORM_ADMIN', active: true, createdAt: at });
  for (const [i, title, student] of [[1, 'النور', 'آدم خليل'], [2, 'الأمل', 'مايا خليل']] as const) {
    const schoolId = developmentId(i); const u = i * 10 + 100; const a = i * 100 + 300;
    s.schools.push({ id: schoolId, name: i === 1 ? 'Al Nour School' : 'Al Amal School', nameAr: `مدرسة ${title}`, locale: 'ar', active: true, createdAt: at });
    person(u, `admin${i}@wasl.test`, `مدير مدرسة ${title}`); person(u + 1, `teacher${i}@wasl.test`, `معلم مدرسة ${title}`); person(u + 2, `student${i}@wasl.test`, student);
    for (const [offset, user, role] of [[0, u, 'SCHOOL_ADMIN'], [1, u + 1, 'TEACHER'], [2, u + 2, 'STUDENT'], [3, 130, 'PARENT']] as const) s.memberships.push({ id: developmentId(a + 30 + offset), userId: developmentId(user), schoolId, role, active: true, createdAt: at });
    s.academics.academicYears.push({ id: developmentId(a), schoolId, name: '2026–2027', startDate: at, endDate: new Date('2027-06-30T00:00:00Z'), archived: false });
    s.academics.semesters.push({ id: developmentId(a + 1), schoolId, academicYearId: developmentId(a), name: 'الفصل الأول', startDate: at, endDate: new Date('2027-01-31T00:00:00Z') });
    s.academics.grades.push({ id: developmentId(a + 2), schoolId, name: 'الصف السابع', level: 7 });
    s.academics.sections.push({ id: developmentId(a + 3), schoolId, gradeId: developmentId(a + 2), academicYearId: developmentId(a), name: 'أ' });
    s.academics.subjects.push({ id: developmentId(a + 4), schoolId, nameAr: 'الرياضيات', nameEn: 'Mathematics', code: 'MATH' });
    s.academics.sectionSubjects.push({ id: developmentId(a + 5), schoolId, sectionId: developmentId(a + 3), subjectId: developmentId(a + 4), teacherId: developmentId(u + 1) });
    s.academics.enrollments.push({ id: developmentId(a + 6), schoolId, sectionId: developmentId(a + 3), studentId: developmentId(u + 2), status: 'ACTIVE', createdAt: at });
    s.links.push({ id: developmentId(600 + i), schoolId, parentId: developmentId(130), studentId: developmentId(u + 2), status: 'VERIFIED', verifiedAt: at, createdAt: at });
  }
  return s;
}
