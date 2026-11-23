import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ChildQueryDto } from './dto';
import { Respond } from './responses';
import { AssessmentDetailResponse } from './assessment.responses';
import { ParentLearningService } from './parent-learning.service';
@ApiTags('parent learning')
@ApiBearerAuth()
@Roles('PARENT')
@Controller('parent/children')
export class ParentLearningController {
  constructor(private service: ParentLearningService) {}
  @Get(':id/learning')
  @ApiOkResponse({
    description:
      'Published lessons/resources/announcements and non-draft assessment summaries for the verified child.',
  })
  bundle(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ChildQueryDto,
  ) {
    return this.service.bundle(u, id, q.schoolId);
  }
  @Get(':id/assessments/:assessmentId')
  @Respond(AssessmentDetailResponse)
  assessment(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assessmentId', ParseUUIDPipe) assessmentId: string,
    @Query() q: ChildQueryDto,
  ) {
    return this.service.assessment(u, id, assessmentId, q.schoolId);
  }
}
