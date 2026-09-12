import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CamerasRepository } from './cameras.repository';

const USER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const CAMERA = '33333333-3333-4333-8333-333333333333';
const secret = 'rtsps://camera.example.invalid/live';

describe('CamerasRepository', () => {
  const setup = () => {
    const row = {
      id: CAMERA,
      familyId: FAMILY,
      name: 'Front door',
      locationLabel: 'Entrance',
      connectionUrl: secret,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const tx = {
      $queryRaw: jest.fn(),
      familyMember: { findFirst: jest.fn().mockResolvedValue({ id: USER }) },
      camera: {
        create: jest.fn().mockResolvedValue(row),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: CAMERA, status: 'active' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue(row),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      familyMember: { findFirst: jest.fn() },
      camera: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    return {
      row,
      tx,
      prisma,
      repository: new CamerasRepository(prisma as unknown as PrismaService),
    };
  };

  it('creates under server-scoped family and authenticated manager only', async () => {
    const { tx, repository } = setup();
    await repository.create(USER, FAMILY, {
      name: 'Front',
      connectionUrl: secret,
    });
    expect(tx.familyMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER,
          familyId: FAMILY,
          status: 'accepted',
          role: 'manager',
        }),
      }),
    );
    expect(tx.camera.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          familyId: FAMILY,
          creatorUserId: USER,
        }),
      }),
    );
  });

  it('denies non-manager or foreign-family creation before writing', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findFirst.mockResolvedValue(null);
    await expect(
      repository.create(USER, FAMILY, { name: 'Denied' }),
    ).resolves.toEqual({
      outcome: 'forbidden',
    });
    expect(tx.camera.create).not.toHaveBeenCalled();
  });

  it('scopes detail by both family and camera ID', async () => {
    const { prisma, repository } = setup();
    await repository.find(FAMILY, CAMERA);
    expect(prisma.camera.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CAMERA, familyId: FAMILY } }),
    );
  });

  it('updates only explicit metadata and never connectivity or AI state', async () => {
    const { tx, repository } = setup();
    await repository.update(USER, FAMILY, CAMERA, {
      name: 'Renamed',
      connectionUrl: secret,
      isActive: false,
    });
    const data = tx.camera.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: 'Renamed',
      connectionUrl: secret,
      status: 'inactive',
    });
    expect(data).not.toHaveProperty('lastOnlineAt');
    expect(data).not.toHaveProperty('fallDetectionEnabled');
  });

  it('makes repeated deactivation idempotent', async () => {
    const { tx, repository } = setup();
    tx.camera.findFirst.mockResolvedValue({ id: CAMERA, status: 'inactive' });
    await expect(
      repository.deactivate(USER, FAMILY, CAMERA),
    ).resolves.toMatchObject({
      outcome: 'unchanged',
    });
    expect(tx.camera.update).not.toHaveBeenCalled();
  });

  it('performs no connection probe or outbound request', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as typeof fetch;
    try {
      const { repository } = setup();
      await repository.create(USER, FAMILY, {
        name: 'No SSRF',
        connectionUrl: secret,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
