import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { NOTIFICATION_TYPES, PUBLISH_STATUSES } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { Respond } from './responses';
import { AnnouncementListDto, CreateAnnouncementDto, NotificationListDto, UpdateAnnouncementDto } from './communication.dto';
import { CommunicationService } from './communication.service';

export class AnnouncementResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) schoolId: string;
  @ApiProperty({ format: 'uuid' }) authorId: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) sectionSubjectId: string | null;
  @ApiProperty() title: string;
  @ApiProperty() body: string;
  @ApiProperty({ enum: [...PUBLISH_STATUSES] }) status: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) publishedAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
class NotificationPayloadResponse {
  @ApiProperty({ format: 'uuid' }) entityId: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) sectionSubjectId: string | null;
  @ApiProperty({ required: false, format: 'uuid' }) studentId?: string;
}
export class NotificationResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) schoolId: string;
  @ApiProperty({ enum: [...NOTIFICATION_TYPES] }) type: string;
  @ApiProperty({ type: NotificationPayloadResponse }) payload: NotificationPayloadResponse;
  @ApiProperty() title: string;
  @ApiProperty() titleAr: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) readAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}
export class CountResponse { @ApiProperty() count: number; }
@ApiTags('announcements') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT') @Controller('announcements')
export class AnnouncementsController {
  constructor(private service: CommunicationService) {}
  @Get() @Respond(AnnouncementResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AnnouncementListDto) { return this.service.list(u, q); }
  @Get(':id') @Respond(AnnouncementResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(u, id); }
  @Post() @Roles('TEACHER', 'SCHOOL_ADMIN') @Respond(AnnouncementResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateAnnouncementDto) { return this.service.create(u, dto); }
  @Patch(':id') @Roles('TEACHER', 'SCHOOL_ADMIN') @Respond(AnnouncementResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAnnouncementDto) { return this.service.update(u, id, dto); }
  @Post(':id/publish') @HttpCode(200) @Roles('TEACHER', 'SCHOOL_ADMIN') @Respond(AnnouncementResponse) publish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(u, id, 'publish'); }
  @Post(':id/archive') @HttpCode(200) @Roles('TEACHER', 'SCHOOL_ADMIN') @Respond(AnnouncementResponse) archive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(u, id, 'archive'); }
}
@ApiTags('notifications') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT') @Controller('notifications')
export class NotificationsController {
  constructor(private service: CommunicationService) {}
  @Get() @Respond(NotificationResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: NotificationListDto) { return this.service.notifications(u, q); }
  @Get('unread-count') @Respond(CountResponse) count(@CurrentUser() u: AuthUser) { return this.service.unreadCount(u); }
  @Patch(':id/read') @Respond(NotificationResponse) read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.markRead(u, id); }
  @Post('read-all') @HttpCode(200) @Respond(CountResponse) all(@CurrentUser() u: AuthUser) { return this.service.markAllRead(u); }
}
