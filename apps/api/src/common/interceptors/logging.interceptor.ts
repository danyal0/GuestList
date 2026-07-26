import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Structured request logging with latency, useful for p95 monitoring. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          if (ms > 500) {
            this.logger.warn(`${method} ${url} slow response ${ms}ms`);
          } else if (process.env.NODE_ENV === 'development') {
            this.logger.log(`${method} ${url} ${ms}ms`);
          }
        },
      }),
    );
  }
}
