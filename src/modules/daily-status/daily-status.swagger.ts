const subjectSchema = {
  type: 'object',
  required: ['id', 'fullName', 'avatarUrl'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    fullName: { type: 'string', nullable: true },
    avatarUrl: { type: 'string', nullable: true },
  },
};

export const dailyStatusOverviewSchema = {
  type: 'object',
  required: [
    'id',
    'familyId',
    'memberId',
    'subject',
    'reportDate',
    'timezone',
    'generatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    memberId: { type: 'string', format: 'uuid' },
    subject: subjectSchema,
    reportDate: { type: 'string', format: 'date', example: '2026-09-01' },
    timezone: { type: 'string', example: 'Asia/Ho_Chi_Minh' },
    generatedAt: { type: 'string', format: 'date-time' },
  },
};

const availabilitySchema = {
  type: 'string',
  enum: ['available', 'no_data', 'not_applicable', 'restricted'],
};

export const dailyStatusDetailSchema = {
  allOf: [
    dailyStatusOverviewSchema,
    {
      type: 'object',
      required: [
        'dayStart',
        'dayEnd',
        'schemaVersion',
        'dataAvailability',
        'locationSummary',
        'geofenceSummary',
        'sosSummary',
        'reminderSummary',
        'phoneUsageSummary',
      ],
      properties: {
        dayStart: { type: 'string', format: 'date-time' },
        dayEnd: { type: 'string', format: 'date-time' },
        schemaVersion: { type: 'integer', example: 1 },
        dataAvailability: {
          type: 'object',
          additionalProperties: availabilitySchema,
        },
        locationSummary: {
          nullable: true,
          type: 'object',
          properties: {
            recordCount: { type: 'integer', minimum: 0 },
            lastRecordedAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
            },
          },
        },
        geofenceSummary: {
          nullable: true,
          type: 'object',
          properties: {
            enterCount: { type: 'integer', minimum: 0 },
            exitCount: { type: 'integer', minimum: 0 },
          },
        },
        sosSummary: {
          nullable: true,
          type: 'object',
          properties: {
            totalCount: { type: 'integer', minimum: 0 },
            activeCount: { type: 'integer', minimum: 0 },
            resolvedCount: { type: 'integer', minimum: 0 },
            cancelledCount: { type: 'integer', minimum: 0 },
          },
        },
        reminderSummary: {
          nullable: true,
          type: 'object',
          properties: {
            occurrenceCount: { type: 'integer', minimum: 0 },
            notificationProcessedCount: { type: 'integer', minimum: 0 },
            missedCount: { type: 'integer', minimum: 0 },
            completedCount: { type: 'integer', minimum: 0 },
          },
        },
        phoneUsageSummary: {
          nullable: true,
          type: 'object',
          properties: {
            totalUsageSeconds: { type: 'integer', minimum: 0 },
            topApps: { type: 'array', maxItems: 5, items: { type: 'object' } },
          },
        },
      },
    },
  ],
};

export const dailyStatusHistorySuccessSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    data: { type: 'array', items: dailyStatusOverviewSchema },
    pagination: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        hasMore: { type: 'boolean' },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  },
};

export const dailyStatusDetailSuccessSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    data: dailyStatusDetailSchema,
  },
};
