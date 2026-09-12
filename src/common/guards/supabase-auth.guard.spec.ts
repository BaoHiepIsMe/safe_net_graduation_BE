import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { UnauthorizedError } from '../errors/app.error';

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let reflector: Reflector;
  let supabaseService: SupabaseService;

  beforeEach(() => {
    reflector = new Reflector();
    supabaseService = {
      verifyToken: jest.fn(),
    } as unknown as SupabaseService;

    guard = new SupabaseAuthGuard(reflector, supabaseService);
  });

  it('should allow public routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
  });

  it('should throw UnauthorizedError when no token is provided on protected routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(mockContext)).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('should attach user to request and return true on valid token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const mockUser = { id: 'usr-123', email: 'user@safenet.vn' };
    (supabaseService.verifyToken as jest.Mock).mockResolvedValue(mockUser);

    const mockRequest: any = {
      headers: { authorization: 'Bearer valid-token-123' },
    };
    const mockContext = {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(mockContext);
    expect(result).toBe(true);
    expect(mockRequest.user).toEqual(mockUser);
  });
});
