import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  UpdateBiometricSettingsDto,
  UpdateProfileDto,
  UpdateUserSettingsDto,
} from './dto/profile.dto';

const profileSelect = {
  id: true,
  fullName: true,
  avatarUrl: true,
  dateOfBirth: true,
  gender: true,
  role: true,
  phoneNumber: true,
  accountStatus: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findProfileById(userId: string) {
    return this.prisma.profile.findUnique({
      where: { id: userId },
      select: profileSelect,
    });
  }

  findProfileByPhoneNumber(phoneNumber: string) {
    return this.prisma.profile.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.profile.update({
      where: { id: userId },
      data: {
        fullName: dto.fullName,
        avatarUrl: dto.avatarUrl,
        dateOfBirth:
          dto.dateOfBirth === undefined || dto.dateOfBirth === null
            ? dto.dateOfBirth
            : new Date(`${dto.dateOfBirth}T00:00:00.000Z`),
        gender: dto.gender,
      },
      select: profileSelect,
    });
  }

  findSettingsByUserId(userId: string) {
    return this.prisma.userSetting.findUnique({ where: { userId } });
  }

  updateSettings(userId: string, dto: UpdateUserSettingsDto) {
    // theme is the source of truth; darkMode is derived from it (design D1).
    const theme =
      dto.theme ??
      (dto.darkMode === undefined
        ? undefined
        : dto.darkMode
          ? 'dark'
          : 'light');
    const data = {
      language: dto.language,
      pushNotificationsEnabled: dto.pushNotificationsEnabled,
      smsNotificationsEnabled: dto.smsNotificationsEnabled,
      emailNotificationsEnabled: dto.emailNotificationsEnabled,
      locationSharingEnabled: dto.locationSharingEnabled,
      theme,
      darkMode: theme === undefined ? undefined : theme === 'dark',
      quietHoursStart: this.toDatabaseTime(dto.quietHoursStart),
      quietHoursEnd: this.toDatabaseTime(dto.quietHoursEnd),
    };

    return this.prisma.userSetting.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  findBiometricSettingsByUserId(userId: string) {
    return this.prisma.biometricSetting.findUnique({ where: { userId } });
  }

  updateBiometricSettings(userId: string, dto: UpdateBiometricSettingsDto) {
    const data = {
      biometricEnabled: dto.biometricEnabled,
      biometricType: dto.biometricEnabled ? dto.biometricType : 'none',
    };

    return this.prisma.biometricSetting.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  private toDatabaseTime(value: string | null | undefined) {
    if (value === undefined || value === null) return value;
    const normalized = value.length === 5 ? `${value}:00` : value;
    return new Date(`1970-01-01T${normalized}.000Z`);
  }
}
