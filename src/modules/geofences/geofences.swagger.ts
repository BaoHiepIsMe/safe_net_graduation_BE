import type { SchemaObject } from '@nestjs/swagger';
import { GEOFENCE_ICONS } from './geofences.constants';

const assignmentSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['memberId'],
  properties: {
    memberId: { type: 'string', format: 'uuid' },
    notifyOnEnter: { type: 'boolean', default: true },
    notifyOnExit: { type: 'boolean', default: true },
  },
};

export const createGeofenceBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'centerLatitude', 'centerLongitude', 'radiusMeters'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    address: { type: 'string', nullable: true, maxLength: 500 },
    centerLatitude: { type: 'number', minimum: -90, maximum: 90 },
    centerLongitude: { type: 'number', minimum: -180, maximum: 180 },
    radiusMeters: { type: 'integer', minimum: 1, maximum: 100000 },
    icon: { type: 'string', nullable: true, enum: [...GEOFENCE_ICONS] },
    members: { type: 'array', maxItems: 100, items: assignmentSchema },
  },
};

export const updateGeofenceBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    address: { type: 'string', nullable: true, maxLength: 500 },
    centerLatitude: { type: 'number', minimum: -90, maximum: 90 },
    centerLongitude: { type: 'number', minimum: -180, maximum: 180 },
    radiusMeters: { type: 'integer', minimum: 1, maximum: 100000 },
    icon: { type: 'string', nullable: true, enum: [...GEOFENCE_ICONS] },
    isActive: { type: 'boolean' },
  },
};

export const replaceMembersBodySchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['members'],
  properties: {
    members: { type: 'array', maxItems: 100, items: assignmentSchema },
  },
};

export const geofenceSuccessSchema: SchemaObject = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        familyId: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        address: { type: 'string', nullable: true },
        centerLatitude: { type: 'number' },
        centerLongitude: { type: 'number' },
        radiusMeters: { type: 'integer' },
        icon: { type: 'string', nullable: true },
        isActive: { type: 'boolean' },
        members: { type: 'array', items: assignmentSchema },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  },
};

export const geofenceListSuccessSchema: SchemaObject = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean', example: true },
    data: { type: 'array', items: geofenceSuccessSchema.properties?.data },
    pagination: {
      type: 'object',
      properties: {
        page: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer' },
        totalPages: { type: 'integer' },
      },
    },
  },
};

export const geofenceEventHistorySuccessSchema: SchemaObject = {
  type: 'object',
  required: ['success', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean', example: true },
    data: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          transition: { type: 'string', enum: ['enter', 'exit'] },
          geofence: { type: 'object' },
          member: { type: 'object' },
          location: { type: 'object', nullable: true },
          occurredAt: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
    pagination: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        nextCursor: { type: 'string', nullable: true },
        hasMore: { type: 'boolean' },
      },
    },
  },
};
