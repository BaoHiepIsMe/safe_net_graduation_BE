import { successSchema } from '../../common/swagger/api-docs';

const nullableNumber = { type: 'number', nullable: true };
const nullableInteger = { type: 'integer', nullable: true };
const dateTime = { type: 'string', format: 'date-time' };

export const currentLocationDataSchema = {
  type: 'object',
  required: [
    'latitude',
    'longitude',
    'accuracy',
    'batteryLevel',
    'recordedAt',
    'updatedAt',
  ],
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    accuracy: nullableNumber,
    batteryLevel: nullableInteger,
    recordedAt: dateTime,
    updatedAt: dateTime,
  },
};

export const locationHistoryDataSchema = {
  type: 'object',
  required: [
    'id',
    'latitude',
    'longitude',
    'accuracy',
    'speed',
    'heading',
    'batteryLevel',
    'recordedAt',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    accuracy: nullableNumber,
    speed: nullableNumber,
    heading: nullableNumber,
    batteryLevel: nullableInteger,
    recordedAt: dateTime,
    createdAt: dateTime,
    currentUpdated: { type: 'boolean' },
  },
};

export const familyCurrentLocationDataSchema = {
  type: 'object',
  required: [
    'memberId',
    'userId',
    'role',
    'familyLabel',
    'displayName',
    'profile',
    'location',
  ],
  properties: {
    memberId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    role: { type: 'string', enum: ['manager', 'adult', 'child', 'elder'] },
    familyLabel: {
      type: 'string',
      enum: [
        'father',
        'mother',
        'son',
        'daughter',
        'grandfather',
        'grandmother',
        'caregiver',
        'other',
      ],
    },
    displayName: { type: 'string', nullable: true },
    profile: {
      type: 'object',
      required: ['fullName', 'avatarUrl'],
      properties: {
        fullName: { type: 'string', nullable: true },
        avatarUrl: { type: 'string', nullable: true },
      },
    },
    location: currentLocationDataSchema,
  },
};

export const ingestLocationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['latitude', 'longitude', 'recordedAt'],
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    accuracy: { ...nullableNumber, minimum: 0 },
    speed: { ...nullableNumber, minimum: 0 },
    heading: { ...nullableNumber, minimum: 0, maximum: 359.999999 },
    batteryLevel: {
      ...nullableInteger,
      minimum: 0,
      maximum: 100,
    },
    // Tỉ lệ pin 0–1 (đổi thành phần trăm); không gửi cùng batteryLevel
    batteryRatio: { ...nullableNumber, minimum: 0, maximum: 1 },
    recordedAt: dateTime,
  },
};

export const ingestLocationSuccessSchema = successSchema({
  ...locationHistoryDataSchema,
  required: [...locationHistoryDataSchema.required, 'currentUpdated'],
});

export const currentLocationSuccessSchema = successSchema(
  currentLocationDataSchema,
);

export const familyCurrentLocationSuccessSchema = successSchema(
  familyCurrentLocationDataSchema,
);

export const familyCurrentLocationsSuccessSchema = successSchema({
  type: 'array',
  items: familyCurrentLocationDataSchema,
});

export const locationHistorySuccessSchema = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Thành công' },
    data: { type: 'array', items: locationHistoryDataSchema },
    pagination: {
      type: 'object',
      required: ['limit', 'nextCursor', 'hasMore'],
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        nextCursor: { type: 'string', nullable: true },
        hasMore: { type: 'boolean' },
      },
    },
  },
};
