import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { CreateQuestionBankDto, CreateQuestionDto, CreateResourceDto, QuestionBankListDto, QuestionListDto, ResourceListDto, UpdateQuestionBankDto, UpdateQuestionDto, UpdateResourceDto } from './dto';
import { LearningService } from './learning.service';
import { QuestionAuthorResponse, QuestionBankResponse, QuestionSafeResponse, ResourceResponse, Respond } from './responses';

@ApiTags('resources') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('resources')
export class ResourcesController {
  constructor(private service: LearningService) {}
  @Get() @Respond(ResourceResponse, true) list(@CurrentUser() user: AuthUser, @Query() query: ResourceListDto) { return this.service.listResources(user, query); }
  @Get(':id') @Respond(ResourceResponse) get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getResource(user, id); }
  @Post() @Roles('SCHOOL_ADMIN', 'TEACHER') @Respond(ResourceResponse, false, true) create(@CurrentUser() user: AuthUser, @Body() input: CreateResourceDto) { return this.service.createResource(user, input); }
  @Patch(':id') @Roles('SCHOOL_ADMIN', 'TEACHER') @Respond(ResourceResponse) update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateResourceDto) { return this.service.updateResource(user, id, input); }
}

@ApiTags('question-banks') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER') @Controller('question-banks')
export class QuestionBanksController {
  constructor(private service: LearningService) {}
  @Get() @Respond(QuestionBankResponse, true) list(@CurrentUser() user: AuthUser, @Query() query: QuestionBankListDto) { return this.service.listQuestionBanks(user, query); }
  @Get(':id') @Respond(QuestionBankResponse) get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getQuestionBank(user, id); }
  @Post() @Respond(QuestionBankResponse, false, true) create(@CurrentUser() user: AuthUser, @Body() input: CreateQuestionBankDto) { return this.service.createQuestionBank(user, input); }
  @Patch(':id') @Respond(QuestionBankResponse) update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateQuestionBankDto) { return this.service.updateQuestionBank(user, id, input); }
  @Get(':id/questions') @Respond(QuestionAuthorResponse, true) questions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: QuestionListDto) { return this.service.listQuestions(user, id, query); }
  @Post(':id/questions') @Respond(QuestionAuthorResponse, false, true) createQuestion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: CreateQuestionDto) { return this.service.createQuestion(user, id, input); }
}

@ApiTags('questions') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER') @Controller('questions')
export class QuestionsController {
  constructor(private service: LearningService) {}
  @Get(':id') @Respond(QuestionAuthorResponse) get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getQuestion(user, id); }
  @Patch(':id') @Respond(QuestionAuthorResponse) update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateQuestionDto) { return this.service.updateQuestion(user, id, input); }
}

@ApiTags('student-questions') @ApiBearerAuth() @Roles('STUDENT') @Controller('student/questions')
export class StudentQuestionsController {
  constructor(private service: LearningService) {}
  @Get() @Respond(QuestionSafeResponse, true) list(@CurrentUser() user: AuthUser, @Query() query: QuestionListDto) { return this.service.listStudentQuestions(user, query); }
  @Get(':id') @Respond(QuestionSafeResponse) get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getStudentQuestion(user, id); }
}
