import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ENROLLMENT_STATUSES, LINK_STATUSES, SCHOOL_ROLES } from '@wasl/shared';
import type { EnrollmentStatus, LinkStatus, Locale, SchoolRole } from '@wasl/shared';

export const Trim = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value);
export const Email = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value);
export class ListDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @Trim() @IsString() @MaxLength(200) search?: string;
  @ApiPropertyOptional({ enum: ['name', 'id'] }) @IsOptional() @IsIn(['name', 'id']) sort: 'name' | 'id' = 'name';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) order: 'asc' | 'desc' = 'asc';
}
export class SchoolListDto extends ListDto { @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) active?: 'true' | 'false'; }
export class PeopleListDto extends SchoolListDto { @ApiPropertyOptional({ enum: [...SCHOOL_ROLES] }) @IsOptional() @IsIn([...SCHOOL_ROLES]) role?: SchoolRole; }
export class AcademicListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
  @ApiPropertyOptional({ enum: [...ENROLLMENT_STATUSES] }) @IsOptional() @IsIn([...ENROLLMENT_STATUSES]) status?: EnrollmentStatus;
}
export class LinkListDto extends ListDto { @ApiPropertyOptional({ enum: [...LINK_STATUSES] }) @IsOptional() @IsIn([...LINK_STATUSES]) status?: LinkStatus; }
export class ChildQueryDto { @ApiPropertyOptional() @IsOptional() @IsUUID() schoolId?: string; }
export class CreateSchoolDto {
  @ApiProperty() @Trim() @IsString() @Length(2, 200) name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @Trim() @IsString() @MaxLength(200) nameAr?: string | null;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @ValidateIf((_, value) => value !== undefined) @IsIn(['ar', 'en']) locale?: Locale;
}
export class UpdateSchoolDto extends PartialType(CreateSchoolDto, { skipNullProperties: false }) {
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @IsBoolean() active?: boolean;
}
export class CreateUserDto {
  @ApiProperty() @Email() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 200) fullName: string;
  @ApiProperty({ writeOnly: true }) @IsString() @MinLength(12) @MaxLength(72) password: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @ValidateIf((_, value) => value !== undefined) @IsIn(['ar', 'en']) preferredLanguage?: Locale;
  @ApiProperty({ enum: [...SCHOOL_ROLES] }) @IsIn([...SCHOOL_ROLES]) role: SchoolRole;
}
export class CreateMembershipDto {
  @ApiProperty() @Email() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty({ enum: [...SCHOOL_ROLES] }) @IsIn([...SCHOOL_ROLES]) role: SchoolRole;
}
export class SchoolAdministratorDto {
  @ApiProperty() @Email() @IsEmail() @MaxLength(254) email: string;
  @ApiPropertyOptional({ description: 'Required only when creating a new identity.' }) @ValidateIf((_, value) => value !== undefined) @Trim() @IsString() @Length(1, 200) fullName?: string;
  @ApiPropertyOptional({ writeOnly: true, description: 'Required only for a new identity; never replaces an existing password.' }) @ValidateIf((_, value) => value !== undefined) @IsString() @MinLength(12) @MaxLength(72) password?: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @ValidateIf((_, value) => value !== undefined) @IsIn(['ar', 'en']) preferredLanguage?: Locale;
}
export class MembershipStateDto { @ApiProperty() @IsBoolean() active: boolean; }
export class ProfileDto {
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @Trim() @IsString() @Length(1, 200) fullName?: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @ValidateIf((_, value) => value !== undefined) @IsIn(['ar', 'en']) preferredLanguage?: Locale;
}
export class CreateYearDto {
  @ApiProperty() @Trim() @IsString() @Length(1, 200) name: string;
  @ApiProperty({ example: '2026-09-01' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate: string;
  @ApiProperty({ example: '2027-06-30' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @IsBoolean() archived?: boolean;
}
export class UpdateYearDto extends PartialType(CreateYearDto, { skipNullProperties: false }) {}
export class CreateSemesterDto {
  @ApiProperty() @IsUUID() academicYearId: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 200) name: string;
  @ApiProperty({ example: '2026-09-01' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate: string;
  @ApiProperty({ example: '2027-01-31' }) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate: string;
}
export class UpdateSemesterDto extends PartialType(CreateSemesterDto, { skipNullProperties: false }) {}
export class CreateGradeDto {
  @ApiProperty() @Trim() @IsString() @Length(1, 200) name: string;
  @ApiProperty() @IsDefined() @IsInt() @Min(-2147483648) @Max(2147483647) level: number;
}
export class UpdateGradeDto extends PartialType(CreateGradeDto, { skipNullProperties: false }) {}
export class CreateSectionDto {
  @ApiProperty() @IsUUID() gradeId: string;
  @ApiProperty() @IsUUID() academicYearId: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 200) name: string;
}
export class UpdateSectionDto extends PartialType(CreateSectionDto, { skipNullProperties: false }) {}
export class CreateSubjectDto {
  @ApiProperty() @Trim() @IsString() @Length(1, 200) nameAr: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 200) nameEn: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @Trim() @IsString() @MaxLength(100) code?: string | null;
}
export class UpdateSubjectDto extends PartialType(CreateSubjectDto, { skipNullProperties: false }) {}
export class CreateAssignmentDto {
  @ApiProperty() @IsUUID() sectionId: string;
  @ApiProperty() @IsUUID() subjectId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsUUID() teacherId?: string | null;
}
export class UpdateAssignmentDto extends PartialType(CreateAssignmentDto, { skipNullProperties: false }) {}
export class CreateEnrollmentDto {
  @ApiProperty() @IsUUID() sectionId: string;
  @ApiProperty() @IsUUID() studentId: string;
  @ApiPropertyOptional({ enum: [...ENROLLMENT_STATUSES] }) @ValidateIf((_, value) => value !== undefined) @IsIn([...ENROLLMENT_STATUSES]) status?: EnrollmentStatus;
}
export class UpdateEnrollmentDto extends PartialType(CreateEnrollmentDto, { skipNullProperties: false }) {}
export class CreateLinkDto {
  @ApiProperty() @IsUUID() parentId: string;
  @ApiProperty() @IsUUID() studentId: string;
}
export class LinkStateDto { @ApiProperty({ enum: [...LINK_STATUSES], description: 'Revocation uses REJECTED and clears verifiedAt.' }) @IsIn([...LINK_STATUSES]) status: LinkStatus; }
