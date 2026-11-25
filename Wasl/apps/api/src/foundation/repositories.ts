import type { Role } from '@wasl/shared';
import type { Announcement, FileObject, Notification } from './entities';
import type { Answer, Assessment, AssessmentQuestion, Submission, SubmissionWithAnswers } from './entities';
import type { AcademicKind, AcademicMap, Lesson, Membership, ParentLink, Person, PersonProfile, Question, QuestionBank, QuestionOption, QuestionWithOptions, RefreshRecord, Resource, School, Unit } from './entities';

export const STORAGE = Symbol('WASL_PHASE1_STORAGE');
/** These scopes are server-created only; never accepted from an HTTP request body. */
export type SubjectAccess = { operation: 'read'; childId?: string } | { operation: 'insert' | 'update'; subjectId: string };
export interface StorageScope {
  kind: 'authentication' | 'identity' | 'platform' | 'school-administration' | 'academic-administration' | 'assessment-staff' | 'school' | 'parent-list';
  userId: string | null;
  schoolId: string | null;
  subjects?: { membershipId: string; access: SubjectAccess };
  assessment?: { membershipId: string; operation: 'draft' | 'submit' | 'results' | 'read' | 'metadata' | 'discover' | 'staff-read' | 'staff-write' | 'staff-grade'; targetId: string };
}
export interface IdentityRepository {
  personById(id: string): Promise<PersonProfile | null>;
  personByEmail(email: string): Promise<PersonProfile | null>;
  membershipsFor(userId: string): Promise<Membership[]>;
  createPerson(row: Person): Promise<PersonProfile>;
  updateProfile(id: string, patch: Pick<PersonProfile, 'fullName' | 'preferredLanguage'>): Promise<PersonProfile>;
}
export type LoginCredential = Pick<Person, 'id' | 'email' | 'active' | 'passwordHash'>;
export interface AuthenticationRepository {
  credentialById(id: string): Promise<LoginCredential | null>;
  credentialByEmail(email: string): Promise<LoginCredential | null>;
  refreshByHash(hash: string): Promise<Pick<RefreshRecord, 'userId' | 'expiresAt' | 'revokedAt'> | null>;
  createRefresh(row: RefreshRecord): Promise<void>;
  consumeRefresh(hash: string, now: Date): Promise<boolean>;
  revokeRefresh(hash: string, now: Date): Promise<void>;
}
export interface SchoolRepository {
  list(): Promise<School[]>;
  get(id: string): Promise<School | null>;
  create(row: School): Promise<School>;
  update(id: string, patch: Partial<Pick<School, 'name' | 'nameAr' | 'locale' | 'active'>>): Promise<School>;
  countPeople(schoolId: string, role: 'STUDENT' | 'TEACHER'): Promise<number>;
}
export interface PeopleRepository {
  memberships(): Promise<Membership[]>;
  createMembership(row: Membership): Promise<Membership>;
  setMembershipActive(id: string, active: boolean): Promise<Membership>;
  eligible(userId: string, role: Role): Promise<boolean>;
}
export interface AcademicRepository {
  list<K extends AcademicKind>(kind: K): Promise<AcademicMap[K][]>;
  get<K extends AcademicKind>(kind: K, id: string): Promise<AcademicMap[K] | null>;
  create<K extends AcademicKind>(kind: K, row: AcademicMap[K]): Promise<AcademicMap[K]>;
  update<K extends AcademicKind>(kind: K, row: AcademicMap[K]): Promise<AcademicMap[K]>;
}
export interface LinkRepository {
  list(): Promise<ParentLink[]>;
  forParent(parentId: string): Promise<ParentLink[]>;
  get(id: string): Promise<ParentLink | null>;
  create(row: ParentLink): Promise<ParentLink>;
  update(row: ParentLink): Promise<ParentLink>;
}
export interface ContentRepository {
  listUnits(): Promise<Unit[]>;
  getUnit(id: string): Promise<Unit | null>;
  createUnit(row: Unit): Promise<Unit>;
  updateUnit(row: Unit): Promise<Unit>;
  listLessons(): Promise<Lesson[]>;
  getLesson(id: string): Promise<Lesson | null>;
  createLesson(row: Lesson): Promise<Lesson>;
  updateLesson(row: Lesson): Promise<Lesson>;
  listResources(): Promise<Resource[]>;
  getResource(id: string): Promise<Resource | null>;
  createResource(row: Resource): Promise<Resource>;
  updateResource(row: Resource): Promise<Resource>;
}
export interface QuestionRepository {
  listBanks(): Promise<QuestionBank[]>;
  getBank(id: string): Promise<QuestionBank | null>;
  createBank(row: QuestionBank): Promise<QuestionBank>;
  updateBank(row: QuestionBank): Promise<QuestionBank>;
  listQuestions(): Promise<QuestionWithOptions[]>;
  getQuestion(id: string): Promise<QuestionWithOptions | null>;
  listSafeQuestions(): Promise<import('./entities').SafeQuestionWithOptions[]>;
  getSafeQuestion(id: string): Promise<import('./entities').SafeQuestionWithOptions | null>;
  createQuestion(row: Question, options: QuestionOption[]): Promise<QuestionWithOptions>;
  updateQuestion(row: Question, options: QuestionOption[]): Promise<QuestionWithOptions>;
  isQuestionLocked(id: string): Promise<boolean>;
}
export interface AssessmentRepository {
  questionStats(id: string): Promise<{ questionCount: number; totalPoints: number }>;
  list(): Promise<Assessment[]>;
  get(id: string): Promise<Assessment | null>;
  create(row: Assessment): Promise<Assessment>;
  update(row: Assessment): Promise<Assessment>;
  questions(id: string): Promise<AssessmentQuestion[]>;
  replaceQuestions(id: string, rows: AssessmentQuestion[]): Promise<void>;
  submissions(assessmentId: string): Promise<SubmissionWithAnswers[]>;
  submission(id: string): Promise<SubmissionWithAnswers | null>;
  studentSubmission(assessmentId: string, studentId: string): Promise<SubmissionWithAnswers | null>;
  saveSubmission(row: Submission, answers: Answer[], create: boolean): Promise<SubmissionWithAnswers>;
}
export interface FileRepository { get(id: string): Promise<FileObject | null>; byKey(key: string): Promise<FileObject | null>; create(row: FileObject): Promise<FileObject> }
export interface CommunicationRepository {
  announcements(): Promise<Announcement[]>;
  announcement(id: string): Promise<Announcement | null>;
  createAnnouncement(row: Announcement): Promise<Announcement>;
  updateAnnouncement(row: Announcement): Promise<Announcement>;
  notifications(userId: string): Promise<Notification[]>;
  notify(rows: Notification[]): Promise<void>;
  markRead(id: string, userId: string, at: Date): Promise<Notification>;
}
export interface Repositories { readonly authentication: AuthenticationRepository; identity: IdentityRepository; schools: SchoolRepository; people: PeopleRepository; academics: AcademicRepository; content: ContentRepository; questions: QuestionRepository; links: LinkRepository; assessments: AssessmentRepository; files: FileRepository; communication: CommunicationRepository }
/** A single atomic boundary for a complete service operation, including its scope checks. */
export interface FoundationStorage {
  readonly driver: 'memory' | 'prisma';
  run<T>(scope: StorageScope, work: (repositories: Repositories) => Promise<T>): Promise<T>;
  ready(): Promise<void>;
}
