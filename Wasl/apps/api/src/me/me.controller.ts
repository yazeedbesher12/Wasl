import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { MeResponse, Respond } from '../foundation/responses';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private auth: AuthService) {}

  @Get()
  @Respond(MeResponse)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
