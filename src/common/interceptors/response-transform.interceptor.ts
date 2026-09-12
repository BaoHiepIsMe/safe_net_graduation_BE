import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../dto/api-response.dto';

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | void
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | void> {
    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      map((resData) => {
        // If 204 No Content, do not return JSON body
        if (
          response.statusCode === 204 ||
          resData === undefined ||
          resData === null
        ) {
          if (response.statusCode === 204) {
            return undefined;
          }
        }

        // If controller already wrapped response with standard contract
        if (
          resData &&
          typeof resData === 'object' &&
          'success' in resData &&
          typeof resData.success === 'boolean'
        ) {
          return resData;
        }

        // Keep service-provided list data at the envelope root, including when
        // the service returns metadata other than pagination.
        if (resData && typeof resData === 'object' && 'data' in resData) {
          return {
            success: true,
            message: resData.message || 'Thành công',
            ...resData,
          };
        }

        return {
          success: true,
          message: 'Thành công',
          data: resData,
        };
      }),
    );
  }
}
