import { applyDecorators, type Type } from '@nestjs/common';
import { ApiCreatedResponse, ApiExtraModels, ApiOkResponse, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { ENROLLMENT_STATUSES, LINK_STATUSES, ROLES, SCHOOL_ROLES } from '@wasl/shared';

// Public response models only; no persistence entity is registered with Swagger.
export class SchoolResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) nameAr: string | null;
  @ApiProperty({ enum: ['ar', 'en'] }) locale: string;
  @ApiProperty() active: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiPropertyOptional() studentCount?: number;
  @ApiPropertyOptional() teacherCount?: number;
}
export class UserResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'email' }) email: string;
  @ApiProperty() fullName: string;
  @ApiProperty({ enum: ['ar', 'en'] }) preferredLanguage: string;
  @ApiProperty() active: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class MembershipResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ format: 'uuid' }) schoolId: string;
  @ApiProperty({ enum: [...SCHOOL_ROLES] }) role: string;
  @ApiProperty() active: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class UserCreatedResponse { @ApiProperty({ type: UserResponse }) user: UserResponse; @ApiProperty({ type: MembershipResponse }) membership: MembershipResponse; }
class AcademicBase { @ApiProperty({ format: 'uuid' }) id: string; @ApiProperty({ format: 'uuid' }) schoolId: string; }
export class YearResponse extends AcademicBase { @ApiProperty() name: string; @ApiProperty({ format: 'date' }) startDate: string; @ApiProperty({ format: 'date' }) endDate: string; @ApiProperty() archived: boolean; }
export class SemesterResponse extends AcademicBase { @ApiProperty({ format: 'uuid' }) academicYearId: string; @ApiProperty() name: string; @ApiProperty({ format: 'date' }) startDate: string; @ApiProperty({ format: 'date' }) endDate: string; }
export class GradeResponse extends AcademicBase { @ApiProperty() name: string; @ApiProperty() level: number; }
export class SectionResponse extends AcademicBase { @ApiProperty({ format: 'uuid' }) gradeId: string; @ApiProperty({ format: 'uuid' }) academicYearId: string; @ApiProperty() name: string; }
export class SubjectResponse extends AcademicBase { @ApiProperty() nameAr: string; @ApiProperty() nameEn: string; @ApiProperty({ type: String, nullable: true }) code: string | null; }
export class AssignmentResponse extends AcademicBase { @ApiProperty({ format: 'uuid' }) sectionId: string; @ApiProperty({ format: 'uuid' }) subjectId: string; @ApiProperty({ format: 'uuid', type: String, nullable: true }) teacherId: string | null; }
export class EnrollmentResponse extends AcademicBase { @ApiProperty({ format: 'uuid' }) sectionId: string; @ApiProperty({ format: 'uuid' }) studentId: string; @ApiProperty({ enum: [...ENROLLMENT_STATUSES] }) status: string; @ApiProperty({ format: 'date-time' }) createdAt: string; }
export class LinkResponse extends AcademicBase { @ApiProperty({ format: 'uuid' }) parentId: string; @ApiProperty({ format: 'uuid' }) studentId: string; @ApiProperty({ enum: [...LINK_STATUSES] }) status: string; @ApiProperty({ type: String, nullable: true, format: 'date-time' }) verifiedAt: string | null; @ApiProperty({ format: 'date-time' }) createdAt: string; }
export class NamedPersonResponse { @ApiProperty({ format: 'uuid' }) id: string; @ApiProperty() fullName: string; }
export class ClassResponse {
  @ApiProperty({ type: AssignmentResponse }) assignment: AssignmentResponse;
  @ApiProperty({ type: SubjectResponse }) subject: SubjectResponse;
  @ApiProperty({ type: SectionResponse }) section: SectionResponse;
  @ApiProperty({ type: GradeResponse }) grade: GradeResponse;
  @ApiProperty({ type: YearResponse }) academicYear: YearResponse;
  @ApiProperty({ type: NamedPersonResponse, nullable: true }) teacher: NamedPersonResponse | null;
}
export class RosterResponse { @ApiProperty({ type: EnrollmentResponse }) enrollment: EnrollmentResponse; @ApiProperty({ type: NamedPersonResponse }) student: NamedPersonResponse; }
export class ChildResponse { @ApiProperty({ type: LinkResponse }) link: LinkResponse; @ApiProperty({ type: SchoolResponse }) school: SchoolResponse; @ApiProperty({ type: NamedPersonResponse }) student: NamedPersonResponse; }
class CountsResponse { @ApiProperty() academicYears: number; @ApiProperty() sections: number; @ApiProperty() subjects: number; @ApiProperty() assignments: number; @ApiProperty() activeEnrollments: number; }
export class OverviewResponse { @ApiProperty({ type: SchoolResponse }) school: SchoolResponse; @ApiProperty({ type: NamedPersonResponse, nullable: true }) student: NamedPersonResponse | null; @ApiProperty({ type: [ClassResponse] }) classes: ClassResponse[]; @ApiProperty({ type: [EnrollmentResponse] }) enrollments: EnrollmentResponse[]; @ApiProperty({ type: CountsResponse }) counts: CountsResponse; }
class ActiveMembershipResponse { @ApiProperty() id: string; @ApiProperty({ type: String, nullable: true }) schoolId: string | null; @ApiProperty({ type: String, nullable: true }) schoolName: string | null; @ApiProperty({ enum: [...ROLES] }) role: string; }
export class MeResponse { @ApiProperty() id: string; @ApiProperty() email: string; @ApiProperty() fullName: string; @ApiProperty({ enum: ['ar', 'en'] }) preferredLanguage: string; @ApiProperty({ type: String, nullable: true }) activeSchoolId: string | null; @ApiProperty({ enum: [...ROLES] }) activeRole: string; @ApiProperty() membershipId: string; @ApiProperty({ type: [ActiveMembershipResponse] }) memberships: ActiveMembershipResponse[]; }
export class TokensResponse { @ApiProperty() accessToken: string; @ApiProperty() refreshToken: string; }
export class LoginResponseModel extends TokensResponse { @ApiProperty({ type: MeResponse }) user: MeResponse; }
export function Respond(model: Type<unknown>, page = false, created = false) {
  const response = created ? ApiCreatedResponse : ApiOkResponse;
  return applyDecorators(ApiExtraModels(model), response(page ? { schema: { type: 'object', required: ['items','total','page','limit'], properties: { items: { type: 'array', items: { $ref: getSchemaPath(model) } }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer', maximum: 100 } } } } : { type: model }));
}
