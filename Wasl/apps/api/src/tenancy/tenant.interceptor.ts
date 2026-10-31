import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthUser } from '../auth/auth.types';
import { runWithTenant } from './tenant-context';

/**
 * Runs each request handler inside the tenant context taken from the
 * verified JWT, so the Prisma extension can apply row-level security.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    const ctx = {
      userId: user?.sub ?? null,
      schoolId: user?.schoolId ?? null,
      bypass: user?.role === 'PLATFORM_ADMIN',
    };
    return new Observable((subscriber) =>
      runWithTenant(ctx, () => next.handle().subscribe(subscriber)),
    );
  }
}
