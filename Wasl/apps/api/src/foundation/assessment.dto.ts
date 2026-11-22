import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ASSESSMENT_STATUSES, ASSESSMENT_TYPES, SUBMISSION_STATUSES } from '@wasl/shared';
import type { AssessmentStatus, AssessmentType, SubmissionStatus } from '@wasl/shared';
import { ListDto, Trim } from './dto';

export class AssessmentListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionSubjectId?: string;
  @ApiPropertyOptional({ enum: [...ASSESSMENT_TYPES] }) @IsOptional() @IsIn([...ASSESSMENT_TYPES]) type?: AssessmentType;
  @ApiPropertyOptional({ enum: [...ASSESSMENT_STATUSES] }) @IsOptional() @IsIn([...ASSESSMENT_STATUSES]) status?: AssessmentStatus;
}
export class SubmissionListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() studentId?: string;
  @ApiPropertyOptional({ enum: [...SUBMISSION_STATUSES] }) @IsOptional() @IsIn([...SUBMISSION_STATUSES]) status?: SubmissionStatus;
}
export class AssessmentFieldsDto {
  @ApiProperty({ enum: [...ASSESSMENT_TYPES] }) @IsIn([...ASSESSMENT_TYPES]) type: AssessmentType;
  @ApiProperty() @Trim() @IsString() @Length(1, 300) title: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @ValidateIf((_, v) => v !== undefined && v !== null) @Trim() @IsString() @MaxLength(20000) instructions?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time', description: 'ISO timestamp including Z or an explicit timezone offset.' })
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) opensAt?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, format: 'date-time' })
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) dueAt?: string | null;
}
export class CreateAssessmentDto extends AssessmentFieldsDto { @ApiProperty() @IsUUID() sectionSubjectId: string; }
export class UpdateAssessmentDto extends PartialType(AssessmentFieldsDto, { skipNullProperties: false }) {}
export class AssessmentQuestionInputDto {
  @ApiProperty() @IsUUID() questionId: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) @Max(2147483647) order: number;
}
export class ReplaceAssessmentQuestionsDto {
  @ApiProperty({ type: [AssessmentQuestionInputDto], maxItems: 200, description: 'Complete replacement of the ordered draft question list.' })
  @IsArray() @ArrayMaxSize(200) @ArrayUnique((q: AssessmentQuestionInputDto) => q?.questionId) @ArrayUnique((q: AssessmentQuestionInputDto) => q?.order)
  @ValidateNested({ each: true }) @Type(() => AssessmentQuestionInputDto) questions: AssessmentQuestionInputDto[];
}
export class AnswerInputDto {
  @ApiProperty() @IsUUID() questionId: string;
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== undefined) @IsUUID() optionId?: string;
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(20000) text?: string;
  @ApiPropertyOptional({ description: 'Metadata only, under schools/{schoolId}/students/{studentId}/. No binary upload is provided.' })
  @ValidateIf((_, v) => v !== undefined) @IsString() @Length(1, 1000) fileKey?: string;
}
export class SaveAnswersDto {
  @ApiProperty({ type: [AnswerInputDto], maxItems: 200, description: 'Complete replacement; an empty array clears an in-progress draft.' })
  @IsArray() @ArrayMaxSize(200) @ArrayUnique((a: AnswerInputDto) => a?.questionId) @ValidateNested({ each: true }) @Type(() => AnswerInputDto) answers: AnswerInputDto[];
}
export class AnswerGradeDto {
  @ApiProperty() @IsUUID() questionId: string;
  @ApiProperty({ minimum: 0 }) @IsNumber({ allowInfinity: false, allowNaN: false }) @Min(0) @Max(10000) score: number;
}
export class GradeSubmissionDto {
  @ApiProperty({ type: [AnswerGradeDto], maxItems: 200 }) @IsArray() @ArrayMaxSize(200) @ArrayUnique((a: AnswerGradeDto) => a?.questionId) @ValidateNested({ each: true }) @Type(() => AnswerGradeDto) answers: AnswerGradeDto[];
  @ApiPropertyOptional({ type: String, nullable: true }) @ValidateIf((_, v) => v !== undefined && v !== null) @Trim() @IsString() @MaxLength(20000) feedback?: string | null;
}
export class ParentResultQueryDto extends ListDto { @ApiPropertyOptional() @IsOptional() @IsUUID() schoolId?: string; }
