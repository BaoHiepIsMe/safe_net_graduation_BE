import { z } from 'zod';
import {
  CALL_DEFAULT_LIMIT,
  CALL_MAX_ICE_CANDIDATE_LENGTH,
  CALL_MAX_LIMIT,
  CALL_MAX_SDP_LENGTH,
} from '../calls.constants';

const uuid = z.string().uuid();

export const conversationCallParamSchema = z
  .object({ conversationId: uuid })
  .strict();
export const callParamSchema = z.object({ callId: uuid }).strict();

export const createCallSchema = z
  .object({
    clientRequestId: uuid,
    callType: z.enum(['voice', 'video']),
  })
  .strict();

export const emptyCallActionSchema = z.object({}).strict();

export const callHistoryQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CALL_MAX_LIMIT)
      .default(CALL_DEFAULT_LIMIT),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(256)
      .optional(),
  })
  .strict();

const sdpPayloadSchema = z
  .object({
    type: z.enum(['offer', 'answer']),
    sdp: z.string().min(1).max(CALL_MAX_SDP_LENGTH),
  })
  .strict();
const icePayloadSchema = z
  .object({
    candidate: z.string().min(1).max(CALL_MAX_ICE_CANDIDATE_LENGTH),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strict();

export const callSignalSchema = z.discriminatedUnion('signalType', [
  z
    .object({
      callId: uuid,
      signalType: z.literal('offer'),
      payload: sdpPayloadSchema.refine((value) => value.type === 'offer'),
    })
    .strict(),
  z
    .object({
      callId: uuid,
      signalType: z.literal('answer'),
      payload: sdpPayloadSchema.refine((value) => value.type === 'answer'),
    })
    .strict(),
  z
    .object({
      callId: uuid,
      signalType: z.literal('ice_candidate'),
      payload: icePayloadSchema,
    })
    .strict(),
]);

export type ConversationCallParam = z.infer<typeof conversationCallParamSchema>;
export type CallParam = z.infer<typeof callParamSchema>;
export type CreateCallDto = z.infer<typeof createCallSchema>;
export type CallHistoryQueryDto = z.infer<typeof callHistoryQuerySchema>;
export type CallSignalDto = z.infer<typeof callSignalSchema>;

export interface CallCursor {
  createdAt: Date;
  id: string;
}
