import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * Normalizes every error into a consistent JSON envelope and maps common
 * Prisma errors to proper HTTP semantics so internals never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? exception.message;
        error = (b.error as string) ?? exception.name;
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

    response.status(status).json({
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
