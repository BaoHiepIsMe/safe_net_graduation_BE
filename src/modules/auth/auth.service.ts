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
    // Public signUp accepts either email or phone. Admin creation stores both
    // on one Auth identity and runs the profile trigger in that transaction.
    const { data, error } = await this.supabaseService
      .getAdminAuthClient()
      .auth.admin.createUser({
        email: dto.email,
        phone: dto.phoneNumber,
        password: dto.password,
        email_confirm: false,
        phone_confirm: false,
        user_metadata: {
          full_name: dto.fullName,
          phone_number: dto.phoneNumber,
          gender: dto.gender,
          date_of_birth: dto.dateOfBirth,
        },
      });

    if (error) {
      if (this.isDuplicateAccountError(error.code, error.message)) {
        throw new ConflictError(
          'Email hoặc số điện thoại đã được sử dụng',
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

    // The account is committed. A mail delivery failure must not pretend that
    // account creation failed; clients can retry via resend-confirmation.
    const confirmationEmailSent = await this.sendConfirmationEmail(dto.email);

    return {
      user: {
        id: data.user.id,
        email: data.user.email,
        phoneNumber: dto.phoneNumber,
        fullName: dto.fullName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth,
      },
      session: null,
      requiresEmailConfirmation: true,
      confirmationEmailSent,
    };
  }

  async resendConfirmation(dto: ForgotPasswordDto) {
    await this.sendConfirmationEmail(dto.email);
    return {
      message:
        'Nếu tài khoản đang chờ xác nhận, email hướng dẫn xác nhận đã được yêu cầu gửi.',
    };
  }

  private async sendConfirmationEmail(email: string): Promise<boolean> {
    try {
      const { error } = await this.supabaseService.getAuthClient().auth.resend({
        type: 'signup',
        email,
      });
      if (!error) return true;
    } catch {
      // Do not expose provider details or email addresses in logs.
    }
    this.logger.warn('Signup confirmation email could not be sent');
    return false;
  }

  async login(dto: LoginDto) {
    const authClient = this.supabaseService.getAuthClient();
    let email: string;
    let expectedUserId: string | undefined;
    if ('email' in dto) {
      email = dto.email;
    } else {
      const account = await this.resolvePhoneAccount(dto.phoneNumber);
      email = account.email;
      expectedUserId = account.id;
    }

    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password: dto.password,
    });

    if (
      error ||
      !data.session ||
      !data.user ||
      ('phoneNumber' in dto &&
        (data.user.id !== expectedUserId ||
          data.user.phone?.replace(/^\+/, '') !== dto.phoneNumber.slice(1)))
    ) {
      this.invalidCredentials();
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

  private async resolvePhoneAccount(phoneNumber: string) {
    const profile =
      await this.profilesRepository.findProfileByPhoneNumber(phoneNumber);
    if (!profile) this.invalidCredentials();

    // Phone is an account identifier while SMS verification is unavailable.
    // Auth remains authoritative for its binding, password and email status.
    const { data, error } = await this.supabaseService
      .getAdminAuthClient()
      .auth.admin.getUserById(profile.id);
    if (
      error ||
      !data.user?.email ||
      data.user.id !== profile.id ||
      data.user.phone?.replace(/^\+/, '') !== phoneNumber.slice(1)
    ) {
      this.invalidCredentials();
    }
    return { id: data.user.id, email: data.user.email };
  }

  private invalidCredentials(): never {
    this.logger.warn('Failed login attempt');
    throw new UnauthorizedError(
      'Email, số điện thoại hoặc mật khẩu không chính xác',
      ErrorCode.INVALID_CREDENTIALS,
    );
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
