import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { CamerasRepository } from '../src/modules/cameras/cameras.repository';

const MANAGER_A = '11111111-1111-4111-8111-111111111111';
const ADULT_A = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const FAMILY_A = '44444444-4444-4444-8444-444444444444';
const FAMILY_B = '55555555-5555-4555-8555-555555555555';

class InMemoryCamerasRepository {
  cameras: any[] = [
    {
      id: '66666666-6666-4666-8666-666666666666',
      familyId: FAMILY_B,
      name: 'Family B camera',
      locationLabel: null,
      connectionUrl: null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
  accessState: Record<
    string,
    {
      familyId: string;
      canManageCare: boolean;
      isHired: boolean;
      status: string;
    }
  > = {
    [MANAGER_A]: {
      familyId: FAMILY_A,
      canManageCare: true,
      isHired: false,
      status: 'accepted',
    },
    [ADULT_A]: {
      familyId: FAMILY_A,
      canManageCare: false,
      isHired: false,
      status: 'accepted',
    },
    [USER_C]: {
      familyId: FAMILY_B,
      canManageCare: false,
      isHired: false,
      status: 'accepted',
    },
  };

  getFamilyAccess(userId: string, familyId: string) {
    const access = this.accessState[userId];
    return Promise.resolve(
      access?.familyId === familyId && access.status === 'accepted'
        ? {
            id: userId,
            userId,
            canManageCare: access.canManageCare,
            isHired: access.isHired,
            profile: { dateOfBirth: new Date('1985-01-01') },
            family: { ownerUserId: MANAGER_A },
          }
        : null,
    );
  }

  create(userId: string, familyId: string, dto: any) {
    const access = this.accessState[userId];
    if (
      !access ||
      access.familyId !== familyId ||
      access.status !== 'accepted' ||
      !access.canManageCare ||
      access.isHired
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    const now = new Date();
    const camera = {
      id: crypto.randomUUID(),
      familyId,
      name: dto.name,
      locationLabel: dto.locationLabel ?? null,
      connectionUrl: dto.connectionUrl ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.cameras.push(camera);
    return Promise.resolve({ outcome: 'created', camera });
  }

  list(familyId: string, query: any) {
    return Promise.resolve(
      this.cameras
        .filter(
          (camera) =>
            camera.familyId === familyId &&
            (query.active === 'all' ||
              camera.status ===
                (query.active === 'true' ? 'active' : 'inactive')),
        )
        .slice(0, query.limit + 1),
    );
  }

  find(familyId: string, cameraId: string) {
    return Promise.resolve(
      this.cameras.find(
        (camera) => camera.id === cameraId && camera.familyId === familyId,
      ) ?? null,
    );
  }

  update(userId: string, familyId: string, cameraId: string, dto: any) {
    const access = this.accessState[userId];
    if (
      !access ||
      access.familyId !== familyId ||
      access.status !== 'accepted' ||
      !access.canManageCare ||
      access.isHired
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    const camera = this.cameras.find(
      (item) => item.id === cameraId && item.familyId === familyId,
    );
    if (!camera) return Promise.resolve({ outcome: 'not_found' });
    if (dto.isActive !== undefined) {
      camera.status = dto.isActive ? 'active' : 'inactive';
    }
    if (dto.name !== undefined) camera.name = dto.name;
    if (dto.locationLabel !== undefined)
      camera.locationLabel = dto.locationLabel;
    if (dto.connectionUrl !== undefined)
      camera.connectionUrl = dto.connectionUrl;
    camera.updatedAt = new Date();
    return Promise.resolve({ outcome: 'updated', camera });
  }

  deactivate(userId: string, familyId: string, cameraId: string) {
    return this.update(userId, familyId, cameraId, { isActive: false });
  }
}

describe('Phase 10 Camera Management (e2e)', () => {
  let app: INestApplication<App>;
  const cameras = new InMemoryCamerasRepository();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const secret = 'rtsps://camera.example.invalid/live';

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const users: Record<string, string> = {
            'manager-a': MANAGER_A,
            'adult-a': ADULT_A,
            'user-c': USER_C,
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
      .overrideProvider(CamerasRepository)
      .useValue(cameras)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  let cameraId: string;

  it('A/F: manager completes secret-safe create, list, detail, update and deactivation', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY_A}/cameras`)
      .set(auth('manager-a'))
      .send({
        name: 'Front door',
        locationLabel: 'Entrance',
        connectionUrl: secret,
      })
      .expect(201);
    cameraId = created.body.data.id;
    expect(JSON.stringify(created.body)).not.toContain(secret);
    expect(created.body.data).toMatchObject({
      hasConnectionConfiguration: true,
      connectivityStatus: 'unknown',
    });
    expect(
      cameras.cameras.find((camera) => camera.id === cameraId)?.connectionUrl,
    ).toBe(secret);

    for (const path of [
      `/api/v1/families/${FAMILY_A}/cameras`,
      `/api/v1/families/${FAMILY_A}/cameras/${cameraId}`,
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set(auth('manager-a'))
        .expect(200)
        .expect((response) =>
          expect(JSON.stringify(response.body)).not.toContain(secret),
        );
    }

    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('manager-a'))
      .send({
        name: 'Renamed camera',
        connectionUrl: 'https://camera.example.invalid/config',
      })
      .expect(200)
      .expect((response) =>
        expect(response.body.data.name).toBe('Renamed camera'),
      );
    await request(app.getHttpServer())
      .delete(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('manager-a'))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('manager-a'))
      .expect(204);
  });

  it('B: accepted adult reads active metadata but cannot mutate', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('manager-a'))
      .send({ isActive: true })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('adult-a'))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('adult-a'))
      .send({ name: 'Forbidden' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('adult-a'))
      .expect(403);
  });

  it('C: unrelated user cannot list, read, update or deactivate Family A cameras', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_A}/cameras`)
      .set(auth('user-c'))
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('user-c'))
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('user-c'))
      .send({ name: 'No' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/families/${FAMILY_A}/cameras/${cameraId}`)
      .set(auth('user-c'))
      .expect(403);
  });

  it.each(['pending', 'rejected', 'removed'])(
    'D: %s member has no camera metadata access',
    async (status) => {
      cameras.accessState[ADULT_A].status = status;
      await request(app.getHttpServer())
        .get(`/api/v1/families/${FAMILY_A}/cameras`)
        .set(auth('adult-a'))
        .expect(403);
      cameras.accessState[ADULT_A].status = 'accepted';
    },
  );

  it('E: Camera from Family B cannot be used under Family A route', async () => {
    const cameraB = cameras.cameras.find(
      (camera) => camera.familyId === FAMILY_B,
    )!;
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_A}/cameras/${cameraB.id}`)
      .set(auth('manager-a'))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY_A}/cameras/${cameraB.id}`)
      .set(auth('manager-a'))
      .send({ name: 'No' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/families/${FAMILY_A}/cameras/${cameraB.id}`)
      .set(auth('manager-a'))
      .expect(404);
  });

  it('G: camera writes make no network probe to submitted URL', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as typeof fetch;
    try {
      await request(app.getHttpServer())
        .post(`/api/v1/families/${FAMILY_A}/cameras`)
        .set(auth('manager-a'))
        .send({ name: 'No probe', connectionUrl: secret })
        .expect(201);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('rejects unknown, connectivity, ownership and AI fields', async () => {
    for (const body of [
      { name: 'Bad', familyId: FAMILY_B },
      { name: 'Bad', isOnline: true },
      { name: 'Bad', lastOnlineAt: new Date().toISOString() },
      { name: 'Bad', fallDetectionEnabled: true },
      { name: 'Bad', connectionUrl: 'file:///private/camera' },
    ]) {
      await request(app.getHttpServer())
        .post(`/api/v1/families/${FAMILY_A}/cameras`)
        .set(auth('manager-a'))
        .send(body)
        .expect(400);
    }
  });

  afterAll(async () => app.close());
});
