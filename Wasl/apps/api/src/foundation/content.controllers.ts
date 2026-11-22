import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ContentService } from './content.service';
import { CreateLessonDto, CreateUnitDto, LessonListDto, UnitListDto, UpdateLessonDto, UpdateUnitDto } from './dto';
import { LessonResponse, Respond, UnitResponse } from './responses';

@ApiTags('units') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('units')
export class UnitsController {
  constructor(private service: ContentService) {}
  @Get() @Respond(UnitResponse, true) list(@CurrentUser() user: AuthUser, @Query() query: UnitListDto) { return this.service.listUnits(user, query); }
  @Get(':id') @Respond(UnitResponse) get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getUnit(user, id); }
  @Post() @Roles('SCHOOL_ADMIN', 'TEACHER') @Respond(UnitResponse, false, true) create(@CurrentUser() user: AuthUser, @Body() input: CreateUnitDto) { return this.service.createUnit(user, input); }
  @Patch(':id') @Roles('SCHOOL_ADMIN', 'TEACHER') @Respond(UnitResponse) update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateUnitDto) { return this.service.updateUnit(user, id, input); }
}

@ApiTags('lessons') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('lessons')
export class LessonsController {
  constructor(private service: ContentService) {}
  @Get() @Respond(LessonResponse, true) list(@CurrentUser() user: AuthUser, @Query() query: LessonListDto) { return this.service.listLessons(user, query); }
  @Get(':id') @Respond(LessonResponse) get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getLesson(user, id); }
  @Post() @Roles('SCHOOL_ADMIN', 'TEACHER') @Respond(LessonResponse, false, true) create(@CurrentUser() user: AuthUser, @Body() input: CreateLessonDto) { return this.service.createLesson(user, input); }
  @Patch(':id') @Roles('SCHOOL_ADMIN', 'TEACHER') @Respond(LessonResponse) update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateLessonDto) { return this.service.updateLesson(user, id, input); }
}
