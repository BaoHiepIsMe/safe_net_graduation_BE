import { successSchema } from '../../common/swagger/api-docs';

const nullableString = { type: 'string', nullable: true };
const nullableBattery = {
  type: 'integer',
  minimum: 0,
  maximum: 100,
  nullable: true,
};
const platform = {
  type: 'string',
  enum: ['android', 'ios', 'web', 'other'],
};

export const deviceDataSchema = {
  type: 'object',
  required: [
    'id',
    'deviceName',
    'platform',
    'operatingSystem',
    'batteryLevel',
    'isActive',
    'lastSeenAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    deviceName: nullableString,
    platform,
    operatingSystem: nullableString,
    batteryLevel: nullableBattery,
    isActive: { type: 'boolean' },
    lastSeenAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const deviceSuccessSchema = successSchema(deviceDataSchema);

export const paginatedDevicesSuccessSchema = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Thành công' },
    data: { type: 'array', items: deviceDataSchema },
    pagination: {
      type: 'object',
      required: ['page', 'limit', 'total', 'totalPages'],
      properties: {
        page: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0 },
        totalPages: { type: 'integer', minimum: 0 },
      },
    },
  },
};

export const registerDeviceBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['installationId', 'platform'],
  properties: {
    installationId: { type: 'string', format: 'uuid' },
    deviceName: { ...nullableString, minLength: 1, maxLength: 100 },
    platform,
    operatingSystem: { ...nullableString, minLength: 1, maxLength: 30 },
    fcmToken: {
      type: 'string',
      minLength: 16,
      maxLength: 1024,
      pattern: '^[\\x21-\\x7E]+$',
      nullable: true,
      writeOnly: true,
    },
    batteryLevel: nullableBattery,
  },
};

export const updateDeviceBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    deviceName: { ...nullableString, minLength: 1, maxLength: 100 },
    platform,
    operatingSystem: { ...nullableString, minLength: 1, maxLength: 30 },
    fcmToken: {
      type: 'string',
      minLength: 16,
      maxLength: 1024,
      pattern: '^[\\x21-\\x7E]+$',
      nullable: true,
      writeOnly: true,
    },
    batteryLevel: nullableBattery,
  },
};

export const deviceHeartbeatBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { batteryLevel: nullableBattery },
};
