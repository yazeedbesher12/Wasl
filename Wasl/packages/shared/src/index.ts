export const ROLES = [
  'PLATFORM_ADMIN',
  'SCHOOL_ADMIN',
  'TEACHER',
  'STUDENT',
  'PARENT',
] as const;
export type Role = (typeof ROLES)[number];

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export interface MembershipDto {
  schoolId: string | null;
  schoolName: string | null;
  role: Role;
}

export interface MeDto {
  id: string;
  email: string;
  fullName: string;
  preferredLanguage: Locale;
  activeSchoolId: string | null;
  memberships: MembershipDto[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse extends TokenPair {
  user: MeDto;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export * from './client';
