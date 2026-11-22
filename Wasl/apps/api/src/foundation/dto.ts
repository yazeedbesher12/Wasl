import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ENROLLMENT_STATUSES, LINK_STATUSES, PUBLISH_STATUSES, QUESTION_TYPES, RESOURCE_TYPES, SCHOOL_ROLES } from '@wasl/shared';
import type { EnrollmentStatus, LinkStatus, Locale, PublishStatus, QuestionType, ResourceType, SchoolRole } from '@wasl/shared';

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
export class UnitListDto extends ListDto { @ApiPropertyOptional() @IsOptional() @IsUUID() sectionSubjectId?: string; }
export class LessonListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string;
  @ApiPropertyOptional({ enum: [...PUBLISH_STATUSES] }) @IsOptional() @IsIn([...PUBLISH_STATUSES]) status?: PublishStatus;
}
export class ResourceListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() lessonId?: string;
  @ApiPropertyOptional({ enum: [...RESOURCE_TYPES] }) @IsOptional() @IsIn([...RESOURCE_TYPES]) type?: ResourceType;
}
export class QuestionBankListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
}
export class QuestionListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() questionBankId?: string;
  @ApiPropertyOptional({ enum: [...QUESTION_TYPES] }) @IsOptional() @IsIn([...QUESTION_TYPES]) type?: QuestionType;
}
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
export class CreateUnitDto {
  @ApiProperty() @IsUUID() sectionSubjectId: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 300) title: string;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(2147483647) order?: number;
}
export class UpdateUnitDto {
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @Trim() @IsString() @Length(1, 300) title?: string;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) order?: number;
}
export class CreateLessonDto {
  @ApiProperty() @IsUUID() unitId: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 300) title: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @Trim() @IsString() @MaxLength(100000) body?: string | null;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(2147483647) order?: number;
}
export class UpdateLessonDto {
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @Trim() @IsString() @Length(1, 300) title?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @Trim() @IsString() @MaxLength(100000) body?: string | null;
  @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @IsInt() @Min(0) @Max(2147483647) order?: number;
  @ApiPropertyOptional({ enum: [...PUBLISH_STATUSES] }) @ValidateIf((_, value) => value !== undefined) @IsIn([...PUBLISH_STATUSES]) status?: PublishStatus;
}
export class CreateResourceDto {
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsUUID() lessonId?: string | null;
  @ApiProperty({ enum: [...RESOURCE_TYPES] }) @IsIn([...RESOURCE_TYPES]) type: ResourceType;
  @ApiProperty() @Trim() @IsString() @Length(1, 300) title: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Metadata key only; binary upload is not provided by this API.' }) @ValidateIf((_, value) => value !== undefined && value !== null) @Trim() @IsString() @Length(1, 1000) storageKey?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2048 }) @ValidateIf((_, value) => value !== undefined && value !== null) @Trim() @IsString() @MaxLength(2048) url?: string | null;
  @ApiPropertyOptional({ default: false }) @ValidateIf((_, value) => value !== undefined) @IsBoolean() offlineAllowed?: boolean;
}
export class UpdateResourceDto extends PartialType(CreateResourceDto, { skipNullProperties: false }) {}
export class CreateQuestionBankDto {
  @ApiProperty() @IsUUID() subjectId: string;
  @ApiPropertyOptional({ description: 'School admins assign an active teacher; teachers are always the owner themselves.' }) @IsOptional() @IsUUID() ownerId?: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 300) name: string;
}
export class UpdateQuestionBankDto { @ApiPropertyOptional() @ValidateIf((_, value) => value !== undefined) @Trim() @IsString() @Length(1, 300) name?: string; }
export class QuestionOptionInputDto {
  @ApiProperty() @Trim() @IsString() @Length(1, 1000) text: string;
  @ApiProperty() @IsBoolean() isCorrect: boolean;
}
export class CreateQuestionDto {
  @ApiProperty({ enum: [...QUESTION_TYPES] }) @IsIn([...QUESTION_TYPES]) type: QuestionType;
  @ApiProperty() @Trim() @IsString() @Length(1, 10000) text: string;
  @ApiPropertyOptional({ default: 1, minimum: 0.01, maximum: 10000 }) @IsOptional() @Type(() => Number) @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(0.01) @Max(10000) points?: number;
  @ApiPropertyOptional({ type: [QuestionOptionInputDto], maxItems: 50 }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => QuestionOptionInputDto) options?: QuestionOptionInputDto[];
}
export class UpdateQuestionDto extends PartialType(CreateQuestionDto, { skipNullProperties: false }) {}
