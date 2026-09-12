import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AppError } from '../errors/app.error';
import { ErrorCode } from '../constants/error-codes';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_SERVER_ERROR;
    let message = 'Đã xảy ra lỗi máy chủ';
    let details: any = null;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.customMessage || exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        if (
          resObj.error &&
          typeof resObj.error === 'object' &&
          resObj.error.code
        ) {
          code = resObj.error.code;
          message = resObj.error.message || exception.message;
          details = resObj.error.details || null;
        } else {
          message = resObj.message || exception.message;
          if (Array.isArray(message)) {
            details = message;
            message = 'Dữ liệu không hợp lệ';
            code = ErrorCode.VALIDATION_ERROR;
          } else {
            code = this.mapStatusToErrorCode(status);
          }
        }
      } else {
        message = exception.message;
        code = this.mapStatusToErrorCode(status);
      }
    } else {
      // Unhandled/Unknown Exception
      this.logger.error(
        JSON.stringify({
          event: 'UNHANDLED_EXCEPTION',
          requestId: (request as Request & { requestId?: string }).requestId,
          method: request?.method,
          path: request?.path,
          errorType:
            exception instanceof Error ? exception.name : 'UnknownError',
        }),
      );
    }

    // Never leak stack trace or internal error messages on 500
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      message = 'Đã xảy ra lỗi máy chủ';
      code = ErrorCode.INTERNAL_SERVER_ERROR;
      details = null;
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        details,
      },
    });
  }

  private mapStatusToErrorCode(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.ACCESS_DENIED;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.RESOURCE_NOT_FOUND;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMIT_EXCEEDED;
      default:
        return ErrorCode.INTERNAL_SERVER_ERROR;
    }
  }
}
