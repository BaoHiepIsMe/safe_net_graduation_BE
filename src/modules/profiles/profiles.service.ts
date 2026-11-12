import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository';
import {
  UpdateProfileDto,
  UpdateUserSettingsDto,
  UpdateBiometricSettingsDto,
} from './dto/profile.dto';
import { NotFoundError } from '../../common/errors/app.error';
import { ErrorCode } from '../../common/constants/error-codes';

@Injectable()
export class ProfilesService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  async getProfile(userId: string) {
    const profile = await this.profilesRepository.findProfileById(userId);
    if (!profile) {
      throw new NotFoundError(
        'Không tìm thấy thông tin người dùng',
        ErrorCode.USER_NOT_FOUND,
      );
    }

    return this.mapProfile(profile);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.profilesRepository.findProfileById(userId);
    if (!profile) {
      throw new NotFoundError(
        'Không tìm thấy thông tin người dùng',
        ErrorCode.USER_NOT_FOUND,
      );
    }

    const updated = await this.profilesRepository.updateProfile(userId, dto);
    return this.mapProfile(updated);
  }

  async getUserSettings(userId: string) {
    const settings = await this.profilesRepository.findSettingsByUserId(userId);
    if (!settings) {
      throw new NotFoundError(
        'Không tìm thấy cài đặt người dùng',
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    return this.mapUserSettings(settings);
  }

  async updateUserSettings(userId: string, dto: UpdateUserSettingsDto) {
    const updated = await this.profilesRepository.updateSettings(userId, dto);
    return this.mapUserSettings(updated);
  }

  async getBiometricSettings(userId: string) {
    const settings =
      await this.profilesRepository.findBiometricSettingsByUserId(userId);
    if (!settings) {
      throw new NotFoundError(
        'Không tìm thấy cài đặt sinh trắc học',
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }
    return {
      userId: settings.userId,
      biometricEnabled: settings.biometricEnabled,
      biometricType: settings.biometricType,
      updatedAt: settings.updatedAt,
    };
  }

  async updateBiometricSettings(
    userId: string,
    dto: UpdateBiometricSettingsDto,
  ) {
    const updated = await this.profilesRepository.updateBiometricSettings(
      userId,
      dto,
    );
    return {
      userId: updated.userId,
      biometricEnabled: updated.biometricEnabled,
      biometricType: updated.biometricType,
      updatedAt: updated.updatedAt,
    };
  }

  private mapProfile(profile: any) {
    return {
      id: profile.id,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
      dateOfBirth: profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      gender: profile.gender,
      role: profile.role ?? null,
      phoneNumber: profile.phoneNumber,
      accountStatus: profile.accountStatus,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private formatTime(value: Date | null | undefined) {
    return value ? value.toISOString().slice(11, 16) : null;
  }

  private mapUserSettings(settings: any) {
    const theme = settings.theme ?? 'system';
    return {
      userId: settings.userId,
      language: settings.language,
      pushNotificationsEnabled: settings.pushNotificationsEnabled,
      smsNotificationsEnabled: settings.smsNotificationsEnabled,
      emailNotificationsEnabled: settings.emailNotificationsEnabled,
      locationSharingEnabled: settings.locationSharingEnabled,
      theme,
      darkMode: theme === 'dark',
      quietHoursStart: this.formatTime(settings.quietHoursStart),
      quietHoursEnd: this.formatTime(settings.quietHoursEnd),
      updatedAt: settings.updatedAt,
    };
  }
}
