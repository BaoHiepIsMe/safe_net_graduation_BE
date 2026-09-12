import { successSchema } from '../../common/swagger/api-docs';

export const chatMemberSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'fullName', 'avatarUrl', 'joinedAt'],
  properties: {
    userId: { type: 'string', format: 'uuid' },
    fullName: { type: 'string' },
    avatarUrl: { type: 'string', nullable: true },
    joinedAt: { type: 'string', format: 'date-time', nullable: true },
  },
};

export const chatMessageSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'conversationId', 'type', 'content', 'sender', 'createdAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    conversationId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['text'] },
    content: { type: 'string' },
    sender: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'fullName', 'avatarUrl'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        fullName: { type: 'string' },
        avatarUrl: { type: 'string', nullable: true },
      },
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

export const chatObjectSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'familyId',
    'type',
    'title',
    'participants',
    'latestMessage',
    'unreadCount',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    type: { type: 'string', enum: ['direct', 'group'] },
    title: { type: 'string', nullable: true },
    participants: { type: 'array', items: chatMemberSchema },
    latestMessage: { ...chatMessageSchema, nullable: true },
    unreadCount: { type: 'integer', minimum: 0 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const cursorPaginationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['limit', 'hasMore', 'nextCursor'],
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    hasMore: { type: 'boolean' },
    nextCursor: { type: 'string', nullable: true },
  },
};

export const conversationSuccessSchema = successSchema(chatObjectSchema);
export const directConversationSuccessSchema = successSchema({
  type: 'object',
  additionalProperties: false,
  required: ['conversation', 'created'],
  properties: {
    conversation: chatObjectSchema,
    created: { type: 'boolean' },
  },
});
export const conversationPageSuccessSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'message', 'data', 'pagination'],
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Thành công' },
    data: { type: 'array', items: chatObjectSchema },
    pagination: cursorPaginationSchema,
  },
};
export const memberListSuccessSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'message', 'data'],
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Thành công' },
    data: { type: 'array', items: chatMemberSchema },
  },
};
export const messageSuccessSchema = successSchema({
  ...chatMessageSchema,
  required: [...chatMessageSchema.required, 'created'],
  properties: {
    ...chatMessageSchema.properties,
    created: { type: 'boolean' },
  },
});
export const messagePageSuccessSchema = {
  ...conversationPageSuccessSchema,
  properties: {
    ...conversationPageSuccessSchema.properties,
    data: { type: 'array', items: chatMessageSchema },
  },
};
export const readCursorSuccessSchema = successSchema({
  type: 'object',
  additionalProperties: false,
  required: ['conversationId', 'lastReadMessageId', 'lastReadAt', 'updated'],
  properties: {
    conversationId: { type: 'string', format: 'uuid' },
    lastReadMessageId: { type: 'string', format: 'uuid', nullable: true },
    lastReadAt: { type: 'string', format: 'date-time', nullable: true },
    updated: { type: 'boolean' },
  },
});
export const unreadCountSuccessSchema = successSchema({
  type: 'object',
  additionalProperties: false,
  required: ['count'],
  properties: { count: { type: 'integer', minimum: 0 } },
});

export const directBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['targetMemberId'],
  properties: { targetMemberId: { type: 'string', format: 'uuid' } },
};
export const groupBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'memberIds'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100 },
    memberIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
  },
};
export const addMemberBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['memberId'],
  properties: { memberId: { type: 'string', format: 'uuid' } },
};
export const messageBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientMessageId', 'content'],
  properties: {
    clientMessageId: { type: 'string', format: 'uuid' },
    content: { type: 'string', minLength: 1, maxLength: 4000 },
  },
};
export const readBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['lastReadMessageId'],
  properties: { lastReadMessageId: { type: 'string', format: 'uuid' } },
};
