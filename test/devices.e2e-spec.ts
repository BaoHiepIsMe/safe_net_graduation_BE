import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { DevicesRepository } from '../src/modules/devices/devices.repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DEVICE_ID = '33333333-3333-4333-8333-333333333333';
const INSTALLATION_ID = '44444444-4444-4444-8444-444444444444';

class InMemoryDevicesRepository {
  private devices: Array<Record<string, any>> = [];

  register(userId: string, dto: Record<string, any>) {
    let current = this.devices.find(
      (device) => device.installationId === dto.installationId,
    );
    if (current && current.userId !== userId && current.isActive) {
      return Promise.resolve({ outcome: 'installation_conflict' });
    }
    if (dto.fcmToken) {
      this.devices.forEach((device) => {
        if (device !== current && device.fcmToken === dto.fcmToken) {
          device.fcmToken = null;
        }
      });
    }
    const now = new Date();
    if (current) {
      Object.assign(current, {
        userId,
        deviceName: dto.deviceName ?? current.deviceName,
        platform: dto.platform,
        operatingSystem: dto.operatingSystem ?? current.operatingSystem,
        batteryLevel: dto.batteryLevel ?? current.batteryLevel,
        ...(dto.fcmToken !== undefined ? { fcmToken: dto.fcmToken } : {}),
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      });
    } else {
      current = {
        id: DEVICE_ID,
        userId,
        installationId: dto.installationId,
        deviceName: dto.deviceName ?? null,
        platform: dto.platform,
        operatingSystem: dto.operatingSystem ?? null,
        fcmToken: dto.fcmToken ?? null,
        batteryLevel: dto.batteryLevel ?? null,
        isActive: true,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      };
      this.devices.push(current);
    }
    return Promise.resolve({
      outcome: 'registered',
      device: this.safe(current),
    });
  }

  listOwned(userId: string) {
    const devices = this.devices
      .filter((device) => device.userId === userId)
      .map((device) => this.safe(device));
    return Promise.resolve({ devices, total: devices.length });
  }

  findOwned(userId: string, deviceId: string) {
    const device = this.devices.find(
      (item) => item.id === deviceId && item.userId === userId,
    );
    return Promise.resolve(device ? this.safe(device) : null);
  }

  updateOwned(userId: string, deviceId: string, dto: Record<string, any>) {
    const device = this.devices.find(
      (item) => item.id === deviceId && item.userId === userId,
    );
    if (!device) return Promise.resolve({ outcome: 'not_found' });
    if (!device.isActive) return Promise.resolve({ outcome: 'inactive' });
    if (dto.fcmToken) {
      this.devices.forEach((item) => {
        if (item !== device && item.fcmToken === dto.fcmToken) {
          item.fcmToken = null;
        }
      });
    }
    Object.assign(device, dto, { updatedAt: new Date() });
    return Promise.resolve({ outcome: 'updated', device: this.safe(device) });
  }

  heartbeatOwned(userId: string, deviceId: string, dto: Record<string, any>) {
    const device = this.devices.find(
      (item) => item.id === deviceId && item.userId === userId,
    );
    if (!device) return Promise.resolve({ outcome: 'not_found' });
    if (!device.isActive) return Promise.resolve({ outcome: 'inactive' });
    Object.assign(device, dto, {
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    });
    return Promise.resolve({ outcome: 'updated', device: this.safe(device) });
  }

  deactivateOwned(userId: string, deviceId: string) {
    const device = this.devices.find(
      (item) => item.id === deviceId && item.userId === userId,
    );
    if (!device) return Promise.resolve({ outcome: 'not_found' });
    Object.assign(device, {
      isActive: false,
      fcmToken: null,
      updatedAt: new Date(),
    });
    return Promise.resolve({ outcome: 'deactivated' });
  }

  private safe(device: Record<string, any>) {
    const {
      id,
      deviceName,
      platform,
      operatingSystem,
      batteryLevel,
      isActive,
      lastSeenAt,
      createdAt,
      updatedAt,
    } = device;
    return {
      id,
      deviceName,
      platform,
      operatingSystem,
      batteryLevel,
      isActive,
      lastSeenAt,
      createdAt,
      updatedAt,
    };
  }
}

describe('Phase 3 Devices (e2e)', () => {
  let app: INestApplication<App>;
  const repository = new InMemoryDevicesRepository();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const users: Record<string, string> = {
            'token-a': USER_A,
            'token-b': USER_B,
          };
          return Promise.resolve(users[token] ? { id: users[token] } : null);
        }),
      })
      .overrideProvider(PrismaService)
      .useValue({
        profile: { findFirst: jest.fn(), findUnique: jest.fn() },
        familyMember: { findFirst: jest.fn() },
        conversationMember: { findFirst: jest.fn() },
      })
      .overrideProvider(DevicesRepository)
      .useValue(repository)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('registers idempotently and returns only the owner safe projection', async () => {
    const body = {
      installationId: INSTALLATION_ID,
      deviceName: 'Phone A',
      platform: 'android',
      fcmToken: 'first-valid-fcm-token',
      batteryLevel: 90,
    };
    const first = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set(auth('token-a'))
      .send(body)
      .expect(201);
    const repeated = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set(auth('token-a'))
      .send({ ...body, deviceName: 'Phone A Updated' })
      .expect(201);
    expect(repeated.body.data.id).toBe(first.body.data.id);
    expect(repeated.body.data).not.toHaveProperty('fcmToken');
    expect(repeated.body.data).not.toHaveProperty('installationId');

    const listed = await request(app.getHttpServer())
      .get('/api/v1/devices')
      .set(auth('token-a'))
      .expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.pagination.total).toBe(1);

    await request(app.getHttpServer())
      .get(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-a'))
      .expect(200);
  });

  it('updates, rotates token and heartbeats without client timestamps or location', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-a'))
      .send({ deviceName: 'Renamed', fcmToken: 'rotated-valid-fcm-token' })
      .expect(200);

    const heartbeat = await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_ID}/heartbeat`)
      .set(auth('token-a'))
      .send({ batteryLevel: 55 })
      .expect(200);
    expect(heartbeat.body.data.batteryLevel).toBe(55);
    expect(heartbeat.body.data).not.toHaveProperty('fcmToken');

    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_ID}/heartbeat`)
      .set(auth('token-a'))
      .send({ latitude: 10.7, longitude: 106.6 })
      .expect(400);
  });

  it('blocks every foreign-user device operation', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-b'))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-b'))
      .send({ deviceName: 'Stolen' })
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_ID}/heartbeat`)
      .set(auth('token-b'))
      .send({ batteryLevel: 1 })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-b'))
      .expect(404);
  });

  it('deactivates safely, is idempotent, and only registration reactivates', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-a'))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-a'))
      .expect(204);
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_ID}/heartbeat`)
      .set(auth('token-a'))
      .send({ batteryLevel: 50 })
      .expect(422);

    const reactivated = await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set(auth('token-a'))
      .send({ installationId: INSTALLATION_ID, platform: 'android' })
      .expect(201);
    expect(reactivated.body.data.id).toBe(DEVICE_ID);
    expect(reactivated.body.data.isActive).toBe(true);
  });

  it('rejects ownership and server-managed mass assignment fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/devices')
      .set(auth('token-a'))
      .send({
        installationId: INSTALLATION_ID,
        platform: 'android',
        userId: USER_B,
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/devices/${DEVICE_ID}`)
      .set(auth('token-a'))
      .send({ isActive: false })
      .expect(400);
  });

  afterAll(async () => {
    await app.close();
  });
});
