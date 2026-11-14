import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthUser } from './auth.types';
import { IS_PUBLIC } from './decorators';
import { AuthService } from './auth.service';

/** Global guard: every route needs a valid access token unless @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing access token');
    let claims: AuthUser & { exp?: number };
    try {
      claims = await this.jwt.verifyAsync<AuthUser & { exp?: number }>(header.slice(7));
      if (!Number.isInteger(claims.exp)) throw new UnauthorizedException('Access token requires expiry');
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    // Repository failures must remain storage errors, not be misreported as bad credentials.
    req.user = await this.auth.validateAccess(claims);
    return true;
  }
}
