import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOkResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AssessmentService } from './assessment.service';
import { AssessmentListDto, CreateAssessmentDto, GradeSubmissionDto, ParentResultQueryDto, ReplaceAssessmentQuestionsDto, SaveAnswersDto, SubmissionListDto, UpdateAssessmentDto } from './assessment.dto';
import { ListDto } from './dto';
import { Respond } from './responses';
import { AssessmentAuthorResponse, AssessmentDetailResponse, AssessmentResponse, ReleasedResultResponse, SubmissionResponse } from './assessment.responses';

@ApiTags('assessments') @ApiBearerAuth() @Roles('TEACHER', 'SCHOOL_ADMIN', 'STUDENT') @Controller('assessments')
export class AssessmentsController {
  constructor(private service: AssessmentService) {}
  @Get() @Respond(AssessmentResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AssessmentListDto) { return this.service.list(u, q); }
  @Get(':id') @ApiExtraModels(AssessmentAuthorResponse, AssessmentDetailResponse) @ApiOkResponse({ schema: { oneOf: [{ $ref: getSchemaPath(AssessmentAuthorResponse) }, { $ref: getSchemaPath(AssessmentDetailResponse) }] } })
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.get(u, id); }
  @Post() @Roles('TEACHER') @Respond(AssessmentAuthorResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateAssessmentDto) { return this.service.create(u, dto); }
  @Patch(':id') @Roles('TEACHER') @Respond(AssessmentAuthorResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssessmentDto) { return this.service.update(u, id, dto); }
  @Put(':id/questions') @Roles('TEACHER') @Respond(AssessmentAuthorResponse) questions(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceAssessmentQuestionsDto) { return this.service.replaceQuestions(u, id, dto); }
  @Post(':id/publish') @HttpCode(200) @Roles('TEACHER') @Respond(AssessmentAuthorResponse) publish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.publish(u, id); }
  @Post(':id/unpublish') @HttpCode(200) @Roles('TEACHER') @Respond(AssessmentAuthorResponse) unpublish(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(u, id, 'unpublish'); }
  @Post(':id/close') @HttpCode(200) @Roles('TEACHER') @Respond(AssessmentAuthorResponse) close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(u, id, 'close'); }
  @Post(':id/start-grading') @HttpCode(200) @Roles('TEACHER') @Respond(AssessmentAuthorResponse) startGrading(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(u, id, 'start-grading'); }
  @Post(':id/release') @HttpCode(200) @Roles('TEACHER') @Respond(AssessmentAuthorResponse) release(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(u, id, 'release'); }
  @Post(':id/archive') @HttpCode(200) @Roles('TEACHER') @Respond(AssessmentAuthorResponse) archive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.transition(u, id, 'archive'); }
  @Get(':id/submissions') @Roles('TEACHER', 'SCHOOL_ADMIN') @Respond(SubmissionResponse, true) submissions(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: SubmissionListDto) { return this.service.submissions(u, id, q); }
  @Get(':id/submission') @Roles('STUDENT') @Respond(SubmissionResponse) own(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.ownSubmission(u, id); }
  @Put(':id/submission') @Roles('STUDENT') @Respond(SubmissionResponse) save(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAnswersDto) { return this.service.save(u, id, dto, false); }
  @Post(':id/submit') @HttpCode(200) @Roles('STUDENT') @Respond(SubmissionResponse) submit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAnswersDto) { return this.service.save(u, id, dto, true); }
}

@ApiTags('submissions') @ApiBearerAuth() @Controller('submissions')
export class SubmissionsController {
  constructor(private service: AssessmentService) {}
  @Get(':id') @Roles('TEACHER', 'SCHOOL_ADMIN', 'STUDENT') @Respond(SubmissionResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.submission(u, id); }
  @Post(':id/grade') @HttpCode(200) @Roles('TEACHER') @Respond(SubmissionResponse) grade(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GradeSubmissionDto) { return this.service.grade(u, id, dto); }
}

@ApiTags('student and parent results') @ApiBearerAuth() @Controller()
export class ResultsController {
  constructor(private service: AssessmentService) {}
  @Get('me/tasks') @Roles('STUDENT') @Respond(AssessmentResponse, true) tasks(@CurrentUser() u: AuthUser, @Query() q: AssessmentListDto) { return this.service.list(u, q); }
  @Get('me/grades') @Roles('STUDENT') @Respond(ReleasedResultResponse, true) grades(@CurrentUser() u: AuthUser, @Query() q: ListDto) { return this.service.myResults(u, q); }
  @Get('parent/children/:id/grades') @Roles('PARENT') @Respond(ReleasedResultResponse, true) childGrades(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ParentResultQueryDto) { return this.service.childResults(u, id, q, q.schoolId); }
}
