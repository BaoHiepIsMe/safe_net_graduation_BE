import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/app.error';
import { DevicesRepository } from './devices.repository';
import {
  DeviceHeartbeatDto,
  DevicePaginationDto,
  RegisterDeviceDto,
  UpdateDeviceDto,
} from './dto/device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly devicesRepository: DevicesRepository) {}

  async register(userId: string, dto: RegisterDeviceDto) {
    const result = await this.runMutation(() =>
      this.devicesRepository.register(userId, dto),
    );
    if (result.outcome === 'installation_conflict') {
      throw new ConflictError(
        'Bản cài đặt thiết bị đang hoạt động với tài khoản khác',
        ErrorCode.DEVICE_INSTALLATION_CONFLICT,
      );
    }
    return result.device;
  }

  async list(userId: string, pagination: DevicePaginationDto) {
    const { devices, total } = await this.devicesRepository.listOwned(
      userId,
      pagination,
    );
    return {
      data: devices,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async get(userId: string, deviceId: string) {
    const device = await this.devicesRepository.findOwned(userId, deviceId);
    if (!device) this.throwNotFound();
    return device;
  }

  async update(userId: string, deviceId: string, dto: UpdateDeviceDto) {
    const result = await this.runMutation(() =>
      this.devicesRepository.updateOwned(userId, deviceId, dto),
    );
    if (result.outcome === 'not_found') this.throwNotFound();
    if (result.outcome === 'inactive') this.throwInactive();
    return result.device;
  }

  async heartbeat(userId: string, deviceId: string, dto: DeviceHeartbeatDto) {
    const result = await this.runMutation(() =>
      this.devicesRepository.heartbeatOwned(userId, deviceId, dto),
    );
    if (result.outcome === 'not_found') this.throwNotFound();
    if (result.outcome === 'inactive') this.throwInactive();
    return result.device;
  }

  async deactivate(userId: string, deviceId: string): Promise<void> {
    const result = await this.runMutation(() =>
      this.devicesRepository.deactivateOwned(userId, deviceId),
    );
    if (result.outcome === 'not_found') this.throwNotFound();
  }

  private throwNotFound(): never {
    throw new NotFoundError(
      'Không tìm thấy thiết bị',
      ErrorCode.DEVICE_NOT_FOUND,
    );
  }

  private throwInactive(): never {
    throw new BusinessRuleError(
      ErrorCode.DEVICE_INACTIVE,
      'Thiết bị đã ngừng hoạt động; hãy đăng ký lại để kích hoạt',
    );
  }

  private async runMutation<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictError(
            'FCM token đang được cập nhật đồng thời; vui lòng thử lại',
            ErrorCode.FCM_TOKEN_CONFLICT,
          );
        }
        if (error.code === 'P2034') {
          throw new ConflictError(
            'Trạng thái thiết bị đã thay đổi; vui lòng thử lại',
            ErrorCode.INVALID_DEVICE_STATE,
          );
        }
      }
      throw error;
    }
  }
}
