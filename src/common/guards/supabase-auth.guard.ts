import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UnauthorizedError } from '../errors/app.error';
import { ErrorCode } from '../constants/error-codes';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabaseService: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError(
        'Yêu cầu xác thực tài khoản (Bearer token)',
        ErrorCode.UNAUTHORIZED,
      );
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new UnauthorizedError('Token không hợp lệ', ErrorCode.UNAUTHORIZED);
    }

    const user = await this.supabaseService.verifyToken(token);
    if (!user) {
      throw new UnauthorizedError(
        'Token không hợp lệ hoặc đã hết hạn',
        ErrorCode.TOKEN_EXPIRED,
      );
    }

    request.user = user;
    request.authToken = token;
    return true;
  }
}
