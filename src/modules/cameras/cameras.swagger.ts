import { successSchema } from '../../common/swagger/api-docs';

export const cameraDataSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'familyId',
    'name',
    'locationLabel',
    'isActive',
    'connectivityStatus',
    'hasConnectionConfiguration',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    name: { type: 'string', maxLength: 100 },
    locationLabel: { type: 'string', maxLength: 100, nullable: true },
    isActive: { type: 'boolean' },
    connectivityStatus: { type: 'string', enum: ['unknown'] },
    hasConnectionConfiguration: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const createCameraBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    locationLabel: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      nullable: true,
    },
    connectionUrl: {
      type: 'string',
      format: 'uri',
      maxLength: 2048,
      description:
        'Write-only connection configuration. Allowed schemes: rtsp, rtsps, https.',
      example: 'rtsps://camera.example.invalid/live',
    },
  },
};

export const updateCameraBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    ...createCameraBodySchema.properties,
    connectionUrl: {
      ...createCameraBodySchema.properties.connectionUrl,
      nullable: true,
    },
    isActive: { type: 'boolean' },
  },
};

export const cameraSuccessSchema = successSchema(cameraDataSchema);
export const cameraListSuccessSchema = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean' },
    data: { type: 'array', items: cameraDataSchema },
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
