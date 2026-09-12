import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';

export class AppError extends HttpException {
  public readonly code: ErrorCode;
  public readonly details: any;
  public readonly customMessage: string;

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details: any = null,
  ) {
    super({ success: false, error: { code, message, details } }, status);
    this.code = code;
    this.customMessage = message;
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Yêu cầu xác thực', code = ErrorCode.UNAUTHORIZED) {
    super(code, message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'Không có quyền truy cập',
    code = ErrorCode.ACCESS_DENIED,
  ) {
    super(code, message, HttpStatus.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  constructor(
    message = 'Không tìm thấy tài nguyên',
    code = ErrorCode.RESOURCE_NOT_FOUND,
  ) {
    super(code, message, HttpStatus.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'Xung đột dữ liệu',
    code = ErrorCode.IDEMPOTENCY_CONFLICT,
  ) {
    super(code, message, HttpStatus.CONFLICT);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Dịch vụ tạm thời chưa sẵn sàng') {
    super(
      ErrorCode.DEPENDENCY_UNAVAILABLE,
      message,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class ValidationError extends AppError {
  constructor(details: any, message = 'Dữ liệu không hợp lệ') {
    super(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class BusinessRuleError extends AppError {
  constructor(code: ErrorCode, message: string, details: any = null) {
    super(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
}
