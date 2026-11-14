import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { FoundationService } from './foundation.service';
import { AcademicListDto, ChildQueryDto, CreateAssignmentDto, CreateEnrollmentDto, CreateGradeDto, CreateLinkDto, CreateMembershipDto, CreateSchoolDto, CreateSectionDto, CreateSemesterDto, CreateSubjectDto, CreateUserDto, CreateYearDto, LinkListDto, LinkStateDto, ListDto, MembershipStateDto, PeopleListDto, ProfileDto, SchoolAdministratorDto, SchoolListDto, UpdateAssignmentDto, UpdateEnrollmentDto, UpdateGradeDto, UpdateSchoolDto, UpdateSectionDto, UpdateSemesterDto, UpdateSubjectDto, UpdateYearDto } from './dto';
import { AssignmentResponse, ChildResponse, ClassResponse, EnrollmentResponse, GradeResponse, LinkResponse, MembershipResponse, OverviewResponse, Respond, RosterResponse, SchoolResponse, SectionResponse, SemesterResponse, SubjectResponse, UserCreatedResponse, UserResponse, YearResponse } from './responses';

@ApiTags('platform schools') @ApiBearerAuth() @Roles('PLATFORM_ADMIN') @Controller('admin/schools')
export class SchoolsController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(SchoolResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: SchoolListDto) { return this.service.listSchools(u,q); }
  @Get(':id') @Respond(SchoolResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getSchool(u,id); }
  @Post() @Respond(SchoolResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateSchoolDto) { return this.service.createSchool(u,dto); }
  @Post(':id/administrator') @HttpCode(200) @Respond(UserCreatedResponse) administrator(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SchoolAdministratorDto) { return this.service.provisionAdministrator(u,id,dto); }
  @Patch(':id') @Respond(SchoolResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSchoolDto) { return this.service.updateSchool(u,id,dto); }
}
@ApiTags('school people') @ApiBearerAuth() @Roles('SCHOOL_ADMIN') @Controller('users')
export class UsersController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(UserResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: PeopleListDto) { return this.service.listUsers(u,q); }
  @Get(':id') @Respond(UserResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getUser(u,id); }
  @Post() @Respond(UserCreatedResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) { return this.service.createUser(u,dto); }
}
@ApiTags('school memberships') @ApiBearerAuth() @Roles('SCHOOL_ADMIN') @Controller('memberships')
export class MembershipsController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(MembershipResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: PeopleListDto) { return this.service.listMemberships(u,q); }
  @Get(':id') @Respond(MembershipResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.membership(u,id); }
  @Post() @Respond(MembershipResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateMembershipDto) { return this.service.addMembership(u,dto); }
  @Patch(':id') @Respond(MembershipResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MembershipStateDto) { return this.service.membership(u,id,dto.active); }
}
@ApiTags('academic years') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('academic-years')
export class YearsController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(YearResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'academicYears',q); }
  @Get(':id') @Respond(YearResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAcademic(u,'academicYears',id); }
  @Post() @Roles('SCHOOL_ADMIN') @Respond(YearResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateYearDto) { return this.service.saveAcademic(u,'academicYears',dto); }
  @Patch(':id') @Roles('SCHOOL_ADMIN') @Respond(YearResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateYearDto) { return this.service.saveAcademic(u,'academicYears',dto,id); }
}
@ApiTags('semesters') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('semesters')
export class SemestersController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(SemesterResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'semesters',q); }
  @Get(':id') @Respond(SemesterResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAcademic(u,'semesters',id); }
  @Post() @Roles('SCHOOL_ADMIN') @Respond(SemesterResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateSemesterDto) { return this.service.saveAcademic(u,'semesters',dto); }
  @Patch(':id') @Roles('SCHOOL_ADMIN') @Respond(SemesterResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSemesterDto) { return this.service.saveAcademic(u,'semesters',dto,id); }
}
@ApiTags('grades') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('grades')
export class GradesController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(GradeResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'grades',q); }
  @Get(':id') @Respond(GradeResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAcademic(u,'grades',id); }
  @Post() @Roles('SCHOOL_ADMIN') @Respond(GradeResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateGradeDto) { return this.service.saveAcademic(u,'grades',dto); }
  @Patch(':id') @Roles('SCHOOL_ADMIN') @Respond(GradeResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGradeDto) { return this.service.saveAcademic(u,'grades',dto,id); }
}
@ApiTags('sections') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('sections')
export class SectionsController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(SectionResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'sections',q); }
  @Get(':id') @Respond(SectionResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAcademic(u,'sections',id); }
  @Post() @Roles('SCHOOL_ADMIN') @Respond(SectionResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateSectionDto) { return this.service.saveAcademic(u,'sections',dto); }
  @Patch(':id') @Roles('SCHOOL_ADMIN') @Respond(SectionResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSectionDto) { return this.service.saveAcademic(u,'sections',dto,id); }
}
@ApiTags('subjects') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('subjects')
export class SubjectsController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(SubjectResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'subjects',q); }
  @Get(':id') @Respond(SubjectResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAcademic(u,'subjects',id); }
  @Post() @Roles('SCHOOL_ADMIN') @Respond(SubjectResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateSubjectDto) { return this.service.saveAcademic(u,'subjects',dto); }
  @Patch(':id') @Roles('SCHOOL_ADMIN') @Respond(SubjectResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubjectDto) { return this.service.saveAcademic(u,'subjects',dto,id); }
}
@ApiTags('teacher assignments') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('section-subjects')
export class AssignmentsController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(AssignmentResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'sectionSubjects',q); }
  @Get(':id') @Respond(AssignmentResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAcademic(u,'sectionSubjects',id); }
  @Get(':id/roster') @Roles('SCHOOL_ADMIN', 'TEACHER') @Respond(RosterResponse, true) roster(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ListDto) { return this.service.roster(u,id,q); }
  @Post() @Roles('SCHOOL_ADMIN') @Respond(AssignmentResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateAssignmentDto) { return this.service.saveAcademic(u,'sectionSubjects',dto); }
  @Patch(':id') @Roles('SCHOOL_ADMIN') @Respond(AssignmentResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAssignmentDto) { return this.service.saveAcademic(u,'sectionSubjects',dto,id); }
}
@ApiTags('enrollments') @ApiBearerAuth() @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT') @Controller('enrollments')
export class EnrollmentsController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(EnrollmentResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'enrollments',q); }
  @Get(':id') @Respond(EnrollmentResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getAcademic(u,'enrollments',id); }
  @Post() @Roles('SCHOOL_ADMIN') @Respond(EnrollmentResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateEnrollmentDto) { return this.service.saveAcademic(u,'enrollments',dto); }
  @Patch(':id') @Roles('SCHOOL_ADMIN') @Respond(EnrollmentResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEnrollmentDto) { return this.service.saveAcademic(u,'enrollments',dto,id); }
}
@ApiTags('parent links') @ApiBearerAuth() @Roles('SCHOOL_ADMIN') @Controller('parent-links')
export class LinksController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(LinkResponse, true) list(@CurrentUser() u: AuthUser, @Query() q: LinkListDto) { return this.service.links(u,q); }
  @Get(':id') @Respond(LinkResponse) get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.getLink(u,id); }
  @Post() @Respond(LinkResponse, false, true) create(@CurrentUser() u: AuthUser, @Body() dto: CreateLinkDto) { return this.service.createLink(u,dto); }
  @Patch(':id') @Respond(LinkResponse) update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkStateDto) { return this.service.linkStatus(u,id,dto.status); }
}
@ApiTags('academic overview') @ApiBearerAuth() @Controller()
export class AcademicViewsController {
  constructor(private service: FoundationService) {}
  @Get('teacher/classes') @Roles('TEACHER') @Respond(ClassResponse, true) teacher(@CurrentUser() u: AuthUser, @Query() q: ListDto) { return this.service.classes(u,q); }
  @Get('teacher/classes/:id/roster') @Roles('TEACHER') @Respond(RosterResponse, true) roster(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ListDto) { return this.service.roster(u,id,q); }
  @Get('me/classes') @Roles('TEACHER', 'STUDENT') @Respond(ClassResponse, true) classes(@CurrentUser() u: AuthUser, @Query() q: ListDto) { return this.service.classes(u,q); }
  @Get('me/subjects') @Roles('TEACHER', 'STUDENT') @Respond(SubjectResponse, true) subjects(@CurrentUser() u: AuthUser, @Query() q: AcademicListDto) { return this.service.listAcademic(u,'subjects',q); }
  @Get('school/academic-overview') @Roles('SCHOOL_ADMIN') @Respond(OverviewResponse) overview(@CurrentUser() u: AuthUser) { return this.service.overview(u); }
  @Patch('me/profile') @Respond(UserResponse) profile(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) { return this.service.updateProfile(u,dto); }
}
@ApiTags('parent academic access') @ApiBearerAuth() @Roles('PARENT') @Controller('parent/children')
export class ParentController {
  constructor(private service: FoundationService) {}
  @Get() @Respond(ChildResponse, true) children(@CurrentUser() u: AuthUser, @Query() q: ListDto) { return this.service.children(u,q); }
  @Get(':id/overview') @Respond(OverviewResponse) overview(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ChildQueryDto) { return this.service.childOverview(u,id,q.schoolId); }
}
export const foundationControllers = [SchoolsController, UsersController, MembershipsController, YearsController, SemestersController, GradesController, SectionsController, SubjectsController, AssignmentsController, EnrollmentsController, LinksController, AcademicViewsController, ParentController];
