import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Email } from '../foundation/dto';
import { ROLES, type Role } from '@wasl/shared';

export class LoginDto {
  @ApiProperty({ example: 'admin1@wasl.test' })
  @IsEmail()
  @Email()
  @MaxLength(254)
  email: string;

  @ApiProperty({ writeOnly: true, description: 'Use the password configured locally in WASL_DEV_PASSWORD for memory accounts.' })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
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
