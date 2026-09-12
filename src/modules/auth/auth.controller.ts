import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  type ForgotPasswordDto,
  forgotPasswordSchema,
  type LoginDto,
  loginSchema,
  type RefreshTokenDto,
  refreshTokenSchema,
  type RegisterDto,
  registerSchema,
  type ResetPasswordDto,
  resetPasswordSchema,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { CurrentAccessToken } from '../../common/decorators/current-access-token.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ApiStandardErrors,
  authUserSchema,
  loginSuccessDataSchema,
  messageDataSchema,
  refreshSuccessDataSchema,
  registerSuccessDataSchema,
  successSchema,
} from '../../common/swagger/api-docs';
import { UnauthorizedError } from '../../common/errors/app.error';

const emailPasswordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: {
      type: 'string',
      format: 'password',
      minLength: 8,
      maxLength: 128,
    },
  },
};

@ApiTags('Auth & Profiles')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Đăng ký tài khoản Supabase Auth' })
  @ApiBody({
    schema: {
      ...emailPasswordSchema,
      required: ['email', 'password', 'fullName'],
      properties: {
        ...emailPasswordSchema.properties,
        fullName: { type: 'string', minLength: 2, maxLength: 100 },
        phoneNumber: { type: 'string', pattern: '^\\+?[1-9]\\d{7,14}$' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    schema: successSchema(registerSuccessDataSchema),
  })
  @ApiStandardErrors(400, 409, 429, 500)
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bằng Supabase Auth' })
  @ApiBody({ schema: emailPasswordSchema })
  @ApiResponse({ status: 200, schema: successSchema(loginSuccessDataSchema) })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Làm mới Supabase session' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['refreshToken'],
      properties: { refreshToken: { type: 'string', maxLength: 4096 } },
    },
  })
  @ApiResponse({ status: 200, schema: successSchema(refreshSuccessDataSchema) })
  @ApiStandardErrors(400, 401, 429, 500)
  refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) dto: RefreshTokenDto,
  ) {
    return this.authService.refreshSession(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Yêu cầu email khôi phục mật khẩu' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['email'],
      properties: { email: { type: 'string', format: 'email' } },
    },
  })
  @ApiResponse({ status: 200, schema: successSchema(messageDataSchema) })
  @ApiStandardErrors(400, 429, 500)
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordDto,
  ) {
    return this.authService.forgotPassword(dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đổi mật khẩu của user đã xác thực' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['password'],
      properties: {
        password: { type: 'string', minLength: 8, maxLength: 128 },
      },
    },
  })
  @ApiResponse({ status: 200, schema: successSchema(messageDataSchema) })
  @ApiStandardErrors(400, 401, 429, 500)
  resetPassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto,
  ) {
    return this.authService.resetPassword(user.id, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Thu hồi Supabase session hiện tại' })
  @ApiResponse({
    status: 204,
    description: 'Đã đăng xuất, không có response body',
  })
  @ApiStandardErrors(401, 429, 500)
  async logout(@CurrentAccessToken() accessToken?: string): Promise<void> {
    if (!accessToken) throw new UnauthorizedError();
    await this.authService.logout(accessToken);
  }

  @ApiBearerAuth('JWT-auth')
  @Get('me')
  @ApiOperation({ summary: 'Thông tin auth user hiện tại' })
  @ApiResponse({ status: 200, schema: successSchema(authUserSchema) })
  @ApiStandardErrors(401, 429, 500)
  getMe(@CurrentUser() user: AuthUser) {
    return { id: user.id, email: user.email, phone: user.phone };
  }
}
