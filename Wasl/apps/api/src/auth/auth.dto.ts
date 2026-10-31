import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { ROLES, type Role } from '@wasl/shared';

export class LoginDto {
  @ApiProperty({ example: 'admin@alnour.test' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(8)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class SwitchSchoolDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsUUID()
  schoolId: string | null;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES as unknown as string[])
  role: Role;
}
