import { RealtimeGateway } from './realtime.gateway';
import { SupabaseService } from '../supabase/supabase.service';
import { RealtimeRoomAuthorizationService } from './realtime-room-authorization.service';
import { ErrorCode } from '../../common/constants/error-codes';
import { ModuleRef } from '@nestjs/core';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = '33333333-3333-4333-8333-333333333333';
const CALL_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

describe('RealtimeGateway', () => {
  const supabase = { verifyToken: jest.fn() };
  const roomAuthorization = { authorize: jest.fn() };
  const signaling = { authorize: jest.fn() };
  const moduleRef = { get: jest.fn().mockReturnValue(signaling) };
  let gateway: RealtimeGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new RealtimeGateway(
      supabase as unknown as SupabaseService,
      roomAuthorization as unknown as RealtimeRoomAuthorizationService,
      moduleRef as unknown as ModuleRef,
    );
  });

  it('relays an authorized bounded offer only to the derived participant', async () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    (gateway as any).server = { to };
    const client: any = {
      id: 'socket-1',
      handshake: { auth: { token: 'verified' }, headers: {} },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    supabase.verifyToken.mockResolvedValue({ id: USER_ID });
    signaling.authorize.mockResolvedValue({ targetUserId: OTHER_ID });
    await gateway.handleConnection(client);
    const result = await gateway.handleCallSignal(client, {
      callId: CALL_ID,
      signalType: 'offer',
      payload: { type: 'offer', sdp: 'v=0' },
    });
    expect(signaling.authorize).toHaveBeenCalledWith(USER_ID, CALL_ID, 'offer');
    expect(to).toHaveBeenCalledWith(`user:${OTHER_ID}`);
    expect(emit).toHaveBeenCalledWith(
      'call.signal',
      expect.objectContaining({
        callId: CALL_ID,
        fromUserId: USER_ID,
      }),
    );
    expect(result.success).toBe(true);
  });

  it.each([
    [
      'target override',
      {
        callId: CALL_ID,
        signalType: 'offer',
        payload: { type: 'offer', sdp: 'v=0' },
        targetUserId: OTHER_ID,
      },
    ],
    ['unknown signal', { callId: CALL_ID, signalType: 'custom', payload: {} }],
    [
      'oversized SDP',
      {
        callId: CALL_ID,
        signalType: 'offer',
        payload: { type: 'offer', sdp: 'x'.repeat(16_385) },
      },
    ],
  ])('rejects invalid signaling: %s', async (_label, payload) => {
    const client: any = {
      id: 'socket-1',
      handshake: { auth: { token: 'verified' }, headers: {} },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    supabase.verifyToken.mockResolvedValue({ id: USER_ID });
    await gateway.handleConnection(client);
    const result: any = await gateway.handleCallSignal(client, payload);
    expect(result.error.code).toBe(ErrorCode.CALL_SIGNAL_INVALID);
  });

  it('rejects unrelated, terminal or membership-revoked signaling', async () => {
    const client: any = {
      id: 'socket-1',
      handshake: { auth: { token: 'verified' }, headers: {} },
      join: jest.fn(),
      disconnect: jest.fn(),
    };
    supabase.verifyToken.mockResolvedValue({ id: USER_ID });
    signaling.authorize.mockResolvedValue(null);
    await gateway.handleConnection(client);
    const result: any = await gateway.handleCallSignal(client, {
      callId: CALL_ID,
      signalType: 'ice_candidate',
      payload: { candidate: 'candidate:bounded' },
    });
    expect(result.error.code).toBe(ErrorCode.CALL_SIGNAL_NOT_ALLOWED);
  });

  it('disconnects an unauthenticated socket', async () => {
    const client: any = {
      id: 'socket-1',
      handshake: { auth: {}, headers: {} },
      disconnect: jest.fn(),
    };
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalled();
  });

  it('joins only a room approved by the authorization service', async () => {
    const client: any = {
      id: 'socket-1',
      handshake: { auth: { token: 'verified' }, headers: {} },
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    supabase.verifyToken.mockResolvedValue({ id: USER_ID });
    roomAuthorization.authorize.mockResolvedValue({
      type: 'family',
      resourceId: FAMILY_ID,
      name: `family:${FAMILY_ID}`,
    });
    await gateway.handleConnection(client);
    const result = await gateway.handleJoinRoom(client, {
      room: `family:${FAMILY_ID}`,
    });
    expect(client.join).toHaveBeenCalledWith(`family:${FAMILY_ID}`);
    expect(result.success).toBe(true);
  });

  it('returns a stable denial without joining unauthorized rooms', async () => {
    const client: any = {
      id: 'socket-1',
      handshake: { auth: { token: 'verified' }, headers: {} },
      join: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    supabase.verifyToken.mockResolvedValue({ id: USER_ID });
    roomAuthorization.authorize.mockResolvedValue(null);
    await gateway.handleConnection(client);
    client.join.mockClear();
    const result: any = await gateway.handleJoinRoom(client, {
      room: `family:${FAMILY_ID}`,
    });
    expect(client.join).not.toHaveBeenCalled();
    expect(result.error.code).toBe(ErrorCode.REALTIME_ROOM_ACCESS_DENIED);
  });
});
