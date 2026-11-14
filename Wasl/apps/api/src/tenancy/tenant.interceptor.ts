import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthUser } from '../auth/auth.types';
import { runWithTenant } from './tenant-context';

/**
 * Runs each request handler inside the tenant context taken from the
 * validated JWT for request-local context. Repository units of work explicitly
 * set transaction-local SQL settings; this interceptor is not an authorization boundary.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    const ctx = {
      userId: user?.sub ?? null,
      schoolId: user?.schoolId ?? null,
      bypass: false, // Privileged repository operations opt in internally, never by request role alone.
    };
    return new Observable((subscriber) =>
      runWithTenant(ctx, () => next.handle().subscribe(subscriber)),
    );
  }
}
