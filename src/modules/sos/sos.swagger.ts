import { successSchema } from '../../common/swagger/api-docs';

const nullableDate = { type: 'string', format: 'date-time', nullable: true };
const nullableUuid = { type: 'string', format: 'uuid', nullable: true };

export const sosContactDataSchema = {
  type: 'object',
  required: [
    'id',
    'contactName',
    'phone',
    'priority',
    'isActive',
    'linkedUser',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    contactName: { type: 'string', maxLength: 100 },
    phone: { type: 'string', maxLength: 16 },
    priority: { type: 'integer', minimum: 1, maximum: 100 },
    isActive: { type: 'boolean' },
    linkedUser: {
      type: 'object',
      nullable: true,
      required: ['id', 'fullName', 'avatarUrl'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: { type: 'string', nullable: true },
        avatarUrl: { type: 'string', nullable: true },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const sosEventDataSchema = {
  type: 'object',
  required: [
    'id',
    'clientRequestId',
    'status',
    'actor',
    'message',
    'location',
    'triggeredAt',
    'resolvedAt',
    'cancelledAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    clientRequestId: nullableUuid,
    status: { type: 'string', enum: ['active', 'resolved', 'cancelled'] },
    actor: {
      type: 'object',
      required: ['id', 'fullName', 'avatarUrl'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: { type: 'string', nullable: true },
        avatarUrl: { type: 'string', nullable: true },
      },
    },
    message: { type: 'string', nullable: true, maxLength: 500 },
    location: {
      type: 'object',
      required: [
        'available',
        'latitude',
        'longitude',
        'accuracy',
        'recordedAt',
      ],
      properties: {
        available: { type: 'boolean' },
        latitude: {
          type: 'number',
          minimum: -90,
          maximum: 90,
          nullable: true,
        },
        longitude: {
          type: 'number',
          minimum: -180,
          maximum: 180,
          nullable: true,
        },
        accuracy: { type: 'number', minimum: 0, nullable: true },
        recordedAt: nullableDate,
      },
    },
    triggeredAt: { type: 'string', format: 'date-time' },
    resolvedAt: nullableDate,
    cancelledAt: nullableDate,
  },
};

export const createSosContactBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['contactName', 'phone'],
  properties: {
    contactName: { type: 'string', minLength: 1, maxLength: 100 },
    phone: { type: 'string', minLength: 8, maxLength: 30 },
    contactUserId: nullableUuid,
    priority: { type: 'integer', minimum: 1, maximum: 100, default: 1 },
  },
};

export const updateSosContactBodySchema = {
  ...createSosContactBodySchema,
  required: [],
  minProperties: 1,
  properties: {
    ...createSosContactBodySchema.properties,
    isActive: { type: 'boolean' },
  },
};

export const triggerSosBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId'],
  properties: {
    clientRequestId: { type: 'string', format: 'uuid' },
    deviceId: { type: 'string', format: 'uuid' },
    message: { type: 'string', minLength: 1, maxLength: 500 },
    location: {
      type: 'object',
      additionalProperties: false,
      required: ['latitude', 'longitude', 'recordedAt'],
      description:
        'Vị trí GPS lấy một lần lúc bấm SOS, gửi kể cả khi đã tắt chia sẻ vị trí. ' +
        'Chỉ lưu trên sự kiện SOS, không vào lịch sử hay Family Map. ' +
        'Không gửi thì dùng vị trí hiện tại đã theo dõi. Không tính vào idempotency.',
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        accuracy: { type: 'number', minimum: 0, nullable: true },
        recordedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
};

export const emptySosBodySchema = {
  type: 'object',
  additionalProperties: false,
  maxProperties: 0,
};

export const sosContactSuccessSchema = successSchema(sosContactDataSchema);
export const sosEventSuccessSchema = successSchema(sosEventDataSchema);
export const sosContactListSuccessSchema = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean' },
    data: { type: 'array', items: sosContactDataSchema },
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
export const sosHistorySuccessSchema = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean' },
    data: { type: 'array', items: sosEventDataSchema },
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
