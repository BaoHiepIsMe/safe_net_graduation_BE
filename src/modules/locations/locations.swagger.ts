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
    'familyLabel',
    'displayName',
    'isOwner',
    'canManageCare',
    'isCareRecipient',
    'isMinor',
    'isHired',
    'careScopeMemberIds',
    'profile',
    'location',
  ],
  properties: {
    memberId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    familyLabel: {
      type: 'string',
      enum: [
        'father',
        'mother',
        'husband',
        'wife',
        'son',
        'daughter',
        'brother',
        'sister',
        'grandfather',
        'grandmother',
        'grandchild',
        'caregiver',
        'other',
      ],
    },
    displayName: { type: 'string', nullable: true },
    isOwner: { type: 'boolean' },
    canManageCare: { type: 'boolean' },
    isCareRecipient: { type: 'boolean' },
    isMinor: { type: 'boolean' },
    isHired: { type: 'boolean' },
    careScopeMemberIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
    },
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

export const setLocationViewersBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['viewerUserIds'],
  properties: {
    viewerUserIds: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string', format: 'uuid' },
    },
  },
};

export const locationViewersSuccessSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: setLocationViewersBodySchema,
  },
};
