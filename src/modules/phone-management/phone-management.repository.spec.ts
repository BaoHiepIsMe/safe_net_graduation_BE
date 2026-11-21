import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PhoneManagementRepository } from './phone-management.repository';

const MANAGER = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const FAMILY = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const DEVICE = '55555555-5555-4555-8555-555555555555';
const REQUEST = '66666666-6666-4666-8666-666666666666';
const COMMAND = '77777777-7777-4777-8777-777777777777';
const now = new Date('2030-01-01T00:00:00Z');

describe('PhoneManagementRepository', () => {
  const setup = () => {
    const usage = {
      id: REQUEST,
      memberId: MEMBER,
      deviceId: DEVICE,
      appName: null,
      appPackage: 'com.example.app',
      startedAt: now,
      endedAt: now,
      durationSeconds: 0,
      createdAt: now,
    };
    const command = {
      id: COMMAND,
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
    };
    const tx = {
      $queryRaw: jest.fn(),
      familyMember: { findFirst: jest.fn() },
      device: { findFirst: jest.fn() },
      phoneUsageLog: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(usage),
      },
      phoneRule: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      phoneCommand: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue(command),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      familyMember: { findFirst: jest.fn() },
      device: { findFirst: jest.fn(), updateMany: jest.fn() },
      phoneUsageLog: { findMany: jest.fn() },
      phoneRule: { findMany: jest.fn() },
      phoneCommand: { findMany: jest.fn(), updateMany: jest.fn() },
    };
    return {
      usage,
      command,
      tx,
      prisma,
      repository: new PhoneManagementRepository(
        prisma as unknown as PrismaService,
      ),
    };
  };

  it('accepts telemetry only for the authenticated accepted child and owned active Device', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue({
      id: MEMBER,
      profile: { dateOfBirth: new Date('2016-01-01T00:00:00Z') },
    });
    tx.device.findFirst.mockResolvedValue({ id: DEVICE });
    await expect(
      repository.createUsage(
        CHILD,
        FAMILY,
        MEMBER,
        DEVICE,
        {
          clientRecordId: REQUEST,
          appPackage: 'com.example.app',
          startedAt: now.toISOString(),
          endedAt: now.toISOString(),
          durationSeconds: 0,
        },
        'a'.repeat(64),
      ),
    ).resolves.toMatchObject({ outcome: 'created' });
    expect(tx.familyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: MEMBER,
          userId: CHILD,
          familyId: FAMILY,
          status: 'accepted',
        }),
      }),
    );
    expect(tx.device.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEVICE, userId: CHILD, isActive: true },
      }),
    );
  });

  it('denies foreign or inactive telemetry before insert', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue(null);
    tx.device.findFirst.mockResolvedValue(null);
    const result = await repository.createUsage(
      CHILD,
      FAMILY,
      MEMBER,
      DEVICE,
      {
        clientRecordId: REQUEST,
        appPackage: 'com.example.app',
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        durationSeconds: 0,
      },
      'a'.repeat(64),
    );
    expect(result).toEqual({ outcome: 'invalid_target' });
    expect(tx.phoneUsageLog.create).not.toHaveBeenCalled();
  });

  it('reuses identical telemetry retry and rejects conflicting reuse', async () => {
    const { tx, usage, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue({
      id: MEMBER,
      profile: { dateOfBirth: new Date('2016-01-01T00:00:00Z') },
    });
    tx.device.findFirst.mockResolvedValue({ id: DEVICE });
    tx.phoneUsageLog.findUnique.mockResolvedValue({
      ...usage,
      requestFingerprint: 'a'.repeat(64),
    });
    const dto = {
      clientRecordId: REQUEST,
      appPackage: 'com.example.app',
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      durationSeconds: 0,
    };
    await expect(
      repository.createUsage(
        CHILD,
        FAMILY,
        MEMBER,
        DEVICE,
        dto,
        'a'.repeat(64),
      ),
    ).resolves.toMatchObject({ outcome: 'reused' });
    await expect(
      repository.createUsage(
        CHILD,
        FAMILY,
        MEMBER,
        DEVICE,
        dto,
        'b'.repeat(64),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(tx.phoneUsageLog.create).not.toHaveBeenCalled();
  });

  it('requires a current manager, accepted child and owned active target for command creation', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst
      .mockResolvedValueOnce({
        id: MANAGER,
        userId: 'manager-user',
        canManageCare: true,
        isHired: false,
        careScopes: [],
        family: { ownerUserId: 'manager-user' },
      })
      .mockResolvedValueOnce({
        id: MEMBER,
        userId: CHILD,
        profile: { dateOfBirth: new Date('2016-01-01T00:00:00Z') },
      });
    tx.device.findFirst.mockResolvedValue({ id: DEVICE, fcmToken: 'secret' });
    await expect(
      repository.createCommand(
        MANAGER,
        FAMILY,
        MEMBER,
        DEVICE,
        { clientRequestId: REQUEST, commandType: 'lock' },
        'a'.repeat(64),
      ),
    ).resolves.toMatchObject({
      outcome: 'created',
      targetUserId: CHILD,
      fcmToken: 'secret',
    });
    expect(tx.phoneCommand.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: FAMILY,
          memberId: MEMBER,
          targetDeviceId: DEVICE,
          creatorUserId: MANAGER,
        }),
      }),
    );
  });

  it('prevents former managers and adult/removed targets from creating commands', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue(null);
    await expect(
      repository.createCommand(
        MANAGER,
        FAMILY,
        MEMBER,
        DEVICE,
        { clientRequestId: REQUEST, commandType: 'ring' },
        'a'.repeat(64),
      ),
    ).resolves.toEqual({ outcome: 'forbidden' });
    expect(tx.phoneCommand.create).not.toHaveBeenCalled();
  });

  it('allows only the owned active target Device to ACK', async () => {
    const { tx, repository } = setup();
    tx.device.findFirst.mockResolvedValue(null);
    await expect(
      repository.acknowledgeCommand(CHILD, DEVICE, COMMAND, {
        status: 'completed',
      }),
    ).resolves.toEqual({ outcome: 'forbidden' });
    expect(tx.phoneCommand.update).not.toHaveBeenCalled();
  });

  it('makes identical terminal ACK retry idempotent and rejects conflicts', async () => {
    const { tx, command, repository } = setup();
    tx.device.findFirst.mockResolvedValue({ id: DEVICE });
    tx.phoneCommand.findFirst.mockResolvedValue({
      ...command,
      status: 'completed',
      acknowledgedAt: now,
    });
    await expect(
      repository.acknowledgeCommand(CHILD, DEVICE, COMMAND, {
        status: 'completed',
      }),
    ).resolves.toMatchObject({ outcome: 'unchanged' });
    await expect(
      repository.acknowledgeCommand(CHILD, DEVICE, COMMAND, {
        status: 'failed',
        resultCode: 'FAILED',
      }),
    ).resolves.toEqual({ outcome: 'invalid_state' });
  });

  it('clears an invalid token without deactivating its Device', async () => {
    const { prisma, repository } = setup();
    await repository.clearInvalidToken(DEVICE, 'secret');
    expect(prisma.device.updateMany).toHaveBeenCalledWith({
      where: { id: DEVICE, fcmToken: 'secret' },
      data: { fcmToken: null, updatedAt: expect.any(Date) },
    });
  });
});
