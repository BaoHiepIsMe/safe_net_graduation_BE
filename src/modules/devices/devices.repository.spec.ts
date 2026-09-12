import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DevicesRepository } from './devices.repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const INSTALLATION_ID = '44444444-4444-4444-8444-444444444444';
const now = new Date();
const device = {
  id: DEVICE_ID,
  deviceName: 'Phone',
  platform: 'android',
  operatingSystem: null,
  batteryLevel: 50,
  isActive: true,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

function repositoryWith(tx: Record<string, unknown>) {
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
  } as unknown as PrismaService;
  return { prisma, repository: new DevicesRepository(prisma) };
}

describe('DevicesRepository', () => {
  it('creates a new installation and derives ownership from the actor', async () => {
    const tx = {
      device: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue(device),
      },
    };
    const { repository } = repositoryWith(tx);
    const result = await repository.register(USER_A, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      fcmToken: 'new-valid-fcm-token',
    });
    expect(result).toMatchObject({ outcome: 'registered', device });
    expect(tx.device.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_A,
          installationId: INSTALLATION_ID,
        }),
      }),
    );
  });

  it('updates the same logical row during repeated registration', async () => {
    const tx = {
      device: {
        findUnique: jest.fn().mockResolvedValue({
          id: DEVICE_ID,
          userId: USER_A,
          isActive: true,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue(device),
      },
    };
    const { repository } = repositoryWith(tx);
    await repository.register(USER_A, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      deviceName: 'Updated Phone',
    });
    expect(tx.device.update).toHaveBeenCalledTimes(1);
    expect(tx.device.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEVICE_ID } }),
    );
  });

  it('does not transfer an active installation to another user', async () => {
    const tx = {
      device: {
        findUnique: jest.fn().mockResolvedValue({
          id: DEVICE_ID,
          userId: USER_B,
          isActive: true,
        }),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };
    const { repository } = repositoryWith(tx);
    await expect(
      repository.register(USER_A, {
        installationId: INSTALLATION_ID,
        platform: 'ios',
      }),
    ).resolves.toEqual({ outcome: 'installation_conflict' });
    expect(tx.device.update).not.toHaveBeenCalled();
  });

  it('detaches a rotated FCM token from every other device first', async () => {
    const tx = {
      device: {
        findUnique: jest.fn().mockResolvedValue({
          id: DEVICE_ID,
          userId: USER_A,
          isActive: true,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(device),
      },
    };
    const { repository } = repositoryWith(tx);
    await repository.register(USER_A, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      fcmToken: 'rotated-valid-fcm-token',
    });
    expect(tx.device.updateMany).toHaveBeenCalledWith({
      where: {
        fcmToken: 'rotated-valid-fcm-token',
        id: { not: DEVICE_ID },
      },
      data: { fcmToken: null, updatedAt: expect.any(Date) },
    });
  });

  it('scopes read lookup by both device and owner IDs', async () => {
    const findFirst = jest.fn().mockResolvedValue(device);
    const prisma = { device: { findFirst } } as unknown as PrismaService;
    await new DevicesRepository(prisma).findOwned(USER_A, DEVICE_ID);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: DEVICE_ID, userId: USER_A } }),
    );
  });

  it('clears the token and deactivates instead of deleting', async () => {
    const tx = {
      device: {
        findFirst: jest.fn().mockResolvedValue({ id: DEVICE_ID }),
        update: jest.fn().mockResolvedValue({ id: DEVICE_ID }),
      },
    };
    const { repository } = repositoryWith(tx);
    await repository.deactivateOwned(USER_A, DEVICE_ID);
    expect(tx.device.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false, fcmToken: null }),
      }),
    );
  });
});
