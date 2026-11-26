import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthRateLimit } from './auth-rate-limit';
import { AuthUser } from './auth.types';
import { LoginDto, RefreshDto, SwitchSchoolDto } from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './decorators';
import { LoginResponseModel, Respond, TokensResponse } from '../foundation/responses';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private limits: AuthRateLimit) {}

  @Public()
  @Post('login')
  @Respond(LoginResponseModel)
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limits.check('login', request, response, dto.email.trim().toLowerCase());
    return this.limits.login(response, () => this.auth.login(dto.email, dto.password));
  }

  @Public()
  @Post('refresh')
  @Respond(TokensResponse)
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limits.check('refresh', request, response);
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limits.check('logout', request, response);
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('switch-school')
  @Respond(TokensResponse)
  @HttpCode(200)
  switchSchool(@CurrentUser() user: AuthUser, @Body() dto: SwitchSchoolDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.limits.check('switch-school', request, response, user.sub);
    return this.auth.switchSchool(user, dto.schoolId ?? null, dto.role);
  }
}
