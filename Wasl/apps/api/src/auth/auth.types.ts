import type { Role } from '@wasl/shared';

/** Claims carried in the access token. */
export interface AuthUser {
  membershipId: string;
  sub: string;
  email: string;
  schoolId: string | null;
  role: Role;
}
