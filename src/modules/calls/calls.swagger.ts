export const createCallBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['clientRequestId', 'callType'],
  properties: {
    clientRequestId: { type: 'string', format: 'uuid' },
    callType: { type: 'string', enum: ['voice', 'video'] },
  },
};

export const callSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    familyId: { type: 'string', format: 'uuid' },
    conversationId: { type: 'string', format: 'uuid' },
    callType: { type: 'string', enum: ['voice', 'video'] },
    status: {
      type: 'string',
      enum: ['ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended'],
      description:
        'accepted means user acceptance, not verified media connectivity',
    },
    caller: { type: 'object' },
    callee: { type: 'object' },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    acceptedAt: { type: 'string', format: 'date-time', nullable: true },
    terminalAt: { type: 'string', format: 'date-time', nullable: true },
    signalingSessionDurationSeconds: { type: 'integer', nullable: true },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
