import type { LoginResponse, MeDto, TokenPair } from './index';
import { ACADEMIC_PATHS } from './foundation';
import type { AcademicCreate, AcademicDtoMap, AcademicKind, AcademicOverviewDto, AcademicUpdate, ChildDto, ClassDto, LessonCreate, LessonDto, LessonUpdate, LinkStatus, ListQuery, MembershipCreate, Page, ParentLinkCreate, ParentLinkDto, ProfileUpdate, PublishStatus, QuestionAuthorDto, QuestionBankCreate, QuestionBankDto, QuestionBankUpdate, QuestionCreate, QuestionSafeDto, QuestionType, QuestionUpdate, ResourceCreate, ResourceDto, ResourceType, ResourceUpdate, RosterEntryDto, SchoolAdministratorCreate, SchoolCreate, SchoolDto, SchoolMembershipDto, SchoolSummaryDto, SchoolUpdate, StorageHealthDto, UnitCreate, UnitDto, UnitUpdate, UserCreate, UserDto } from './foundation';
import type { Role } from './index';

/** Minimal typed API client shared by the web and mobile apps. */
export class WaslClient {
  constructor(
    private baseUrl: string,
    private getToken: () => string | null = () => null,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
    const body = res.status === 204 ? undefined : await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(body?.message ?? res.statusText), { status: res.status, body });
    }
    return body as T;
  }

  login(email: string, password: string) {
    return this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  refresh(refreshToken: string) {
    return this.request<TokenPair>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  }

  me() {
    return this.request<MeDto>('/me');
  }

  logout(refreshToken: string) { return this.request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }); }
  switchSchool(schoolId: string | null, role: Role) { return this.request<TokenPair>('/auth/switch-school', { method: 'POST', body: JSON.stringify({ schoolId, role }) }); }
  private query(query?: object) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) params.set(key, String(value));
    const encoded = params.toString();
    return encoded ? '?' + encoded : '';
  }
  health(readiness = false) { return this.request<StorageHealthDto>(readiness ? '/health/ready' : '/health'); }
  schools(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order' | 'active'>) { return this.request<Page<SchoolSummaryDto>>('/admin/schools' + this.query(query)); }
  school(id: string) { return this.request<SchoolSummaryDto>('/admin/schools/' + encodeURIComponent(id)); }
  createSchool(input: SchoolCreate) { return this.request<SchoolDto>('/admin/schools', { method: 'POST', body: JSON.stringify(input) }); }
  provisionSchoolAdministrator(id: string, input: SchoolAdministratorCreate) { return this.request<{ user: UserDto; membership: SchoolMembershipDto }>("/admin/schools/" + encodeURIComponent(id) + "/administrator", { method: "POST", body: JSON.stringify(input) }); }
  updateSchool(id: string, input: SchoolUpdate) { return this.request<SchoolDto>('/admin/schools/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) }); }
  users(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order' | 'active' | 'role'>) { return this.request<Page<UserDto>>('/users' + this.query(query)); }
  user(id: string) { return this.request<UserDto>('/users/' + encodeURIComponent(id)); }
  createUser(input: UserCreate) { return this.request<{ user: UserDto; membership: SchoolMembershipDto }>('/users', { method: 'POST', body: JSON.stringify(input) }); }
  updateProfile(input: ProfileUpdate) { return this.request<UserDto>('/me/profile', { method: 'PATCH', body: JSON.stringify(input) }); }
  memberships(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order' | 'active' | 'role'>) { return this.request<Page<SchoolMembershipDto>>('/memberships' + this.query(query)); }
  membership(id: string) { return this.request<SchoolMembershipDto>('/memberships/' + encodeURIComponent(id)); }
  addMembership(input: MembershipCreate) { return this.request<SchoolMembershipDto>('/memberships', { method: 'POST', body: JSON.stringify(input) }); }
  setMembershipActive(id: string, active: boolean) { return this.request<SchoolMembershipDto>('/memberships/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ active }) }); }
  academicList<K extends AcademicKind>(kind: K, query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order' | 'sectionId' | 'academicYearId'> & { status?: AcademicDtoMap['enrollments']['status'] }) { return this.request<Page<AcademicDtoMap[K]>>('/' + ACADEMIC_PATHS[kind] + this.query(query)); }
  academicDetail<K extends AcademicKind>(kind: K, id: string) { return this.request<AcademicDtoMap[K]>('/' + ACADEMIC_PATHS[kind] + '/' + encodeURIComponent(id)); }
  createAcademic<K extends AcademicKind>(kind: K, input: AcademicCreate<K>) { return this.request<AcademicDtoMap[K]>('/' + ACADEMIC_PATHS[kind], { method: 'POST', body: JSON.stringify(input) }); }
  updateAcademic<K extends AcademicKind>(kind: K, id: string, input: AcademicUpdate<K>) { return this.request<AcademicDtoMap[K]>('/' + ACADEMIC_PATHS[kind] + '/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) }); }
  units(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { sectionSubjectId?: string }) { return this.request<Page<UnitDto>>('/units' + this.query(query)); }
  unit(id: string) { return this.request<UnitDto>('/units/' + encodeURIComponent(id)); }
  createUnit(input: UnitCreate) { return this.request<UnitDto>('/units', { method: 'POST', body: JSON.stringify(input) }); }
  updateUnit(id: string, input: UnitUpdate) { return this.request<UnitDto>('/units/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) }); }
  lessons(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { unitId?: string; status?: PublishStatus }) { return this.request<Page<LessonDto>>('/lessons' + this.query(query)); }
  lesson(id: string) { return this.request<LessonDto>('/lessons/' + encodeURIComponent(id)); }
  createLesson(input: LessonCreate) { return this.request<LessonDto>('/lessons', { method: 'POST', body: JSON.stringify(input) }); }
  updateLesson(id: string, input: LessonUpdate) { return this.request<LessonDto>('/lessons/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) }); }
  resources(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { lessonId?: string; type?: ResourceType }) { return this.request<Page<ResourceDto>>('/resources' + this.query(query)); }
  resource(id: string) { return this.request<ResourceDto>('/resources/' + encodeURIComponent(id)); }
  createResource(input: ResourceCreate) { return this.request<ResourceDto>('/resources', { method: 'POST', body: JSON.stringify(input) }); }
  updateResource(id: string, input: ResourceUpdate) { return this.request<ResourceDto>('/resources/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) }); }
  questionBanks(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { subjectId?: string; ownerId?: string }) { return this.request<Page<QuestionBankDto>>('/question-banks' + this.query(query)); }
  questionBank(id: string) { return this.request<QuestionBankDto>('/question-banks/' + encodeURIComponent(id)); }
  createQuestionBank(input: QuestionBankCreate) { return this.request<QuestionBankDto>('/question-banks', { method: 'POST', body: JSON.stringify(input) }); }
  updateQuestionBank(id: string, input: QuestionBankUpdate) { return this.request<QuestionBankDto>('/question-banks/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) }); }
  questions(bankId: string, query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { type?: QuestionType }) { return this.request<Page<QuestionAuthorDto>>('/question-banks/' + encodeURIComponent(bankId) + '/questions' + this.query(query)); }
  question(id: string) { return this.request<QuestionAuthorDto>('/questions/' + encodeURIComponent(id)); }
  createQuestion(bankId: string, input: QuestionCreate) { return this.request<QuestionAuthorDto>('/question-banks/' + encodeURIComponent(bankId) + '/questions', { method: 'POST', body: JSON.stringify(input) }); }
  updateQuestion(id: string, input: QuestionUpdate) { return this.request<QuestionAuthorDto>('/questions/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input) }); }
  studentQuestions(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { questionBankId?: string; type?: QuestionType }) { return this.request<Page<QuestionSafeDto>>('/student/questions' + this.query(query)); }
  studentQuestion(id: string) { return this.request<QuestionSafeDto>('/student/questions/' + encodeURIComponent(id)); }
  teacherClasses(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'>) { return this.request<Page<ClassDto>>('/teacher/classes' + this.query(query)); }
  teacherRoster(assignmentId: string, query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'>) { return this.request<Page<RosterEntryDto>>('/teacher/classes/' + encodeURIComponent(assignmentId) + '/roster' + this.query(query)); }
  roster(assignmentId: string, query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'>) { return this.request<Page<RosterEntryDto>>('/section-subjects/' + encodeURIComponent(assignmentId) + '/roster' + this.query(query)); }
  classes(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'>) { return this.request<Page<ClassDto>>('/me/classes' + this.query(query)); }
  mySubjects(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'>) { return this.request<Page<AcademicDtoMap['subjects']>>('/me/subjects' + this.query(query)); }
  schoolOverview() { return this.request<AcademicOverviewDto>('/school/academic-overview'); }
  parentLinks(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'> & { status?: LinkStatus }) { return this.request<Page<ParentLinkDto>>('/parent-links' + this.query(query)); }
  parentLink(id: string) { return this.request<ParentLinkDto>('/parent-links/' + encodeURIComponent(id)); }
  createParentLink(input: ParentLinkCreate) { return this.request<ParentLinkDto>('/parent-links', { method: 'POST', body: JSON.stringify(input) }); }
  setParentLinkStatus(id: string, status: LinkStatus) { return this.request<ParentLinkDto>('/parent-links/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status }) }); }
  children(query?: Pick<ListQuery, 'page' | 'limit' | 'search' | 'sort' | 'order'>) { return this.request<Page<ChildDto>>('/parent/children' + this.query(query)); }
  childOverview(studentId: string, schoolId?: string) { return this.request<AcademicOverviewDto>('/parent/children/' + encodeURIComponent(studentId) + '/overview' + this.query({ schoolId })); }
}
