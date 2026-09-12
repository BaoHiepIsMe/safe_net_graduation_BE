import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const { method, path } = request;
    const requestId = (request as any).requestId || '-';
    const userId = (request as any).user?.id || 'anonymous';
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startTime;
          const statusCode = response.statusCode;
          this.logger.log(
            JSON.stringify({
              level: 'info',
              requestId,
              userId,
              method,
              path,
              statusCode,
              durationMs,
            }),
          );
        },
        error: (error) => {
          const durationMs = Date.now() - startTime;
          const statusCode = error.status || 500;
          this.logger.warn(
            JSON.stringify({
              level: 'warn',
              requestId,
              userId,
              method,
              path,
              statusCode,
              durationMs,
              errorCode: error.code || 'UNKNOWN_ERROR',
            }),
          );
        },
      }),
    );
  }
}
