import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

export const standardErrorSchema = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', example: false },
    error: {
      type: 'object',
      required: ['code', 'message', 'details'],
      properties: {
        code: { type: 'string', example: 'VALIDATION_ERROR' },
        message: { type: 'string' },
        details: { nullable: true },
      },
    },
  },
};

const errorDescriptions: Record<number, string> = {
  400: 'Request không hợp lệ (VALIDATION_ERROR)',
  401: 'Thiếu hoặc token không hợp lệ (UNAUTHORIZED/TOKEN_EXPIRED)',
  403: 'Không có quyền (ACCESS_DENIED)',
  404: 'Không tìm thấy tài nguyên (RESOURCE_NOT_FOUND)',
  409: 'Xung đột dữ liệu (USER_ALREADY_EXISTS)',
  422: 'Yêu cầu hợp lệ về cấu trúc nhưng vi phạm quy tắc nghiệp vụ',
  429: 'Vượt giới hạn request (RATE_LIMIT_EXCEEDED)',
  500: 'Lỗi máy chủ đã được làm sạch (INTERNAL_SERVER_ERROR)',
  503: 'Dependency chưa sẵn sàng (DEPENDENCY_UNAVAILABLE)',
};

export function ApiStandardErrors(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: errorDescriptions[status] || 'Request thất bại',
        schema: standardErrorSchema,
      }),
    ),
  );
}

export function successSchema(data: Record<string, unknown>) {
  return {
    type: 'object',
    required: ['success', 'message', 'data'],
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Thành công' },
      data,
    },
  };
}

const nullableString = { type: 'string', nullable: true };

export const sessionSchema = {
  type: 'object',
  required: ['accessToken', 'refreshToken', 'expiresIn', 'tokenType'],
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    expiresIn: { type: 'integer', example: 3600 },
    tokenType: { type: 'string', example: 'bearer' },
  },
};

export const registerSuccessDataSchema = {
  type: 'object',
  required: ['user', 'session'],
  properties: {
    user: {
      type: 'object',
      required: [
        'id',
        'email',
        'phoneNumber',
        'fullName',
        'gender',
        'dateOfBirth',
        'role',
      ],
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: nullableString,
        phoneNumber: { type: 'string', example: '+84912345678' },
        fullName: { type: 'string' },
        gender: { type: 'string', enum: ['male', 'female', 'other'] },
        dateOfBirth: { type: 'string', format: 'date' },
        role: { type: 'string', enum: ['personal', 'parent', 'guardian'] },
      },
    },
    session: { type: 'object', nullable: true, enum: [null] },
  },
};

export const loginSuccessDataSchema = {
  type: 'object',
  required: ['user', 'session'],
  properties: {
    user: {
      type: 'object',
      required: ['id', 'fullName', 'avatarUrl'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: nullableString,
        fullName: { type: 'string' },
        avatarUrl: nullableString,
      },
    },
    session: sessionSchema,
  },
};

export const refreshSuccessDataSchema = {
  type: 'object',
  required: ['session'],
  properties: { session: sessionSchema },
};

export const authUserSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: nullableString,
    phone: nullableString,
  },
};

export const messageDataSchema = {
  type: 'object',
  required: ['message'],
  properties: { message: { type: 'string' } },
};

export const profileDataSchema = {
  type: 'object',
  required: [
    'id',
    'fullName',
    'avatarUrl',
    'dateOfBirth',
    'gender',
    'role',
    'phoneNumber',
    'accountStatus',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    fullName: { type: 'string' },
    avatarUrl: nullableString,
    dateOfBirth: { type: 'string', format: 'date', nullable: true },
    gender: {
      type: 'string',
      enum: ['male', 'female', 'other'],
      nullable: true,
    },
    role: {
      type: 'string',
      enum: ['personal', 'parent', 'guardian'],
      nullable: true,
    },
    phoneNumber: nullableString,
    accountStatus: { type: 'string', example: 'active' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const settingsDataSchema = {
  type: 'object',
  required: [
    'userId',
    'language',
    'pushNotificationsEnabled',
    'smsNotificationsEnabled',
    'emailNotificationsEnabled',
    'locationSharingEnabled',
    'darkMode',
    'theme',
    'quietHoursStart',
    'quietHoursEnd',
    'updatedAt',
  ],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    language: { type: 'string', enum: ['vi', 'en'] },
    pushNotificationsEnabled: { type: 'boolean' },
    smsNotificationsEnabled: { type: 'boolean' },
    emailNotificationsEnabled: { type: 'boolean' },
    locationSharingEnabled: { type: 'boolean' },
    darkMode: { type: 'boolean' },
    theme: { type: 'string', enum: ['light', 'dark', 'system'] },
    quietHoursStart: { ...nullableString, example: '22:00' },
    quietHoursEnd: { ...nullableString, example: '06:30' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const biometricDataSchema = {
  type: 'object',
  required: ['userId', 'biometricEnabled', 'biometricType', 'updatedAt'],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    biometricEnabled: { type: 'boolean' },
    biometricType: {
      type: 'string',
      enum: ['fingerprint', 'face', 'iris', 'none'],
      nullable: true,
    },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

export const livenessDataSchema = {
  type: 'object',
  required: ['status', 'timestamp', 'uptime', 'version'],
  properties: {
    status: { type: 'string', example: 'ok' },
    timestamp: { type: 'string', format: 'date-time' },
    uptime: { type: 'number' },
    version: { type: 'string', example: '1.0.0' },
  },
};

export const readinessDataSchema = {
  type: 'object',
  required: ['status', 'timestamp', 'dependencies'],
  properties: {
    status: { type: 'string', example: 'ready' },
    timestamp: { type: 'string', format: 'date-time' },
    dependencies: {
      type: 'object',
      required: ['database'],
      properties: { database: { type: 'string', example: 'available' } },
    },
  },
};
