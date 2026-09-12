import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../common/constants/error-codes';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CallsRepository } from './calls.repository';
import { CallsService } from './calls.service';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const CALL = '55555555-5555-4555-8555-555555555555';
const REQUEST = '66666666-6666-4666-8666-666666666666';
const now = new Date('2030-01-01T00:00:00Z');

const callRow = (overrides: Record<string, unknown> = {}) => ({
  id: CALL,
  familyId: FAMILY,
  conversationId: CONVERSATION,
  callerUserId: A,
  calleeUserId: B,
  callType: 'voice',
  status: 'ringing',
  createdAt: now,
  expiresAt: new Date('2030-01-01T00:00:45Z'),
  acceptedAt: null,
  terminalAt: null,
  updatedAt: now,
  caller: { id: A, fullName: 'A', avatarUrl: null },
  callee: { id: B, fullName: 'B', avatarUrl: null },
  ...overrides,
});

describe('CallsService', () => {
  const setup = () => {
    const repository = {
      create: jest
        .fn()
        .mockResolvedValue({ outcome: 'created', call: callRow() }),
      transition: jest.fn().mockResolvedValue({
        outcome: 'updated',
        call: callRow({ status: 'accepted', acceptedAt: now }),
      }),
      listOwned: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(callRow()),
      resolveCurrentParticipants: jest
        .fn()
        .mockResolvedValue({ call: callRow(), userIds: [A, B] }),
    };
    const notifications = { processCall: jest.fn().mockResolvedValue([]) };
    const realtime = { emitToUser: jest.fn() };
    const config = { get: jest.fn().mockReturnValue(45) };
    return {
      repository,
      notifications,
      realtime,
      service: new CallsService(
        repository as unknown as CallsRepository,
        notifications as unknown as NotificationsService,
        realtime as unknown as RealtimeGateway,
        config as unknown as ConfigService,
      ),
    };
  };

  it.each(['voice', 'video'] as const)(
    'creates a server-scoped %s Call',
    async (callType) => {
      const { repository, service } = setup();
      await service.create(A, CONVERSATION, {
        clientRequestId: REQUEST,
        callType,
      });
      expect(repository.create).toHaveBeenCalledWith(
        A,
        CONVERSATION,
        { clientRequestId: REQUEST, callType },
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.any(Date),
      );
    },
  );

  it('creates durable Notification then private current-participant events', async () => {
    const { notifications, realtime, service } = setup();
    await service.create(A, CONVERSATION, {
      clientRequestId: REQUEST,
      callType: 'voice',
    });
    expect(notifications.processCall).toHaveBeenCalledWith(CALL);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      A,
      'call.created',
      expect.objectContaining({ id: CALL }),
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      B,
      'call.created',
      expect.objectContaining({ id: CALL }),
    );
  });

  it('does not duplicate Notification or realtime for an idempotent retry', async () => {
    const { repository, notifications, realtime, service } = setup();
    repository.create.mockResolvedValue({ outcome: 'reused', call: callRow() });
    await expect(
      service.create(A, CONVERSATION, {
        clientRequestId: REQUEST,
        callType: 'voice',
      }),
    ).resolves.toMatchObject({ id: CALL, created: false });
    expect(notifications.processCall).not.toHaveBeenCalled();
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it.each([
    ['forbidden', ErrorCode.CALL_NOT_FOUND],
    ['group', ErrorCode.GROUP_CALL_NOT_SUPPORTED],
    ['self', ErrorCode.CALL_INVALID_STATE],
    ['conflict', ErrorCode.CALL_IDEMPOTENCY_CONFLICT],
    ['busy', ErrorCode.CALL_PARTICIPANT_BUSY],
  ])('maps creation outcome %s to a stable code', async (outcome, code) => {
    const { repository, service } = setup();
    repository.create.mockResolvedValue({ outcome });
    await expect(
      service.create(A, CONVERSATION, {
        clientRequestId: REQUEST,
        callType: 'voice',
      }),
    ).rejects.toMatchObject({ code });
  });

  it('keeps a committed ringing Call when Notification and Socket fail', async () => {
    const { notifications, realtime, service } = setup();
    notifications.processCall.mockRejectedValue(new Error('fcm'));
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('socket');
    });
    await expect(
      service.create(A, CONVERSATION, {
        clientRequestId: REQUEST,
        callType: 'voice',
      }),
    ).resolves.toMatchObject({ status: 'ringing' });
  });

  it.each([
    ['accept', 'call.accepted'],
    ['reject', 'call.rejected'],
    ['cancel', 'call.cancelled'],
    ['end', 'call.ended'],
  ] as const)(
    'emits one private event for a durable %s transition',
    async (action, event) => {
      const { realtime, service } = setup();
      await service.transition(action === 'cancel' ? A : B, CALL, action);
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        A,
        event,
        expect.any(Object),
      );
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        B,
        event,
        expect.any(Object),
      );
    },
  );

  it('does not repeat lifecycle side effects for an identical action retry', async () => {
    const { repository, realtime, service } = setup();
    repository.transition.mockResolvedValue({
      outcome: 'unchanged',
      call: callRow({ status: 'accepted', acceptedAt: now }),
    });
    await expect(service.transition(B, CALL, 'accept')).resolves.toMatchObject({
      updated: false,
    });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', ErrorCode.CALL_NOT_FOUND],
    ['forbidden', ErrorCode.CALL_ACCESS_DENIED],
    ['invalid_state', ErrorCode.CALL_INVALID_STATE],
  ])('maps transition outcome %s to a stable code', async (outcome, code) => {
    const { repository, service } = setup();
    repository.transition.mockResolvedValue({ outcome, call: callRow() });
    await expect(service.transition(B, CALL, 'accept')).rejects.toMatchObject({
      code,
    });
  });

  it('persists expired as missed before returning CALL_EXPIRED', async () => {
    const { repository, realtime, service } = setup();
    repository.transition.mockResolvedValue({
      outcome: 'expired',
      call: callRow({ status: 'missed', terminalAt: now }),
    });
    await expect(service.transition(B, CALL, 'accept')).rejects.toMatchObject({
      code: ErrorCode.CALL_EXPIRED,
    });
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      A,
      'call.missed',
      expect.any(Object),
    );
  });

  it('derives signaling-session duration without claiming media talk-time', async () => {
    const { repository, service } = setup();
    repository.findOwned.mockResolvedValue(
      callRow({
        status: 'ended',
        acceptedAt: now,
        terminalAt: new Date(now.getTime() + 12_000),
      }),
    );
    await expect(service.detail(A, CALL)).resolves.toMatchObject({
      signalingSessionDurationSeconds: 12,
    });
  });

  it('preserves durable participant history after later Family removal', async () => {
    const { repository, service } = setup();
    await service.history(A, { limit: 30 });
    expect(repository.listOwned).toHaveBeenCalledWith(
      A,
      { limit: 30 },
      undefined,
    );
  });

  it('hides foreign Call detail with not-found semantics', async () => {
    const { repository, service } = setup();
    repository.findOwned.mockResolvedValue(null);
    await expect(service.detail(A, CALL)).rejects.toMatchObject({
      code: ErrorCode.CALL_NOT_FOUND,
    });
  });
});
