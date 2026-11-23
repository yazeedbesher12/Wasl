import { IsString, Length } from 'class-validator';
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { FileUploadDto } from '../foundation/communication.dto';
import { Respond } from '../foundation/responses';
import { FileService } from './file.service';
import { MAX_FILE_BYTES } from './object-store';
import { FILE_PURPOSES } from '@wasl/shared';

export class FileResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) schoolId: string;
  @ApiProperty({ format: 'uuid' }) ownerId: string;
  @ApiProperty({ enum: [...FILE_PURPOSES] }) purpose: string;
  @ApiProperty({ type: String, nullable: true }) lessonId: string | null;
  @ApiProperty({ type: String, nullable: true }) assessmentId: string | null;
  @ApiProperty() storageKey: string;
  @ApiProperty() originalName: string;
  @ApiProperty() contentType: string;
  @ApiProperty() size: number;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
class ResolveFileQuery { @ApiProperty() @IsString() @Length(1, 1000) storageKey: string; }
@ApiTags('private files') @ApiBearerAuth() @Roles('TEACHER', 'SCHOOL_ADMIN', 'STUDENT', 'PARENT') @Controller('files')
export class FileController {
  constructor(private service: FileService) {}
  @Post() @Roles('TEACHER', 'SCHOOL_ADMIN', 'STUDENT') @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file', 'purpose'], properties: { file: { type: 'string', format: 'binary' }, purpose: { type: 'string', enum: [...FILE_PURPOSES] }, lessonId: { type: 'string', format: 'uuid' }, assessmentId: { type: 'string', format: 'uuid' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 3, parts: 4, fieldSize: 1024 } }))
  @Respond(FileResponse, false, true)
  upload(@CurrentUser() u: AuthUser, @Body() dto: FileUploadDto, @UploadedFile() file?: Express.Multer.File) { return this.service.upload(u, dto, file); }
  @Get('resolve') @Respond(FileResponse) resolve(@CurrentUser() u: AuthUser, @Query() q: ResolveFileQuery) { return this.service.resolve(u, q.storageKey); }
  @Get(':id') @Respond(FileResponse) metadata(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.metadata(u, id); }
  @Get(':id/content') @Header('Cache-Control', 'private, no-store') @Header('X-Content-Type-Options', 'nosniff')
  @ApiOkResponse({ description: 'Authorized immutable file bytes as an attachment.', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } })
  async content(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const { data, metadata } = await this.service.download(u, id);
    const name = encodeURIComponent(metadata.originalName).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return new StreamableFile(data, { type: metadata.contentType, length: data.length, disposition: `attachment; filename="download"; filename*=UTF-8''${name}` });
  }
}
