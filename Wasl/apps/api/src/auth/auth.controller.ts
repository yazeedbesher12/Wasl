import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from './auth.types';
import { LoginDto, RefreshDto, SwitchSchoolDto } from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('switch-school')
  @HttpCode(200)
  switchSchool(@CurrentUser() user: AuthUser, @Body() dto: SwitchSchoolDto) {
    return this.auth.switchSchool(user, dto.schoolId ?? null, dto.role);
  }
}
