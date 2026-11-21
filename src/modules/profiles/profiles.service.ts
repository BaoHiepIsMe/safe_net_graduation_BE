import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository';
import {
  UpdateProfileDto,
  UpdateUserSettingsDto,
  UpdateBiometricSettingsDto,
} from './dto/profile.dto';
import { ForbiddenError, NotFoundError } from '../../common/errors/app.error';
import { ErrorCode } from '../../common/constants/error-codes';
import { isUnder13 } from '../../common/utils/age.util';

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

    const effectiveDob =
      dto.dateOfBirth !== undefined
        ? dto.dateOfBirth === null
          ? null
          : new Date(`${dto.dateOfBirth}T00:00:00.000Z`)
        : profile.dateOfBirth;

    if (
      dto.uiMode !== undefined &&
      dto.uiMode !== 'kid' &&
      isUnder13(effectiveDob)
    ) {
      throw new ForbiddenError(
        'Người dưới 13 tuổi chỉ dùng giao diện trẻ em',
        ErrorCode.UI_MODE_CHANGE_DENIED,
      );
    }
    if (dto.uiMode === 'kid' && !isUnder13(effectiveDob)) {
      throw new ForbiddenError(
        'Giao diện trẻ em chỉ dành cho người dưới 13 tuổi',
        ErrorCode.UI_MODE_CHANGE_DENIED,
      );
    }

    const writeDto: UpdateProfileDto = {
      ...dto,
      ...(dto.dateOfBirth !== undefined && isUnder13(effectiveDob)
        ? { uiMode: 'kid' }
        : {}),
    };

    const updated = await this.profilesRepository.updateProfile(
      userId,
      writeDto,
    );
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
    if (
      dto.locationSharingEnabled === false &&
      (await this.profilesRepository.hasActiveCareRecipientMembership(userId))
    ) {
      throw new ForbiddenError(
        'Người được chăm sóc không thể tự tắt chia sẻ vị trí',
        ErrorCode.CARE_RECIPIENT_CANNOT_DISABLE_LOCATION_SHARING,
      );
    }
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
      uiMode: profile.uiMode ?? 'adult',
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
      sharingMode: settings.sharingMode,
      locationVisibility: settings.locationVisibility,
      notifyOnZoneExit: settings.notifyOnZoneExit,
      notifyOnSignalLost: settings.notifyOnSignalLost,
      theme,
      darkMode: theme === 'dark',
      quietHoursStart: this.formatTime(settings.quietHoursStart),
      quietHoursEnd: this.formatTime(settings.quietHoursEnd),
      updatedAt: settings.updatedAt,
    };
  }
}
