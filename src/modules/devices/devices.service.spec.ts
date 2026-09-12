import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/app.error';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';

const USER_A = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const now = new Date();
const safeDevice = {
  id: DEVICE_ID,
  deviceName: 'Phone A',
  platform: 'android',
  operatingSystem: 'Android 16',
  batteryLevel: 80,
  isActive: true,
  lastSeenAt: now,
  createdAt: now,
  updatedAt: now,
};

function setup() {
  const repository = {
    register: jest.fn(),
    listOwned: jest.fn(),
    findOwned: jest.fn(),
    updateOwned: jest.fn(),
    heartbeatOwned: jest.fn(),
    deactivateOwned: jest.fn(),
  };
  return {
    repository,
    service: new DevicesService(repository as unknown as DevicesRepository),
  };
}

describe('DevicesService', () => {
  it('registers an authenticated user device without exposing token data', async () => {
    const { service, repository } = setup();
    repository.register.mockResolvedValue({
      outcome: 'registered',
      device: safeDevice,
    });
    const result = await service.register(USER_A, {
      installationId: INSTALLATION_ID,
      platform: 'android',
      fcmToken: 'valid-fcm-token-value',
    });
    expect(repository.register).toHaveBeenCalledWith(
      USER_A,
      expect.not.objectContaining({ userId: expect.anything() }),
    );
    expect(result).not.toHaveProperty('fcmToken');
    expect(result).not.toHaveProperty('installationId');
  });

  it('reports an active cross-account installation conflict', async () => {
    const { service, repository } = setup();
    repository.register.mockResolvedValue({
      outcome: 'installation_conflict',
    });
    await expect(
      service.register(USER_A, {
        installationId: INSTALLATION_ID,
        platform: 'ios',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists only the repository result scoped to the actor', async () => {
    const { service, repository } = setup();
    repository.listOwned.mockResolvedValue({ devices: [safeDevice], total: 1 });
    await expect(service.list(USER_A, { page: 1, limit: 20 })).resolves.toEqual(
      expect.objectContaining({
        data: [safeDevice],
        pagination: expect.objectContaining({ total: 1, totalPages: 1 }),
      }),
    );
    expect(repository.listOwned).toHaveBeenCalledWith(USER_A, {
      page: 1,
      limit: 20,
    });
  });

  it('hides foreign or unknown devices behind DEVICE_NOT_FOUND', async () => {
    const { service, repository } = setup();
    repository.findOwned.mockResolvedValue(null);
    await expect(service.get(USER_A, DEVICE_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('allows an owner to update allowlisted metadata', async () => {
    const { service, repository } = setup();
    repository.updateOwned.mockResolvedValue({
      outcome: 'updated',
      device: { ...safeDevice, deviceName: 'Renamed' },
    });
    await expect(
      service.update(USER_A, DEVICE_ID, { deviceName: 'Renamed' }),
    ).resolves.toMatchObject({ deviceName: 'Renamed' });
  });

  it('rejects heartbeat for an inactive device', async () => {
    const { service, repository } = setup();
    repository.heartbeatOwned.mockResolvedValue({ outcome: 'inactive' });
    await expect(
      service.heartbeat(USER_A, DEVICE_ID, { batteryLevel: 40 }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('deactivates idempotently when the owned row exists', async () => {
    const { service, repository } = setup();
    repository.deactivateOwned.mockResolvedValue({ outcome: 'deactivated' });
    await expect(
      service.deactivate(USER_A, DEVICE_ID),
    ).resolves.toBeUndefined();
  });
});
