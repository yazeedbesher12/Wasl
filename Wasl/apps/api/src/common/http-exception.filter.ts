import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

/** Gives every error the same shape: { code, message, details }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as string | { message?: string | string[]; error?: string };
      const message = typeof body === 'string' ? body : body.message ?? exception.message;
      res.status(status).json({
        code: HttpStatus[status] ?? 'ERROR',
        message: Array.isArray(message) ? 'Validation failed' : message,
        details: Array.isArray(message) ? message : undefined,
      });
      return;
    }
    // Never log raw ORM/auth exceptions: query inputs can contain credential material.
    res.status(500).json({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' });
  }
}
