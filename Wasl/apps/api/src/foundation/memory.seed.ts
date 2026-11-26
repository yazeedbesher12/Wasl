import type { Announcement, FileObject, Notification } from './entities';
import * as bcrypt from 'bcryptjs';
import type { Assessment, AssessmentQuestion, SubmissionWithAnswers } from './entities';
import type { AcademicMap, Lesson, Membership, ParentLink, Person, QuestionBank, QuestionOption, QuestionWithOptions, RefreshRecord, Resource, School, SessionFamily, Unit } from './entities';

export interface MemoryState { files: FileObject[]; announcements: Announcement[]; notifications: Notification[]; schools: School[]; users: Person[]; memberships: Membership[]; links: ParentLink[]; refresh: RefreshRecord[]; sessionFamilies: SessionFamily[]; academics: { [K in keyof AcademicMap]: AcademicMap[K][] }; units: Unit[]; lessons: Lesson[]; resources: Resource[]; questionBanks: QuestionBank[]; questions: QuestionWithOptions[]; assessments: Assessment[]; assessmentQuestions: AssessmentQuestion[]; submissions: SubmissionWithAnswers[] }
export const developmentId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Development-only server bootstrap. Independent of frontend fixtures and IDs. Never logs credentials. */
export async function developmentState(password: string): Promise<MemoryState> {
  const at = new Date('2026-09-01T00:00:00.000Z'); const passwordHash = await bcrypt.hash(password, 12);
  const s: MemoryState = { files: [], announcements: [], notifications: [], schools: [], users: [], memberships: [], links: [], refresh: [], sessionFamilies: [], academics: { academicYears: [], semesters: [], grades: [], sections: [], subjects: [], sectionSubjects: [], enrollments: [] }, units: [], lessons: [], resources: [], questionBanks: [], questions: [], assessments: [], assessmentQuestions: [], submissions: [] };
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
    s.units.push({ id: developmentId(a + 7), schoolId, sectionSubjectId: developmentId(a + 5), title: 'Foundations', order: 1 });
    s.lessons.push({ id: developmentId(a + 8), schoolId, unitId: developmentId(a + 7), title: 'Introduction', body: 'Fictional published lesson content.', order: 1, status: 'PUBLISHED', publishedAt: at });
    s.lessons.push({ id: developmentId(a + 9), schoolId, unitId: developmentId(a + 7), title: 'Teacher draft', body: 'Fictional draft content.', order: 2, status: 'DRAFT', publishedAt: null });
    s.resources.push({ id: developmentId(a + 10), schoolId, lessonId: developmentId(a + 8), type: 'LINK', title: 'Fictional reference', storageKey: null, url: 'https://example.test/learning/reference', offlineAllowed: false, createdAt: at });
    s.resources.push({ id: developmentId(a + 11), schoolId, lessonId: developmentId(a + 9), type: 'FILE', title: 'Fictional worksheet metadata', storageKey: `schools/${i}/fictional-worksheet.pdf`, url: null, offlineAllowed: true, createdAt: at });
    const bank: QuestionBank = { id: developmentId(700 + i), schoolId, subjectId: developmentId(a + 4), ownerId: developmentId(u + 1), name: 'Fictional Mathematics Bank' };
    const questionId = developmentId(710 + i);
    const options: QuestionOption[] = [
      { id: developmentId(720 + i * 10), schoolId, questionId, text: 'Four', isCorrect: true },
      { id: developmentId(721 + i * 10), schoolId, questionId, text: 'Five', isCorrect: false },
    ];
    s.questionBanks.push(bank);
    s.questions.push({ id: questionId, schoolId, questionBankId: bank.id, type: 'MULTIPLE_CHOICE', text: 'What is two plus two?', points: 1, options });
    const assessmentId = developmentId(800 + i);
    s.assessments.push({ id: assessmentId, schoolId, sectionSubjectId: developmentId(a + 5), type: 'ASSIGNMENT', title: 'Fictional open practice', instructions: null, opensAt: at, dueAt: null, status: 'OPEN', resultsReleasedAt: null, createdAt: at });
    s.assessmentQuestions.push({ schoolId, assessmentId, questionId, order: 0 });
    s.links.push({ id: developmentId(600 + i), schoolId, parentId: developmentId(130), studentId: developmentId(u + 2), status: 'VERIFIED', verifiedAt: at, createdAt: at });
  }
  return s;
}
