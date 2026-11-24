import { successSchema } from '../../common/swagger/api-docs';

const dateTime = { type: 'string', format: 'date-time' };
const nullableDateTime = { ...dateTime, nullable: true };

export const phoneUsageDataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    memberId: { type: 'string', format: 'uuid' },
    deviceId: { type: 'string', format: 'uuid' },
    appName: { type: 'string', nullable: true },
    appPackage: { type: 'string' },
    startedAt: dateTime,
    endedAt: dateTime,
    durationSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
    source: { type: 'string', enum: ['managed_device_app'] },
    createdAt: dateTime,
  },
};

export const phoneRuleDataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    memberId: { type: 'string', format: 'uuid' },
    dailyLimitMinutes: { type: 'integer', nullable: true },
    bedtimeStart: { type: 'string', example: '21:30', nullable: true },
    bedtimeEnd: { type: 'string', example: '06:30', nullable: true },
    isActive: { type: 'boolean' },
    enforcementStatus: {
      type: 'string',
      enum: ['device_enforcement_pending'],
      description: 'Persisted policy intent; not proof of OS enforcement.',
    },
    createdAt: dateTime,
    updatedAt: dateTime,
  },
};

export const phoneCommandDataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    memberId: { type: 'string', format: 'uuid' },
    targetDeviceId: { type: 'string', format: 'uuid' },
    commandType: {
      type: 'string',
      enum: ['lock', 'unlock', 'ring', 'warning'],
    },
    payload: {
      type: 'object',
      nullable: true,
      additionalProperties: false,
      properties: { message: { type: 'string', maxLength: 200 } },
    },
    status: {
      type: 'string',
      enum: ['pending', 'sent', 'completed', 'failed'],
      description:
        'sent means FCM accepted a wake-up; only a target-device ACK produces completed/failed.',
    },
    resultCode: { type: 'string', nullable: true },
    resultMessage: { type: 'string', nullable: true },
    createdAt: dateTime,
    sentAt: nullableDateTime,
    acknowledgedAt: nullableDateTime,
    updatedAt: dateTime,
  },
};

export const phoneDeviceDataSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    deviceName: { type: 'string', nullable: true },
    platform: { type: 'string' },
    operatingSystem: { type: 'string', nullable: true },
    batteryLevel: { type: 'integer', nullable: true },
    lastSeenAt: dateTime,
    locked: {
      type: 'boolean',
      description:
        'True when the last acknowledged lock/unlock on this Device was a lock.',
    },
  },
};

export const phoneDeviceListSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: { type: 'array', items: phoneDeviceDataSchema },
  },
};

export const phoneUsageBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'clientRecordId',
    'appPackage',
    'startedAt',
    'endedAt',
    'durationSeconds',
  ],
  properties: {
    clientRecordId: { type: 'string', format: 'uuid' },
    appPackage: { type: 'string', minLength: 1, maxLength: 150 },
    appName: { type: 'string', minLength: 1, maxLength: 100 },
    startedAt: dateTime,
    endedAt: dateTime,
    durationSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
  },
};

export const phoneRuleBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dailyLimitMinutes: {
      type: 'integer',
      minimum: 1,
      maximum: 1440,
      nullable: true,
    },
    bedtimeStart: {
      type: 'string',
      pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
      nullable: true,
    },
    bedtimeEnd: {
      type: 'string',
      pattern: '^([01]\\d|2[0-3]):[0-5]\\d$',
      nullable: true,
    },
  },
};

export const phoneRuleUpdateBodySchema = {
  ...phoneRuleBodySchema,
  minProperties: 1,
  properties: {
    ...phoneRuleBodySchema.properties,
    isActive: { type: 'boolean' },
  },
};

export const phoneCommandBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId', 'commandType'],
  properties: {
    clientRequestId: { type: 'string', format: 'uuid' },
    commandType: {
      type: 'string',
      enum: ['lock', 'unlock', 'ring', 'warning'],
    },
    message: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'Required only for warning; rejected for lock/unlock/ring.',
    },
  },
};

export const commandAckBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['completed', 'failed'] },
    resultCode: { type: 'string', maxLength: 50 },
    message: { type: 'string', maxLength: 300 },
  },
  description:
    'Only the authenticated owner of the active target Device may acknowledge actual execution.',
};

export const usageSuccessSchema = successSchema(phoneUsageDataSchema);
export const ruleSuccessSchema = successSchema(phoneRuleDataSchema);
export const commandSuccessSchema = successSchema(phoneCommandDataSchema);

export const cursorListSchema = (item: Record<string, unknown>) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: { type: 'array', items: item },
    pagination: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        nextCursor: { type: 'string', nullable: true },
        hasMore: { type: 'boolean' },
      },
    },
  },
});
