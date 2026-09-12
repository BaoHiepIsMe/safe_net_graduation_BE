import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import {
  UnauthorizedError,
  ConflictError,
  AppError,
  ForbiddenError,
} from '../../common/errors/app.error';
import { ErrorCode } from '../../common/constants/error-codes';
import { HttpStatus } from '@nestjs/common';
import { ProfilesRepository } from '../profiles/profiles.repository';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly profilesRepository: ProfilesRepository,
  ) {}

  async register(dto: RegisterDto) {
    const client = this.supabaseService.getAuthClient();

    const { data, error } = await client.auth.signUp({
      email: dto.email,
      password: dto.password,
      options: {
        data: {
          full_name: dto.fullName,
          phone_number: dto.phoneNumber,
        },
      },
    });

    const duplicateWithoutError = data.user?.identities?.length === 0;
    if (error || duplicateWithoutError) {
      if (
        duplicateWithoutError ||
        this.isDuplicateAccountError(error?.code, error?.message)
      ) {
        throw new ConflictError(
          'Tài khoản đã tồn tại',
          ErrorCode.USER_ALREADY_EXISTS,
        );
      }
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Không thể đăng ký tài khoản lúc này',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (!data.user) {
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Không thể đăng ký tài khoản lúc này',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: dto.fullName,
      },
      session: data.session
        ? {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresIn: data.session.expires_in,
            tokenType: data.session.token_type,
          }
        : null,
    };
  }

  async login(dto: LoginDto) {
    const authClient = this.supabaseService.getAuthClient();

    const { data, error } = await authClient.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session || !data.user) {
      this.logger.warn('Failed login attempt');
      throw new UnauthorizedError(
        'Email hoặc mật khẩu không chính xác',
        ErrorCode.INVALID_CREDENTIALS,
      );
    }

    const profile = await this.profilesRepository.findProfileById(data.user.id);
    if (!profile) {
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Không thể tải trạng thái tài khoản',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    if (profile.accountStatus !== 'active') {
      throw new ForbiddenError(
        'Tài khoản không được phép đăng nhập',
        ErrorCode.ACCESS_DENIED,
      );
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: profile.fullName || '',
        avatarUrl: profile.avatarUrl || null,
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
        tokenType: data.session.token_type,
      },
    };
  }

  async refreshSession(refreshToken: string) {
    const client = this.supabaseService.getAuthClient();

    const { data, error } = await client.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedError(
        'Refresh token không hợp lệ hoặc đã hết hạn',
        ErrorCode.TOKEN_EXPIRED,
      );
    }

    return {
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresIn: data.session.expires_in,
        tokenType: data.session.token_type,
      },
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const client = this.supabaseService.getAuthClient();

    const { error } = await client.auth.resetPasswordForEmail(dto.email);
    if (error) {
      this.logger.warn(
        'Password-reset request was not accepted by auth provider',
      );
    }

    // Always return success to prevent email enumeration attacks
    return {
      message:
        'Nếu email tồn tại trong hệ thống, hướng dẫn đặt lại mật khẩu đã được gửi.',
    };
  }

  async resetPassword(userId: string, dto: ResetPasswordDto) {
    const client = this.supabaseService.getAdminAuthClient();

    const { error } = await client.auth.admin.updateUserById(userId, {
      password: dto.password,
    });

    if (error) {
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Không thể cập nhật mật khẩu lúc này',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      message: 'Đặt lại mật khẩu thành công.',
    };
  }

  async logout(accessToken: string): Promise<void> {
    const { error } = await this.supabaseService
      .getAdminAuthClient()
      .auth.admin.signOut(accessToken);
    if (error) {
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Không thể đăng xuất lúc này',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private isDuplicateAccountError(code?: string, message?: string): boolean {
    const normalizedCode = code?.toLowerCase() || '';
    const normalizedMessage = message?.toLowerCase() || '';
    return (
      normalizedCode.includes('already') ||
      normalizedCode.includes('exists') ||
      normalizedMessage.includes('already registered') ||
      normalizedMessage.includes('already exists')
    );
  }
}
