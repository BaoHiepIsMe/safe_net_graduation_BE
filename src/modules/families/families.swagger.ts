import { successSchema } from '../../common/swagger/api-docs';

const nullableString = { type: 'string', nullable: true };
const dateTime = { type: 'string', format: 'date-time', nullable: true };
const role = {
  type: 'string',
  enum: ['manager', 'adult', 'child', 'elder'],
};
const label = {
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
};

export const familyDataSchema = {
  type: 'object',
  required: [
    'id',
    'familyName',
    'ownerUserId',
    'avatarUrl',
    'status',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyName: { type: 'string', example: 'Gia đình Nguyễn' },
    ownerUserId: { type: 'string', format: 'uuid' },
    avatarUrl: nullableString,
    status: { type: 'string', enum: ['active', 'archived'] },
    createdAt: dateTime,
    updatedAt: dateTime,
    role,
    familyLabel: label,
  },
};

export const familyMemberDataSchema = {
  type: 'object',
  required: [
    'id',
    'familyId',
    'userId',
    'role',
    'familyLabel',
    'status',
    'profile',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    role,
    familyLabel: label,
    displayName: nullableString,
    status: {
      type: 'string',
      enum: ['pending', 'accepted', 'rejected', 'removed'],
    },
    locationSharingEnabled: { type: 'boolean' },
    invitedAt: dateTime,
    acceptedAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
    profile: {
      type: 'object',
      required: ['id', 'fullName', 'avatarUrl'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: nullableString,
        avatarUrl: nullableString,
      },
    },
  },
};

export const pendingInvitationDataSchema = {
  type: 'object',
  required: ['id', 'role', 'familyLabel', 'family', 'invitedBy'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    role,
    familyLabel: label,
    displayName: nullableString,
    invitedAt: dateTime,
    family: familyDataSchema,
    invitedBy: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: nullableString,
        avatarUrl: nullableString,
      },
    },
  },
};

export function paginatedSuccessSchema(itemSchema: Record<string, unknown>) {
  return {
    type: 'object',
    required: ['success', 'data', 'pagination'],
    properties: {
      success: { type: 'boolean', example: true },
      message: { type: 'string' },
      data: { type: 'array', items: itemSchema },
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
}

export const familySuccessSchema = successSchema(familyDataSchema);
export const familyMemberSuccessSchema = successSchema(familyMemberDataSchema);
export const createFamilySuccessSchema = successSchema({
  ...familyDataSchema,
  required: [...familyDataSchema.required, 'membership'],
  properties: {
    ...familyDataSchema.properties,
    membership: familyMemberDataSchema,
  },
});

export const createFamilyBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['familyName', 'familyLabel'],
  properties: {
    familyName: { type: 'string', minLength: 2, maxLength: 100 },
    avatarUrl: { type: 'string', format: 'uri', nullable: true },
    familyLabel: label,
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
  },
};

export const updateFamilyBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    familyName: { type: 'string', minLength: 2, maxLength: 100 },
    avatarUrl: { type: 'string', format: 'uri', nullable: true },
  },
};

export const createInvitationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['familyLabel'],
  properties: {
    email: { type: 'string', format: 'email' },
    phoneNumber: { type: 'string' },
    familyLabel: label,
    role: {
      type: 'string',
      enum: ['adult', 'child', 'elder'],
      default: 'adult',
    },
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
  },
  oneOf: [{ required: ['email'] }, { required: ['phoneNumber'] }],
};

export const updateFamilyMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    role,
    familyLabel: label,
    displayName: { type: 'string', nullable: true, maxLength: 100 },
    locationSharingEnabled: { type: 'boolean' },
  },
};
