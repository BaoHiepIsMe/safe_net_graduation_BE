import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import {
  type UpdateBiometricSettingsDto,
  updateBiometricSettingsSchema,
  type UpdateProfileDto,
  updateProfileSchema,
  type UpdateUserSettingsDto,
  updateUserSettingsSchema,
} from './dto/profile.dto';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  ApiStandardErrors,
  biometricDataSchema,
  profileDataSchema,
  settingsDataSchema,
  successSchema,
} from '../../common/swagger/api-docs';

@ApiBearerAuth('JWT-auth')
@ApiTags('Auth & Profiles')
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  @Get('me')
  @ApiOperation({ summary: 'Lấy private profile của user hiện tại' })
  @ApiResponse({ status: 200, schema: successSchema(profileDataSchema) })
  @ApiStandardErrors(401, 404, 429, 500)
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.profilesService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Cập nhật private profile của user hiện tại' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        fullName: { type: 'string', minLength: 2, maxLength: 100 },
        avatarUrl: { type: 'string', format: 'uri', nullable: true },
        dateOfBirth: {
          type: 'string',
          format: 'date',
          nullable: true,
        },
        gender: {
          type: 'string',
          enum: ['male', 'female', 'other'],
          nullable: true,
        },
      },
    },
  })
  @ApiResponse({ status: 200, schema: successSchema(profileDataSchema) })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ) {
    return this.profilesService.updateProfile(user.id, dto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Lấy settings của user hiện tại' })
  @ApiResponse({ status: 200, schema: successSchema(settingsDataSchema) })
  @ApiStandardErrors(401, 404, 429, 500)
  getSettings(@CurrentUser() user: AuthUser) {
    return this.profilesService.getUserSettings(user.id);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Cập nhật settings của user hiện tại' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        language: { type: 'string', enum: ['vi', 'en'] },
        pushNotificationsEnabled: { type: 'boolean' },
        smsNotificationsEnabled: { type: 'boolean' },
        emailNotificationsEnabled: { type: 'boolean' },
        locationSharingEnabled: { type: 'boolean' },
        darkMode: { type: 'boolean' },
        theme: { type: 'string', enum: ['light', 'dark', 'system'] },
        quietHoursStart: {
          type: 'string',
          pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$',
          nullable: true,
        },
        quietHoursEnd: {
          type: 'string',
          pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$',
          nullable: true,
        },
      },
    },
  })
  @ApiResponse({ status: 200, schema: successSchema(settingsDataSchema) })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateUserSettingsSchema))
    dto: UpdateUserSettingsDto,
  ) {
    return this.profilesService.updateUserSettings(user.id, dto);
  }

  @Get('biometrics')
  @ApiOperation({ summary: 'Lấy biometric preference của user hiện tại' })
  @ApiResponse({ status: 200, schema: successSchema(biometricDataSchema) })
  @ApiStandardErrors(401, 404, 429, 500)
  getBiometrics(@CurrentUser() user: AuthUser) {
    return this.profilesService.getBiometricSettings(user.id);
  }

  @Patch('biometrics')
  @ApiOperation({ summary: 'Cập nhật biometric preference metadata' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['biometricEnabled'],
      properties: {
        biometricEnabled: { type: 'boolean' },
        biometricType: {
          type: 'string',
          enum: ['fingerprint', 'face', 'iris', 'none'],
        },
      },
    },
  })
  @ApiResponse({ status: 200, schema: successSchema(biometricDataSchema) })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  updateBiometrics(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateBiometricSettingsSchema))
    dto: UpdateBiometricSettingsDto,
  ) {
    return this.profilesService.updateBiometricSettings(user.id, dto);
  }
}
