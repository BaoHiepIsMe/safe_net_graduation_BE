import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { AppError } from '../errors/app.error';
import { ErrorCode } from '../constants/error-codes';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: any;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockArgumentsHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => mockResponse,
        getRequest: () => ({ method: 'GET', url: '/api/v1/test' }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('should format AppError correctly', () => {
    const error = new AppError(
      ErrorCode.USER_NOT_FOUND,
      'User not found',
      HttpStatus.NOT_FOUND,
    );

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User not found',
        details: null,
      },
    });
  });

  it('should mask internal server errors with safe message', () => {
    const error = new Error('Secret DB connection failed');

    filter.catch(error, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Đã xảy ra lỗi máy chủ',
        details: null,
      },
    });
  });
});
