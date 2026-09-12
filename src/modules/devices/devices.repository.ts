import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  DeviceHeartbeatDto,
  DevicePaginationDto,
  RegisterDeviceDto,
  UpdateDeviceDto,
} from './dto/device.dto';
import { DEVICE_TRANSACTION_RETRY_LIMIT } from './devices.constants';

export const safeDeviceSelect = {
  id: true,
  deviceName: true,
  platform: true,
  operatingSystem: true,
  batteryLevel: true,
  isActive: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  register(actorUserId: string, dto: RegisterDeviceDto) {
    return this.withTransactionRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.device.findUnique({
            where: { installationId: dto.installationId },
            select: { id: true, userId: true, isActive: true },
          });

          if (
            existing &&
            existing.userId !== actorUserId &&
            existing.isActive
          ) {
            return { outcome: 'installation_conflict' as const };
          }

          if (dto.fcmToken) {
            await tx.device.updateMany({
              where: {
                fcmToken: dto.fcmToken,
                ...(existing ? { id: { not: existing.id } } : {}),
              },
              data: { fcmToken: null, updatedAt: new Date() },
            });
          }

          const now = new Date();
          const device = existing
            ? await tx.device.update({
                where: { id: existing.id },
                data: {
                  userId: actorUserId,
                  deviceName: dto.deviceName,
                  platform: dto.platform,
                  operatingSystem: dto.operatingSystem,
                  batteryLevel: dto.batteryLevel,
                  ...(dto.fcmToken !== undefined
                    ? { fcmToken: dto.fcmToken }
                    : existing.userId !== actorUserId
                      ? { fcmToken: null }
                      : {}),
                  isActive: true,
                  lastSeenAt: now,
                  updatedAt: now,
                },
                select: safeDeviceSelect,
              })
            : await tx.device.create({
                data: {
                  userId: actorUserId,
                  installationId: dto.installationId,
                  deviceName: dto.deviceName,
                  platform: dto.platform,
                  operatingSystem: dto.operatingSystem,
                  fcmToken: dto.fcmToken,
                  batteryLevel: dto.batteryLevel,
                  isActive: true,
                  lastSeenAt: now,
                  updatedAt: now,
                },
                select: safeDeviceSelect,
              });

          return { outcome: 'registered' as const, device };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async listOwned(userId: string, pagination: DevicePaginationDto) {
    const where = { userId } satisfies Prisma.DeviceWhereInput;
    const [devices, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        select: safeDeviceSelect,
        orderBy: [{ isActive: 'desc' }, { lastSeenAt: 'desc' }],
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.device.count({ where }),
    ]);
    return { devices, total };
  }

  findOwned(userId: string, deviceId: string) {
    return this.prisma.device.findFirst({
      where: { id: deviceId, userId },
      select: safeDeviceSelect,
    });
  }

  updateOwned(userId: string, deviceId: string, dto: UpdateDeviceDto) {
    return this.withTransactionRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.device.findFirst({
            where: { id: deviceId, userId },
            select: { id: true, isActive: true },
          });
          if (!existing) return { outcome: 'not_found' as const };
          if (!existing.isActive) return { outcome: 'inactive' as const };

          if (dto.fcmToken) {
            await tx.device.updateMany({
              where: { fcmToken: dto.fcmToken, id: { not: deviceId } },
              data: { fcmToken: null, updatedAt: new Date() },
            });
          }

          const device = await tx.device.update({
            where: { id: deviceId },
            data: {
              deviceName: dto.deviceName,
              platform: dto.platform,
              operatingSystem: dto.operatingSystem,
              batteryLevel: dto.batteryLevel,
              ...(dto.fcmToken !== undefined ? { fcmToken: dto.fcmToken } : {}),
              updatedAt: new Date(),
            },
            select: safeDeviceSelect,
          });
          return { outcome: 'updated' as const, device };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  heartbeatOwned(userId: string, deviceId: string, dto: DeviceHeartbeatDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.device.findFirst({
          where: { id: deviceId, userId },
          select: { id: true, isActive: true },
        });
        if (!existing) return { outcome: 'not_found' as const };
        if (!existing.isActive) return { outcome: 'inactive' as const };

        const now = new Date();
        const device = await tx.device.update({
          where: { id: deviceId },
          data: {
            batteryLevel: dto.batteryLevel,
            lastSeenAt: now,
            updatedAt: now,
          },
          select: safeDeviceSelect,
        });
        return { outcome: 'updated' as const, device };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  deactivateOwned(userId: string, deviceId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.device.findFirst({
          where: { id: deviceId, userId },
          select: { id: true },
        });
        if (!existing) return { outcome: 'not_found' as const };

        await tx.device.update({
          where: { id: deviceId },
          data: { isActive: false, fcmToken: null, updatedAt: new Date() },
          select: { id: true },
        });
        return { outcome: 'deactivated' as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async withTransactionRetry<T>(work: () => Promise<T>): Promise<T> {
    for (
      let attempt = 1;
      attempt <= DEVICE_TRANSACTION_RETRY_LIMIT;
      attempt++
    ) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' || error.code === 'P2034');
        if (!retryable || attempt === DEVICE_TRANSACTION_RETRY_LIMIT) {
          throw error;
        }
      }
    }
    throw new Error('Unreachable device transaction retry state');
  }
}
