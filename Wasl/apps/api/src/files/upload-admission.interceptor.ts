import { BadRequestException, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException, ServiceUnavailableException, type CallHandler } from '@nestjs/common';
import type { Request, Response } from 'express';
import { defer, finalize } from 'rxjs';
import type { AuthUser } from '../auth/auth.types';
import { MAX_FILE_BYTES } from './object-store';

const MAX_UPLOADS = 4;
const MAX_SCHOOL_UPLOADS = 2;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;
const RECEIVE_TIMEOUT_MS = 60_000;

/** Holds a slot from before multipart parsing until the object and metadata work finishes. */
@Injectable()
export class UploadAdmissionInterceptor implements NestInterceptor {
  private active = 0;
  private readonly schools = new Map<string, number>();

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user: AuthUser }>();
    const response = http.getResponse<Response>();
    return defer(() => {
      if (request.destroyed && !request.complete) throw new BadRequestException('Upload disconnected');
      if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES)
        throw new PayloadTooLargeException('Upload exceeds the request size limit');

      const school = request.user.schoolId;
      if (!school) throw new BadRequestException('An active school is required');
      const schoolActive = this.schools.get(school) ?? 0;
      if (this.active >= MAX_UPLOADS || schoolActive >= MAX_SCHOOL_UPLOADS) {
        response.set('Retry-After', '1');
        throw new ServiceUnavailableException('Uploads are busy. Try again later.');
      }
      this.active++;
      this.schools.set(school, schoolActive + 1);
      const deadline = setTimeout(() => {
        if (!request.complete) request.destroy();
      }, RECEIVE_TIMEOUT_MS);
      deadline.unref();
      return defer(() => next.handle()).pipe(finalize(() => {
        clearTimeout(deadline);
        this.active--;
        const remaining = (this.schools.get(school) ?? 1) - 1;
        if (remaining) this.schools.set(school, remaining);
        else this.schools.delete(school);
      }));
    });
  }
}
