import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { FILE_PURPOSES, PUBLISH_STATUSES } from '@wasl/shared';
import type { FilePurpose, PublishStatus } from '@wasl/shared';
import { IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { ListDto, Trim } from './dto';

export class CreateAnnouncementDto {
  @ApiPropertyOptional({ type: String, nullable: true }) @ValidateIf((_, v) => v !== undefined && v !== null) @IsUUID() sectionSubjectId?: string | null;
  @ApiProperty() @Trim() @IsString() @Length(1, 300) title: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 20000) body: string;
}
class AnnouncementFieldsDto {
  @ApiProperty() @Trim() @IsString() @Length(1, 300) title: string;
  @ApiProperty() @Trim() @IsString() @Length(1, 20000) body: string;
}
export class UpdateAnnouncementDto extends PartialType(AnnouncementFieldsDto, { skipNullProperties: false }) {}
export class AnnouncementListDto extends ListDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionSubjectId?: string;
  @ApiPropertyOptional({ enum: [...PUBLISH_STATUSES] }) @IsOptional() @IsIn([...PUBLISH_STATUSES]) status?: PublishStatus;
}
export class NotificationListDto extends ListDto {
  @ApiPropertyOptional({ enum: ['all', 'read', 'unread'], default: 'all' }) @IsOptional() @IsIn(['all', 'read', 'unread']) read: 'all' | 'read' | 'unread' = 'all';
}
export class FileUploadDto {
  @ApiProperty({ enum: [...FILE_PURPOSES] }) @IsIn([...FILE_PURPOSES]) purpose: FilePurpose;
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== undefined) @IsUUID() lessonId?: string;
  @ApiPropertyOptional() @ValidateIf((_, v) => v !== undefined) @IsUUID() assessmentId?: string;
}
