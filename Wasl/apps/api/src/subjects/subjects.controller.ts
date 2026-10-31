import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

class SubjectDto {
  @ApiProperty({ example: 'الرياضيات' }) @IsString() @MinLength(1) nameAr: string;
  @ApiProperty({ example: 'Mathematics' }) @IsString() @MinLength(1) nameEn: string;
  @ApiPropertyOptional({ example: 'MATH' }) @IsOptional() @IsString() code?: string;
}

class UpdateSubjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() code?: string;
}

/**
 * Subjects of the active school. There is no school_id in the URL or body:
 * it always comes from the token, and row-level security hides other schools.
 */
@ApiTags('school setup')
@ApiBearerAuth()
@Controller('subjects')
export class SubjectsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT')
  list() {
    return this.prisma.db.subject.findMany({ orderBy: { nameEn: 'asc' } });
  }

  @Get(':id')
  @Roles('SCHOOL_ADMIN', 'TEACHER', 'STUDENT')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const subject = await this.prisma.db.subject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  @Post()
  @Roles('SCHOOL_ADMIN')
  create(@CurrentUser() user: AuthUser, @Body() dto: SubjectDto) {
    if (!user.schoolId) throw new ForbiddenException('No active school');
    return this.prisma.db.subject.create({ data: { ...dto, schoolId: user.schoolId } });
  }

  @Patch(':id')
  @Roles('SCHOOL_ADMIN')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubjectDto) {
    await this.get(id);
    return this.prisma.db.subject.update({ where: { id }, data: dto });
  }

  @Delete(':id')
  @Roles('SCHOOL_ADMIN')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.get(id);
    await this.prisma.db.subject.delete({ where: { id } });
  }
}
