import { successSchema } from '../../common/swagger/api-docs';

const nullableString = { type: 'string', nullable: true };
const dateTime = { type: 'string', format: 'date-time', nullable: true };
const uuidArray = {
  type: 'array',
  items: { type: 'string', format: 'uuid' },
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
    'husband',
    'wife',
    'brother',
    'sister',
    'grandchild',
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
    familyLabel: label,
    isOwner: { type: 'boolean' },
    canManageCare: { type: 'boolean' },
    isCareRecipient: { type: 'boolean' },
    isMinor: { type: 'boolean' },
    isHired: { type: 'boolean' },
    careScopeMemberIds: uuidArray,
  },
};

export const familyMemberDataSchema = {
  type: 'object',
  required: [
    'id',
    'familyId',
    'userId',
    'familyLabel',
    'status',
    'isOwner',
    'canManageCare',
    'isCareRecipient',
    'isMinor',
    'isHired',
    'careScopeMemberIds',
    'locationSharingEnabled',
    'profile',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    familyLabel: label,
    displayName: nullableString,
    status: {
      type: 'string',
      enum: ['pending', 'requested', 'accepted', 'rejected', 'removed'],
    },
    isOwner: { type: 'boolean' },
    canManageCare: { type: 'boolean' },
    isCareRecipient: { type: 'boolean' },
    isMinor: { type: 'boolean' },
    isHired: { type: 'boolean' },
    careScopeMemberIds: uuidArray,
    locationSharingEnabled: { type: 'boolean' },
    invitedAt: dateTime,
    acceptedAt: dateTime,
    createdAt: dateTime,
    updatedAt: dateTime,
    profile: {
      type: 'object',
      required: ['id', 'fullName', 'avatarUrl', 'gender'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: nullableString,
        avatarUrl: nullableString,
        gender: {
          type: 'string',
          enum: ['male', 'female', 'other'],
          nullable: true,
          description: 'null khi thành viên chưa chấp nhận lời mời',
        },
      },
    },
  },
};

export const pendingInvitationDataSchema = {
  type: 'object',
  required: [
    'id',
    'familyLabel',
    'canManageCare',
    'isCareRecipient',
    'isMinor',
    'isHired',
    'careScopeMemberIds',
    'careManagers',
    'family',
    'invitedBy',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyLabel: label,
    displayName: nullableString,
    canManageCare: { type: 'boolean' },
    isCareRecipient: { type: 'boolean' },
    isMinor: { type: 'boolean' },
    isHired: { type: 'boolean' },
    careScopeMemberIds: uuidArray,
    careManagers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          familyLabel: label,
          displayName: nullableString,
          isHired: { type: 'boolean' },
          fullName: nullableString,
          avatarUrl: nullableString,
        },
      },
    },
    invitedAt: dateTime,
    expiresAt: dateTime,
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
    requestedAt: dateTime,
    expiresAt: dateTime,
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
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
    canManageCare: { type: 'boolean' },
    isCareRecipient: {
      type: 'boolean',
      description:
        'Bỏ trống để tự theo tuổi khi nhận lời mời (từ 60 tuổi -> true)',
    },
    careScopeMemberIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      minItems: 1,
      description: 'Bắt buộc khi familyLabel = caregiver',
    },
  },
  oneOf: [{ required: ['email'] }, { required: ['phoneNumber'] }],
};

export const updateFamilyMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    familyLabel: label,
    displayName: { type: 'string', nullable: true, maxLength: 100 },
    canManageCare: { type: 'boolean' },
    isCareRecipient: { type: 'boolean' },
    careScopeMemberIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      minItems: 1,
    },
    locationSharingEnabled: { type: 'boolean' },
  },
};

export const approveJoinRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    familyLabel: label,
    displayName: { type: 'string', nullable: true, maxLength: 100 },
    canManageCare: { type: 'boolean' },
    isCareRecipient: {
      type: 'boolean',
      description: 'Bỏ trống để tự theo tuổi (từ 60 tuổi -> true)',
    },
    careScopeMemberIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      minItems: 1,
      description: 'Bắt buộc khi familyLabel = caregiver',
    },
  },
};

const inviteCodeDataSchema = {
  type: 'object',
  required: ['code', 'expiresAt'],
  properties: {
    code: { type: 'string', minLength: 8, maxLength: 8, example: 'K7M2QX9P' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};
export const inviteCodeSuccessSchema = successSchema(inviteCodeDataSchema);

export const joinPreviewDataSchema = {
  type: 'object',
  required: ['familyId', 'familyName', 'avatarUrl', 'memberCount', 'owner'],
  properties: {
    familyId: { type: 'string', format: 'uuid' },
    familyName: { type: 'string' },
    avatarUrl: nullableString,
    memberCount: { type: 'integer', minimum: 1 },
    owner: {
      type: 'object',
      required: ['userId', 'fullName', 'displayName', 'avatarUrl'],
      properties: {
        userId: { type: 'string', format: 'uuid' },
        fullName: nullableString,
        displayName: nullableString,
        avatarUrl: nullableString,
      },
    },
  },
};
export const joinPreviewSuccessSchema = successSchema(joinPreviewDataSchema);

export const joinRequestDataSchema = {
  type: 'object',
  required: [
    'id',
    'familyId',
    'userId',
    'familyLabel',
    'status',
    'isMinor',
    'isSenior',
    'requestedAt',
    'expiresAt',
    'profile',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    familyLabel: label,
    displayName: nullableString,
    status: { type: 'string', enum: ['requested'] },
    isMinor: { type: 'boolean' },
    isSenior: { type: 'boolean' },
    requestedAt: dateTime,
    expiresAt: dateTime,
    profile: {
      type: 'object',
      required: ['id', 'fullName', 'avatarUrl', 'gender'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: nullableString,
        avatarUrl: nullableString,
        gender: {
          type: 'string',
          enum: ['male', 'female', 'other'],
          nullable: true,
        },
      },
    },
  },
};

export const ownJoinRequestDataSchema = {
  type: 'object',
  required: [
    'id',
    'familyId',
    'userId',
    'familyLabel',
    'status',
    'requestedAt',
    'expiresAt',
    'family',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    familyLabel: label,
    displayName: nullableString,
    status: { type: 'string', enum: ['requested'] },
    requestedAt: dateTime,
    expiresAt: dateTime,
    family: {
      ...familyDataSchema,
      properties: {
        ...familyDataSchema.properties,
        owner: {
          type: 'object',
          nullable: true,
          properties: {
            userId: { type: 'string', format: 'uuid' },
            fullName: nullableString,
            avatarUrl: nullableString,
          },
        },
      },
    },
  },
};

export const sentInvitationDataSchema = {
  ...familyMemberDataSchema,
  required: [...familyMemberDataSchema.required, 'expiresAt', 'isExpired'],
  properties: {
    ...familyMemberDataSchema.properties,
    expiresAt: dateTime,
    isExpired: { type: 'boolean' },
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
export const sentInvitationSuccessSchema = successSchema(
  sentInvitationDataSchema,
);

export const joinFamilyBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'familyLabel'],
  properties: {
    code: {
      type: 'string',
      minLength: 1,
      maxLength: 20,
      description: 'Không phân biệt hoa thường, bỏ khoảng trắng hai đầu',
    },
    familyLabel: label,
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
  },
};

export const transferOwnershipBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memberId'],
  properties: { memberId: { type: 'string', format: 'uuid' } },
};
