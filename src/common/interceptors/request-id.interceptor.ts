import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const headerRequestId = request.headers['x-request-id'];
    const candidate = Array.isArray(headerRequestId)
      ? headerRequestId[0]
      : headerRequestId;
    const requestId =
      candidate && /^[A-Za-z0-9._-]{1,128}$/.test(candidate)
        ? candidate
        : randomUUID();

    (request as any).requestId = requestId;
    if (response.setHeader) {
      response.setHeader('x-request-id', requestId);
    }

    return next.handle();
  }
}
