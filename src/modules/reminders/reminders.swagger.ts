import { successSchema } from '../../common/swagger/api-docs';

const timezone = { type: 'string', example: 'Asia/Ho_Chi_Minh' };
const scheduleSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'occurrenceAt', 'timezone'],
      properties: {
        type: { type: 'string', enum: ['once'] },
        occurrenceAt: { type: 'string', format: 'date-time' },
        timezone,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'timeOfDay', 'timezone', 'startsOn'],
      properties: {
        type: { type: 'string', enum: ['daily'] },
        timeOfDay: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        timezone,
        startsOn: { type: 'string', format: 'date' },
        endsAt: { type: 'string', format: 'date-time' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'timeOfDay', 'timezone', 'startsOn', 'weekdays'],
      properties: {
        type: { type: 'string', enum: ['weekly'] },
        timeOfDay: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        timezone,
        startsOn: { type: 'string', format: 'date' },
        weekdays: {
          type: 'array',
          description: 'Unique weekdays where 0 is Sunday and 6 is Saturday.',
          minItems: 1,
          maxItems: 7,
          uniqueItems: true,
          items: { type: 'integer', minimum: 0, maximum: 6 },
        },
        endsAt: { type: 'string', format: 'date-time' },
      },
    },
  ],
};

export const createReminderBodySchema: any = {
  type: 'object',
  additionalProperties: false,
  required: ['familyId', 'title', 'schedule', 'targetMemberIds'],
  properties: {
    familyId: { type: 'string', format: 'uuid' },
    title: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: 'string', maxLength: 2000, nullable: true },
    reminderType: { type: 'string', maxLength: 30, nullable: true },
    schedule: scheduleSchema,
    targetMemberIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
  },
};

export const updateReminderBodySchema: any = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 150 },
    description: { type: 'string', maxLength: 2000, nullable: true },
    reminderType: { type: 'string', maxLength: 30, nullable: true },
    schedule: scheduleSchema,
    targetMemberIds: createReminderBodySchema.properties.targetMemberIds,
    isActive: { type: 'boolean' },
  },
};

export const reminderDataSchema: any = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'familyId',
    'creator',
    'title',
    'description',
    'reminderType',
    'schedule',
    'isActive',
    'nextOccurrenceAt',
    'targets',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    creator: {
      type: 'object',
      required: ['id', 'fullName', 'avatarUrl'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: { type: 'string', nullable: true },
        avatarUrl: { type: 'string', nullable: true },
      },
    },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    reminderType: { type: 'string', nullable: true },
    schedule: scheduleSchema,
    isActive: { type: 'boolean' },
    nextOccurrenceAt: { type: 'string', format: 'date-time', nullable: true },
    targets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['memberId', 'userId', 'displayName', 'avatarUrl'],
        properties: {
          memberId: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          displayName: { type: 'string', nullable: true },
          avatarUrl: { type: 'string', nullable: true },
        },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const paginationSchema = {
  type: 'object',
  required: ['limit', 'nextCursor', 'hasMore'],
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    nextCursor: { type: 'string', nullable: true },
    hasMore: { type: 'boolean' },
  },
};

export const reminderSuccessSchema = successSchema(reminderDataSchema);
export const reminderListSuccessSchema: any = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean' },
    data: { type: 'array', items: reminderDataSchema },
    pagination: paginationSchema,
  },
};
export const reminderUpcomingSuccessSchema: any = successSchema({
  type: 'object',
  required: ['data', 'horizonEndsAt'],
  properties: {
    data: { type: 'array', items: reminderDataSchema },
    horizonEndsAt: { type: 'string', format: 'date-time' },
  },
});
export const reminderLogsSuccessSchema: any = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'reminderId',
          'memberId',
          'recipient',
          'scheduledAt',
          'status',
          'processedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          reminderId: { type: 'string', format: 'uuid' },
          memberId: { type: 'string', format: 'uuid' },
          recipient: { type: 'object' },
          scheduledAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['due', 'missed'] },
          processedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
    pagination: paginationSchema,
  },
};
