import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { AdminAlertService } from '../../admin/admin-alert.service';

/**
 * Normalizes every error into a consistent JSON envelope and maps common
 * Prisma errors to proper HTTP semantics so internals never leak to clients.
 * Rate-limited staff alerts fire for 5xx responses.
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly adminAlertService: AdminAlertService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';
    let code: string | undefined;
    let hints: string[] | undefined;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? exception.message;
        error = (b.error as string) ?? exception.name;
        if (typeof b.code === 'string') code = b.code;
        if (Array.isArray(b.hints) && b.hints.every((h) => typeof h === 'string')) {
          hints = b.hints as string[];
        }
        if ('details' in b) details = b.details;
      }
      error = error === 'InternalServerError' ? exception.name : error;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'A record with this value already exists';
          error = 'Conflict';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Resource not found';
          error = 'NotFound';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'Related resource does not exist';
          error = 'BadRequest';
          break;
        default:
          this.logger.error(`Prisma error ${exception.code}: ${exception.message}`);
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    } else {
      this.logger.error(`Unknown exception: ${String(exception)}`);
    }

    if (status >= 500) {
      const text = Array.isArray(message) ? message.join('; ') : message;
      void this.adminAlertService.notifySystemError({
        statusCode: status,
        path: request.originalUrl || request.url,
        method: request.method,
        message: text,
        error,
      });
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      ...(code ? { code } : {}),
      ...(hints && hints.length ? { hints } : {}),
      ...(details !== undefined ? { details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
