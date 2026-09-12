import {
  callHistoryQuerySchema,
  callSignalSchema,
  createCallSchema,
  emptyCallActionSchema,
} from './call.dto';

const ID = '11111111-1111-4111-8111-111111111111';

describe('Phase 13 Call DTO validation', () => {
  it.each(['voice', 'video'] as const)(
    'accepts supported %s Call creation',
    (callType) => {
      expect(createCallSchema.parse({ clientRequestId: ID, callType })).toEqual(
        {
          clientRequestId: ID,
          callType,
        },
      );
    },
  );

  it.each([
    { clientRequestId: ID, callType: 'group' },
    { clientRequestId: ID, callType: 'voice', callerId: ID },
    { clientRequestId: ID, callType: 'voice', calleeId: ID },
    { clientRequestId: ID, callType: 'voice', status: 'accepted' },
    { clientRequestId: ID, callType: 'voice', durationSeconds: 1 },
    {
      clientRequestId: ID,
      callType: 'voice',
      startedAt: new Date().toISOString(),
    },
  ])('rejects unsupported or client-controlled Call creation', (body) => {
    expect(createCallSchema.safeParse(body).success).toBe(false);
  });

  it('accepts only an empty lifecycle action body', () => {
    expect(emptyCallActionSchema.parse({})).toEqual({});
    expect(emptyCallActionSchema.safeParse({ status: 'ended' }).success).toBe(
      false,
    );
  });

  it('bounds history pagination', () => {
    expect(callHistoryQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(callHistoryQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
  });

  it('accepts a bounded caller offer without target routing', () => {
    expect(
      callSignalSchema.safeParse({
        callId: ID,
        signalType: 'offer',
        payload: { type: 'offer', sdp: 'v=0' },
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      callId: ID,
      signalType: 'offer',
      payload: { type: 'offer', sdp: 'v=0' },
      targetUserId: ID,
    },
    {
      callId: ID,
      signalType: 'answer',
      payload: { type: 'offer', sdp: 'v=0' },
    },
    { callId: ID, signalType: 'custom', payload: {} },
    {
      callId: ID,
      signalType: 'offer',
      payload: { type: 'offer', sdp: 'x'.repeat(16_385) },
    },
    {
      callId: ID,
      signalType: 'ice_candidate',
      payload: { candidate: 'x'.repeat(2_049) },
    },
    {
      callId: ID,
      signalType: 'ice_candidate',
      payload: { candidate: 'safe', privateIp: '10.0.0.1' },
    },
  ])('rejects unsafe signaling payloads', (payload) => {
    expect(callSignalSchema.safeParse(payload).success).toBe(false);
  });
});
