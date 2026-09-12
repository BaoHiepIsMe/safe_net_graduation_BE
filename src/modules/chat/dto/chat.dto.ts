import { z } from 'zod';
import {
  CHAT_DEFAULT_LIMIT,
  CHAT_MAX_GROUP_MEMBERS,
  CHAT_MAX_LIMIT,
  CHAT_MAX_MESSAGE_LENGTH,
} from '../chat.constants';

const uuid = z.string().uuid();
const cursor = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(256)
  .optional();
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(CHAT_MAX_LIMIT)
  .default(CHAT_DEFAULT_LIMIT);

export const familyParamSchema = z.object({ familyId: uuid }).strict();
export const conversationParamSchema = z
  .object({ conversationId: uuid })
  .strict();
export const conversationMemberParamSchema = z
  .object({ conversationId: uuid, memberId: uuid })
  .strict();

export const createDirectSchema = z.object({ targetMemberId: uuid }).strict();
export const createGroupSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    memberIds: z
      .array(uuid)
      .min(1)
      .max(CHAT_MAX_GROUP_MEMBERS)
      .refine((values) => new Set(values).size === values.length, {
        message: 'Duplicate group members are not allowed',
      }),
  })
  .strict();
export const addGroupMemberSchema = z.object({ memberId: uuid }).strict();

export const sendMessageSchema = z
  .object({
    clientMessageId: uuid,
    content: z.string().trim().min(1).max(CHAT_MAX_MESSAGE_LENGTH),
  })
  .strict();

export const markReadSchema = z.object({ lastReadMessageId: uuid }).strict();

export const chatListQuerySchema = z.object({ limit, cursor }).strict();

export type FamilyParam = z.infer<typeof familyParamSchema>;
export type ConversationParam = z.infer<typeof conversationParamSchema>;
export type ConversationMemberParam = z.infer<
  typeof conversationMemberParamSchema
>;
export type CreateDirectDto = z.infer<typeof createDirectSchema>;
export type CreateGroupDto = z.infer<typeof createGroupSchema>;
export type AddGroupMemberDto = z.infer<typeof addGroupMemberSchema>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
export type MarkReadDto = z.infer<typeof markReadSchema>;
export type ChatListQueryDto = z.infer<typeof chatListQuerySchema>;

export interface ChatCursor {
  createdAt: Date;
  id: string;
}
