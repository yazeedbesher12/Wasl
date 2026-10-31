import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

class CreateSchoolDto {
  @ApiProperty() @IsString() @MinLength(2) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional({ enum: ['ar', 'en'] }) @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

class UpdateSchoolDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('platform admin')
@ApiBearerAuth()
@Roles('PLATFORM_ADMIN')
@Controller('admin/schools')
export class SchoolsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.db.school.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post()
  create(@Body() dto: CreateSchoolDto) {
    return this.prisma.db.school.create({ data: dto });
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSchoolDto) {
    const exists = await this.prisma.db.school.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('School not found');
    return this.prisma.db.school.update({ where: { id }, data: dto });
  }
}
