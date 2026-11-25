import { ErrorCode } from '../../common/constants/error-codes';
import { CamerasRepository } from './cameras.repository';
import { CamerasService } from './cameras.service';

const USER = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const CAMERA = '33333333-3333-4333-8333-333333333333';
const secret = 'rtsps://camera.example.invalid/live';
const now = new Date('2030-01-01T00:00:00Z');
const row = (overrides: Record<string, unknown> = {}) => ({
  id: CAMERA,
  familyId: FAMILY,
  name: 'Front door',
  locationLabel: 'Entrance',
  connectionUrl: secret,
  status: 'active',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('CamerasService', () => {
  const setup = () => {
    const repository = {
      getFamilyAccess: jest.fn().mockResolvedValue({
        id: USER,
        userId: USER,
        canManageCare: true,
        isHired: false,
        profile: { dateOfBirth: new Date('1985-01-01') },
        family: { ownerUserId: USER },
      }),
      create: jest
        .fn()
        .mockResolvedValue({ outcome: 'created', camera: row() }),
      list: jest.fn().mockResolvedValue([row()]),
      find: jest.fn().mockResolvedValue(row()),
      update: jest
        .fn()
        .mockResolvedValue({ outcome: 'updated', camera: row() }),
      deactivate: jest.fn().mockResolvedValue({
        outcome: 'updated',
        camera: row({ status: 'inactive' }),
      }),
    };
    return {
      repository,
      service: new CamerasService(repository as unknown as CamerasRepository),
    };
  };

  it('returns safe metadata and only a connection-presence flag after create', async () => {
    const { service } = setup();
    const result = await service.create(USER, FAMILY, {
      name: 'Front door',
      connectionUrl: secret,
    });
    expect(result).toMatchObject({
      id: CAMERA,
      hasConnectionConfiguration: true,
      connectivityStatus: 'unknown',
    });
    expect(result).not.toHaveProperty('connectionUrl');
    expect(result).not.toHaveProperty('lastOnlineAt');
    expect(result).not.toHaveProperty('fallDetectionEnabled');
  });

  it('allows accepted non-hired adults (including elders) to read active safe metadata', async () => {
    const { repository, service } = setup();
    repository.getFamilyAccess.mockResolvedValue({
      id: USER,
      userId: USER,
      canManageCare: false,
      isHired: false,
      profile: { dateOfBirth: new Date('1950-01-01') },
      family: { ownerUserId: '99999999-9999-4999-8999-999999999999' },
    });
    await expect(
      service.list(USER, FAMILY, { limit: 20, active: 'true' }),
    ).resolves.toMatchObject({
      data: [expect.objectContaining({ id: CAMERA })],
    });
    await expect(service.detail(USER, FAMILY, CAMERA)).resolves.toMatchObject({
      id: CAMERA,
    });
  });

  it.each([
    [
      'minor (<18)',
      {
        id: USER,
        userId: USER,
        canManageCare: false,
        isHired: false,
        profile: { dateOfBirth: new Date('2015-01-01') },
      },
    ],
    [
      'hired caregiver',
      {
        id: USER,
        userId: USER,
        canManageCare: true,
        isHired: true,
        profile: { dateOfBirth: new Date('1990-01-01') },
      },
    ],
  ])(
    'denies %s metadata access conservatively',
    async (_label, accessRecord) => {
      const { repository, service } = setup();
      repository.getFamilyAccess.mockResolvedValue(accessRecord);
      await expect(
        service.list(USER, FAMILY, { limit: 20, active: 'true' }),
      ).rejects.toMatchObject({ code: ErrorCode.CAMERA_ACCESS_DENIED });
    },
  );

  it('denies unrelated membership', async () => {
    const { repository, service } = setup();
    repository.getFamilyAccess.mockResolvedValue(null);
    await expect(
      service.list(USER, FAMILY, { limit: 20, active: 'true' }),
    ).rejects.toMatchObject({ code: ErrorCode.CAMERA_ACCESS_DENIED });
  });

  it('prevents non-admin adults from listing inactive configuration or mutating', async () => {
    const { repository, service } = setup();
    repository.getFamilyAccess.mockResolvedValue({
      id: USER,
      userId: USER,
      canManageCare: false,
      isHired: false,
      profile: { dateOfBirth: new Date('1990-01-01') },
      family: { ownerUserId: '99999999-9999-4999-8999-999999999999' },
    });
    await expect(
      service.list(USER, FAMILY, { limit: 20, active: 'all' }),
    ).rejects.toMatchObject({ code: ErrorCode.CAMERA_ACCESS_DENIED });
    repository.update.mockResolvedValue({ outcome: 'forbidden' });
    await expect(
      service.update(USER, FAMILY, CAMERA, { name: 'No' }),
    ).rejects.toMatchObject({ code: ErrorCode.CAMERA_ACCESS_DENIED });
  });

  it('hides a foreign-family camera through the scoped not-found contract', async () => {
    const { repository, service } = setup();
    repository.find.mockResolvedValue(null);
    await expect(service.detail(USER, FAMILY, CAMERA)).rejects.toMatchObject({
      code: ErrorCode.CAMERA_NOT_FOUND,
    });
    repository.update.mockResolvedValue({ outcome: 'not_found' });
    await expect(
      service.update(USER, FAMILY, CAMERA, { name: 'No' }),
    ).rejects.toMatchObject({ code: ErrorCode.CAMERA_NOT_FOUND });
  });

  it('deactivates without returning or deleting the camera', async () => {
    const { repository, service } = setup();
    await expect(
      service.deactivate(USER, FAMILY, CAMERA),
    ).resolves.toBeUndefined();
    expect(repository.deactivate).toHaveBeenCalledWith(USER, FAMILY, CAMERA);
  });

  it('never echoes a connection secret in mapped update output', async () => {
    const { service } = setup();
    const result = await service.update(USER, FAMILY, CAMERA, {
      connectionUrl: secret,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.hasConnectionConfiguration).toBe(true);
  });
});
