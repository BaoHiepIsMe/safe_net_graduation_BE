import { ErrorCode } from '../../common/constants/error-codes';
import { FirebaseService } from '../../infrastructure/firebase/firebase.service';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { PhoneManagementRepository } from './phone-management.repository';
import { PhoneManagementService } from './phone-management.service';

const MANAGER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const DEVICE = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const COMMAND = '66666666-6666-4666-8666-666666666666';
const now = new Date('2030-01-01T00:00:00Z');

const commandRow = (overrides: Record<string, unknown> = {}) => ({
  id: COMMAND,
  creatorUserId: MANAGER,
  familyId: FAMILY,
  memberId: MEMBER,
  targetDeviceId: DEVICE,
  commandType: 'lock',
  commandPayload: null,
  status: 'pending',
  resultCode: null,
  resultMessage: null,
  createdAt: now,
  sentAt: null,
  acknowledgedAt: null,
  updatedAt: now,
  ...overrides,
});

describe('PhoneManagementService', () => {
  const setup = () => {
    const repository = {
      createUsage: jest.fn().mockResolvedValue({
        outcome: 'created',
        usage: {
          id: REQUEST,
          memberId: MEMBER,
          deviceId: DEVICE,
          appName: 'App',
          appPackage: 'com.example.app',
          startedAt: new Date('2020-01-01T00:00:00Z'),
          endedAt: new Date('2020-01-01T00:10:00Z'),
          durationSeconds: 600,
          createdAt: now,
        },
      }),
      listOwnUsage: jest.fn().mockResolvedValue([]),
      listManagedUsage: jest
        .fn()
        .mockResolvedValue({ outcome: 'listed', rows: [] }),
      createRule: jest.fn().mockResolvedValue({
        outcome: 'created',
        rule: {
          id: REQUEST,
          familyId: FAMILY,
          memberId: MEMBER,
          dailyLimitMinutes: 120,
          bedtimeStart: null,
          bedtimeEnd: null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      }),
      listRules: jest.fn().mockResolvedValue({ outcome: 'listed', rules: [] }),
      listOwnRules: jest.fn().mockResolvedValue([]),
      updateRule: jest.fn(),
      deactivateRule: jest.fn(),
      createCommand: jest.fn().mockResolvedValue({
        outcome: 'created',
        command: commandRow(),
        targetUserId: MEMBER,
        fcmToken: 'private-token',
      }),
      markCommandSent: jest.fn().mockResolvedValue({ count: 1 }),
      clearInvalidToken: jest.fn().mockResolvedValue({ count: 1 }),
      listDeviceCommands: jest
        .fn()
        .mockResolvedValue({ outcome: 'listed', commands: [] }),
      listManagedCommands: jest
        .fn()
        .mockResolvedValue({ outcome: 'listed', commands: [] }),
      listMemberDevices: jest.fn().mockResolvedValue({
        outcome: 'listed',
        devices: [{ id: DEVICE, locked: true }],
      }),
      acknowledgeCommand: jest.fn().mockResolvedValue({
        outcome: 'updated',
        command: commandRow({ status: 'completed', acknowledgedAt: now }),
      }),
    };
    const realtime = { emitToUser: jest.fn() };
    const firebase = {
      sendDataMessage: jest.fn().mockResolvedValue({ status: 'success' }),
    };
    return {
      repository,
      realtime,
      firebase,
      service: new PhoneManagementService(
        repository as unknown as PhoneManagementRepository,
        realtime as unknown as RealtimeGateway,
        firebase as unknown as FirebaseService,
      ),
    };
  };

  it('persists authenticated Device usage with server-derived scope', async () => {
    const { repository, service } = setup();
    const result = await service.submitUsage(MEMBER, FAMILY, MEMBER, DEVICE, {
      clientRecordId: REQUEST,
      appPackage: 'com.example.app',
      startedAt: '2020-01-01T00:00:00Z',
      endedAt: '2020-01-01T00:10:00Z',
      durationSeconds: 600,
    });
    expect(repository.createUsage).toHaveBeenCalledWith(
      MEMBER,
      FAMILY,
      MEMBER,
      DEVICE,
      expect.any(Object),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(result).toMatchObject({ source: 'managed_device_app' });
  });

  it('denies foreign/inactive telemetry targets and conflicting retries', async () => {
    const { repository, service } = setup();
    repository.createUsage.mockResolvedValueOnce({ outcome: 'invalid_target' });
    await expect(
      service.submitUsage(MEMBER, FAMILY, MEMBER, DEVICE, {
        clientRecordId: REQUEST,
        appPackage: 'com.example.app',
        startedAt: '2020-01-01T00:00:00Z',
        endedAt: '2020-01-01T00:00:01Z',
        durationSeconds: 1,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PHONE_USAGE_ACCESS_DENIED });
    repository.createUsage.mockResolvedValueOnce({ outcome: 'conflict' });
    await expect(
      service.submitUsage(MEMBER, FAMILY, MEMBER, DEVICE, {
        clientRecordId: REQUEST,
        appPackage: 'com.example.app',
        startedAt: '2020-01-01T00:00:00Z',
        endedAt: '2020-01-01T00:00:01Z',
        durationSeconds: 1,
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PHONE_USAGE_INVALID_RECORD });
  });

  it('creates policy intent without claiming Device enforcement', async () => {
    const { service } = setup();
    await expect(
      service.createRule(MANAGER, FAMILY, MEMBER, { dailyLimitMinutes: 120 }),
    ).resolves.toMatchObject({
      dailyLimitMinutes: 120,
      enforcementStatus: 'device_enforcement_pending',
    });
  });

  it('maps current manager/target revocation to access denial', async () => {
    const { repository, service } = setup();
    repository.listRules.mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      service.listRules(MANAGER, FAMILY, MEMBER),
    ).rejects.toMatchObject({ code: ErrorCode.PHONE_RULE_ACCESS_DENIED });
  });

  it('commits command before private transport and never treats FCM as execution', async () => {
    const { repository, realtime, firebase, service } = setup();
    const result = await service.createCommand(
      MANAGER,
      FAMILY,
      MEMBER,
      DEVICE,
      { clientRequestId: REQUEST, commandType: 'lock' },
    );
    expect(repository.createCommand).toHaveBeenCalledTimes(1);
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      MEMBER,
      'phone_command.created',
      {
        commandId: COMMAND,
        commandType: 'lock',
        deviceId: DEVICE,
      },
    );
    expect(firebase.sendDataMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'private-token',
        data: {
          type: 'phone_command',
          commandId: COMMAND,
          commandType: 'lock',
        },
      }),
    );
    // Silent: a banner on the child's phone is not the command running.
    expect(firebase.sendDataMessage.mock.calls[0][0]).not.toHaveProperty(
      'title',
    );
    expect(repository.markCommandSent).toHaveBeenCalledWith(COMMAND);
    expect(result.status).toBe('sent');
    expect(result.status).not.toBe('completed');
    expect(JSON.stringify(result)).not.toContain('private-token');
  });

  it('keeps a committed command pending when FCM and Socket fail', async () => {
    const { realtime, firebase, repository, service } = setup();
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('socket unavailable');
    });
    firebase.sendDataMessage.mockResolvedValue({ status: 'failure' });
    const result = await service.createCommand(
      MANAGER,
      FAMILY,
      MEMBER,
      DEVICE,
      { clientRequestId: REQUEST, commandType: 'ring' },
    );
    expect(result.status).toBe('pending');
    expect(repository.markCommandSent).not.toHaveBeenCalled();
  });

  it('does not redeliver a reused idempotent command', async () => {
    const { repository, realtime, firebase, service } = setup();
    repository.createCommand.mockResolvedValue({
      outcome: 'reused',
      command: commandRow(),
      targetUserId: MEMBER,
      fcmToken: 'private-token',
    });
    await service.createCommand(MANAGER, FAMILY, MEMBER, DEVICE, {
      clientRequestId: REQUEST,
      commandType: 'lock',
    });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
    expect(firebase.sendDataMessage).not.toHaveBeenCalled();
  });

  it('clears only a permanently invalid token without deleting the command', async () => {
    const { firebase, repository, service } = setup();
    firebase.sendDataMessage.mockResolvedValue({
      status: 'failure',
      invalidToken: true,
    });
    const result = await service.createCommand(
      MANAGER,
      FAMILY,
      MEMBER,
      DEVICE,
      { clientRequestId: REQUEST, commandType: 'lock' },
    );
    expect(repository.clearInvalidToken).toHaveBeenCalledWith(
      DEVICE,
      'private-token',
    );
    expect(result.status).toBe('pending');
  });

  it('marks terminal success only from repository-authorized Device ACK', async () => {
    const { service } = setup();
    await expect(
      service.acknowledgeCommand(MEMBER, DEVICE, COMMAND, {
        status: 'completed',
      }),
    ).resolves.toMatchObject({ status: 'completed', acknowledgedAt: now });
  });

  it('tells the manager who sent the command what the Device did', async () => {
    const { realtime, service } = setup();
    await service.acknowledgeCommand(MEMBER, DEVICE, COMMAND, {
      status: 'completed',
    });
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      MANAGER,
      'phone_command.updated',
      expect.objectContaining({
        commandId: COMMAND,
        memberId: MEMBER,
        deviceId: DEVICE,
        commandType: 'lock',
        status: 'completed',
      }),
    );
  });

  it('does not re-announce an idempotent repeated ACK', async () => {
    const { repository, realtime, service } = setup();
    repository.acknowledgeCommand.mockResolvedValue({
      outcome: 'unchanged',
      command: commandRow({ status: 'completed', acknowledgedAt: now }),
    });
    await service.acknowledgeCommand(MEMBER, DEVICE, COMMAND, {
      status: 'completed',
    });
    expect(realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('keeps the committed ACK when the realtime emit fails', async () => {
    const { realtime, service } = setup();
    realtime.emitToUser.mockImplementation(() => {
      throw new Error('socket down');
    });
    await expect(
      service.acknowledgeCommand(MEMBER, DEVICE, COMMAND, {
        status: 'completed',
      }),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('rejects a conflicting terminal ACK', async () => {
    const { repository, service } = setup();
    repository.acknowledgeCommand.mockResolvedValue({
      outcome: 'invalid_state',
    });
    await expect(
      service.acknowledgeCommand(MEMBER, DEVICE, COMMAND, {
        status: 'failed',
        resultCode: 'FAILED',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.PHONE_COMMAND_INVALID_STATE });
  });

  it('lists managed child Devices and denies everyone else', async () => {
    const { repository, service } = setup();
    await expect(
      service.listMemberDevices(MANAGER, FAMILY, MEMBER),
    ).resolves.toEqual([{ id: DEVICE, locked: true }]);
    repository.listMemberDevices.mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      service.listMemberDevices(MEMBER, FAMILY, MEMBER),
    ).rejects.toMatchObject({ code: ErrorCode.PHONE_COMMAND_ACCESS_DENIED });
  });
});
