import type { Role } from '@wasl/shared';
import type { AcademicKind, AcademicMap, Membership, ParentLink, Person, RefreshRecord, School } from './entities';

export const STORAGE = Symbol('WASL_PHASE1_STORAGE');
/** These scopes are server-created only; never accepted from an HTTP request body. */
export interface StorageScope { kind: 'identity' | 'platform' | 'school' | 'parent-list'; userId: string | null; schoolId: string | null }
export interface IdentityRepository {
  personById(id: string): Promise<Person | null>;
  personByEmail(email: string): Promise<Person | null>;
  membershipsFor(userId: string): Promise<Membership[]>;
  createPerson(row: Person): Promise<Person>;
  updateProfile(id: string, patch: Pick<Person, 'fullName' | 'preferredLanguage'>): Promise<Person>;
  refreshByHash(hash: string): Promise<RefreshRecord | null>;
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
export interface Repositories { identity: IdentityRepository; schools: SchoolRepository; people: PeopleRepository; academics: AcademicRepository; links: LinkRepository }
/** A single atomic boundary for a complete service operation, including its scope checks. */
export interface FoundationStorage {
  readonly driver: 'memory' | 'prisma';
  run<T>(scope: StorageScope, work: (repositories: Repositories) => Promise<T>): Promise<T>;
  ready(): Promise<void>;
}
