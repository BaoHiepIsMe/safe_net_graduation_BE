import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiStandardErrors } from '../../common/swagger/api-docs';
import {
  deviceHeartbeatSchema,
  deviceIdParamSchema,
  devicePaginationSchema,
  registerDeviceSchema,
  updateDeviceSchema,
} from './dto/device.dto';
import type {
  DeviceHeartbeatDto,
  DeviceIdParam,
  DevicePaginationDto,
  RegisterDeviceDto,
  UpdateDeviceDto,
} from './dto/device.dto';
import { DevicesService } from './devices.service';
import {
  deviceHeartbeatBodySchema,
  deviceSuccessSchema,
  paginatedDevicesSuccessSchema,
  registerDeviceBodySchema,
  updateDeviceBodySchema,
} from './devices.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @ApiOperation({ summary: 'Đăng ký hoặc làm mới thiết bị theo bản cài đặt' })
  @ApiBody({ schema: registerDeviceBodySchema })
  @ApiResponse({ status: 201, schema: deviceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  register(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(registerDeviceSchema)) dto: RegisterDeviceDto,
  ) {
    return this.devicesService.register(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Liệt kê thiết bị của tài khoản hiện tại' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiResponse({ status: 200, schema: paginatedDevicesSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(devicePaginationSchema))
    pagination: DevicePaginationDto,
  ) {
    return this.devicesService.list(user.id, pagination);
  }

  @Get(':deviceId')
  @ApiOperation({ summary: 'Lấy thiết bị thuộc tài khoản hiện tại' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: deviceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(deviceIdParamSchema)) params: DeviceIdParam,
  ) {
    return this.devicesService.get(user.id, params.deviceId);
  }

  @Patch(':deviceId')
  @ApiOperation({ summary: 'Cập nhật metadata thiết bị được phép' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiBody({ schema: updateDeviceBodySchema })
  @ApiResponse({ status: 200, schema: deviceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  update(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(deviceIdParamSchema)) params: DeviceIdParam,
    @Body(new ZodValidationPipe(updateDeviceSchema)) dto: UpdateDeviceDto,
  ) {
    return this.devicesService.update(user.id, params.deviceId, dto);
  }

  @Post(':deviceId/heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật last-seen do máy chủ quản lý' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiBody({ schema: deviceHeartbeatBodySchema })
  @ApiResponse({ status: 200, schema: deviceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  heartbeat(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(deviceIdParamSchema)) params: DeviceIdParam,
    @Body(new ZodValidationPipe(deviceHeartbeatSchema))
    dto: DeviceHeartbeatDto,
  ) {
    return this.devicesService.heartbeat(user.id, params.deviceId, dto);
  }

  @Delete(':deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Ngừng hoạt động thiết bị và gỡ FCM token' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Đã ngừng; không có body' })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(deviceIdParamSchema)) params: DeviceIdParam,
  ): Promise<void> {
    await this.devicesService.deactivate(user.id, params.deviceId);
  }
}
