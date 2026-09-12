import { successSchema } from '../../common/swagger/api-docs';

export const notificationDataSchema = {
  type: 'object',
  required: [
    'id',
    'familyId',
    'type',
    'title',
    'message',
    'metadata',
    'isRead',
    'readAt',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid', nullable: true },
    type: {
      type: 'string',
      enum: ['geofence_enter', 'geofence_exit', 'sos_alert', 'reminder'],
    },
    title: { type: 'string', maxLength: 150 },
    message: { type: 'string' },
    metadata: {
      type: 'object',
      additionalProperties: false,
      required: [
        'geofenceId',
        'geofenceName',
        'memberId',
        'transition',
        'occurredAt',
        'sosEventId',
        'reminderId',
        'reminderLogId',
      ],
      properties: {
        geofenceId: { type: 'string', format: 'uuid', nullable: true },
        geofenceName: { type: 'string', nullable: true },
        memberId: { type: 'string', format: 'uuid', nullable: true },
        transition: {
          type: 'string',
          enum: ['enter', 'exit'],
          nullable: true,
        },
        occurredAt: { type: 'string', format: 'date-time', nullable: true },
        sosEventId: { type: 'string', format: 'uuid', nullable: true },
        reminderId: { type: 'string', format: 'uuid', nullable: true },
        reminderLogId: { type: 'string', format: 'uuid', nullable: true },
      },
    },
    isRead: { type: 'boolean' },
    readAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const notificationSuccessSchema = successSchema(notificationDataSchema);
export const notificationListSuccessSchema = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean', example: true },
    data: { type: 'array', items: notificationDataSchema },
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
export const unreadCountSuccessSchema = successSchema({
  type: 'object',
  required: ['count'],
  properties: { count: { type: 'integer', minimum: 0 } },
});
export const readAllSuccessSchema = successSchema({
  type: 'object',
  required: ['updatedCount'],
  properties: { updatedCount: { type: 'integer', minimum: 0 } },
});
export const emptyMutationBodySchema = {
  type: 'object',
  additionalProperties: false,
  maxProperties: 0,
};
