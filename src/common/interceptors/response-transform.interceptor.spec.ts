import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseTransformInterceptor } from './response-transform.interceptor';

describe('ResponseTransformInterceptor', () => {
  let interceptor: ResponseTransformInterceptor<any>;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    interceptor = new ResponseTransformInterceptor();
    mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
  });

  it('should wrap raw data into standard success format', (done) => {
    const rawData = { id: '123', name: 'SafeNet' };
    const mockCallHandler: CallHandler = {
      handle: () => of(rawData),
    };

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result).toEqual({
        success: true,
        message: 'Thành công',
        data: rawData,
      });
      done();
    });
  });

  it('should pass through already formatted responses', (done) => {
    const alreadyFormatted = {
      success: true,
      data: [{ id: '1' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    const mockCallHandler: CallHandler = {
      handle: () => of(alreadyFormatted),
    };

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result).toEqual(alreadyFormatted);
      done();
    });
  });

  it('keeps list data at the envelope root with non-pagination metadata', (done) => {
    const mockCallHandler: CallHandler = {
      handle: () =>
        of({
          data: [{ id: '1' }],
          horizonEndsAt: '2026-09-03T00:00:00.000Z',
        }),
    };

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result).toEqual({
        success: true,
        message: 'Thành công',
        data: [{ id: '1' }],
        horizonEndsAt: '2026-09-03T00:00:00.000Z',
      });
      expect(result?.data).not.toHaveProperty('data');
      done();
    });
  });

  it('returns no body for a 204 response', (done) => {
    mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: () => ({ statusCode: 204 }),
      }),
    } as unknown as ExecutionContext;
    const mockCallHandler: CallHandler = { handle: () => of(undefined) };

    interceptor.intercept(mockContext, mockCallHandler).subscribe((result) => {
      expect(result).toBeUndefined();
      done();
    });
  });
});
