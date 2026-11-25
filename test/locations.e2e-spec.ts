import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ForbiddenError } from '../src/common/errors/app.error';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RealtimeGateway } from '../src/infrastructure/realtime/realtime.gateway';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { FamilyAccessService } from '../src/modules/families/family-access.service';
import { GeofenceEvaluationService } from '../src/modules/geofences/geofence-evaluation.service';
import { LocationsRepository } from '../src/modules/locations/locations.repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const DEVICE_A = '44444444-4444-4444-8444-444444444444';
const FAMILY_X = '55555555-5555-4555-8555-555555555555';
const FAMILY_Y = '66666666-6666-4666-8666-666666666666';
const MEMBER_A = '77777777-7777-4777-8777-777777777777';
const MEMBER_B = '88888888-8888-4888-8888-888888888888';
const MEMBER_D = '99999999-9999-4999-8999-999999999999';
const LOCATION_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
];

class InMemoryLocationsRepository {
  deviceActive = true;
  failNext = false;
  globalSharing: Record<string, boolean> = {
    [USER_A]: true,
    [USER_B]: true,
    [USER_C]: true,
  };
  activeFamilies = new Set([FAMILY_X, FAMILY_Y]);
  history: any[] = [];
  current: Record<string, any> = {};
  members = [
    {
      id: MEMBER_A,
      familyId: FAMILY_X,
      userId: USER_A,
      status: 'accepted',
      canManageCare: true,
      isCareRecipient: false,
      isHired: true,
      familyLabel: 'caregiver',
      displayName: 'User A',
      sharing: true,
    },
    {
      id: MEMBER_B,
      familyId: FAMILY_X,
      userId: USER_B,
      status: 'accepted',
      canManageCare: false,
      isCareRecipient: true,
      isHired: false,
      familyLabel: 'other',
      displayName: 'User B',
      sharing: true,
    },
    {
      id: MEMBER_D,
      familyId: FAMILY_Y,
      userId: USER_C,
      status: 'accepted',
      canManageCare: false,
      isCareRecipient: false,
      isHired: false,
      familyLabel: 'other',
      displayName: 'User C',
      sharing: true,
    },
  ];

  ingest(userId: string, deviceId: string, dto: any) {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('transaction rolled back'));
    }
    if (deviceId !== DEVICE_A || userId !== USER_A) {
      return Promise.resolve({ outcome: 'not_found' });
    }
    if (!this.deviceActive) return Promise.resolve({ outcome: 'inactive' });
    const history = {
      id: LOCATION_IDS[this.history.length],
      latitude: new Prisma.Decimal(dto.latitude),
      longitude: new Prisma.Decimal(dto.longitude),
      accuracy: dto.accuracy ?? null,
      speed: dto.speed ?? null,
      heading: dto.heading ?? null,
      batteryLevel: dto.batteryLevel ?? null,
      recordedAt: dto.recordedAt,
      createdAt: new Date(),
    };
    this.history.push({ ...history, userId });
    const previous = this.current[userId];
    const currentUpdated =
      !previous ||
      history.recordedAt > previous.recordedAt ||
      (history.recordedAt.getTime() === previous.recordedAt.getTime() &&
        history.id > previous.id);
    if (currentUpdated) this.current[userId] = history;
    const sharedFamilyIds = this.members
      .filter(
        (member) =>
          member.userId === userId &&
          member.status === 'accepted' &&
          member.sharing &&
          this.globalSharing[userId] &&
          this.activeFamilies.has(member.familyId),
      )
      .map((member) => member.familyId);
    const recipientUserIds = [
      ...new Set(
        this.members
          .filter(
            (member) =>
              sharedFamilyIds.includes(member.familyId) &&
              member.status === 'accepted' &&
              this.activeFamilies.has(member.familyId),
          )
          .map((member) => member.userId),
      ),
    ];
    return Promise.resolve({
      outcome: 'stored',
      history,
      currentUpdated,
      recipientUserIds,
    });
  }

  findOwnCurrent(userId: string) {
    const row = this.current[userId];
    return Promise.resolve(
      row
        ? {
            latitude: row.latitude,
            longitude: row.longitude,
            accuracy: row.accuracy,
            batteryLevel: row.batteryLevel,
            recordedAt: row.recordedAt,
            updatedAt: row.createdAt,
          }
        : null,
    );
  }

  listHistory(userId: string, query: any, cursor?: any) {
    let rows = this.history
      .filter((row) => row.userId === userId)
      .sort(
        (left, right) =>
          right.recordedAt.getTime() - left.recordedAt.getTime() ||
          right.id.localeCompare(left.id),
      );
    if (cursor) {
      rows = rows.filter(
        (row) =>
          row.recordedAt < cursor.recordedAt ||
          (row.recordedAt.getTime() === cursor.recordedAt.getTime() &&
            row.id < cursor.id),
      );
    }
    return Promise.resolve(rows.slice(0, query.limit + 1));
  }

  findFamilyCurrentLocations(familyId: string) {
    return Promise.resolve(
      this.members
        .filter(
          (member) =>
            member.familyId === familyId &&
            member.status === 'accepted' &&
            member.sharing &&
            this.current[member.userId],
        )
        .map((member) => this.familyRow(member)),
    );
  }

  findFamilyMemberCurrentLocation(familyId: string, memberId: string) {
    const member = this.members.find(
      (item) =>
        item.familyId === familyId &&
        item.id === memberId &&
        item.status === 'accepted' &&
        item.sharing &&
        this.current[item.userId],
    );
    return Promise.resolve(member ? this.familyRow(member) : null);
  }

  private familyRow(member: (typeof this.members)[number]) {
    const row = this.current[member.userId];
    return {
      member_id: member.id,
      user_id: member.userId,
      owner_user_id: USER_A,
      can_manage_care: member.canManageCare,
      is_care_recipient: member.isCareRecipient,
      is_hired: member.isHired,
      date_of_birth: new Date('1990-01-01'),
      care_scope_member_ids: [],
      family_label: member.familyLabel,
      display_name: member.displayName,
      full_name: member.displayName,
      avatar_url: null,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      battery_level: row.batteryLevel,
      recorded_at: row.recordedAt,
      updated_at: row.createdAt,
    };
  }
}

describe('Phase 4 Locations (e2e)', () => {
  let app: INestApplication<App>;
  const repository = new InMemoryLocationsRepository();
  const realtime = { emitToUser: jest.fn() };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const familyAccess = {
      requireAcceptedMember: jest.fn((userId: string, familyId: string) => {
        const membership = repository.members.find(
          (member) =>
            member.userId === userId &&
            member.familyId === familyId &&
            member.status === 'accepted',
        );
        if (!membership) return Promise.reject(new ForbiddenError());
        return Promise.resolve(membership);
      }),
    };
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const users: Record<string, string> = {
            'token-a': USER_A,
            'token-b': USER_B,
            'token-c': USER_C,
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
      .overrideProvider(LocationsRepository)
      .useValue(repository)
      .overrideProvider(GeofenceEvaluationService)
      .useValue({ evaluateCommittedLocation: jest.fn().mockResolvedValue([]) })
      .overrideProvider(FamilyAccessService)
      .useValue(familyAccess)
      .overrideProvider(RealtimeGateway)
      .useValue(realtime)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('ingests from an owned active device and exposes own current/history', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 10.7,
        longitude: 106.6,
        accuracy: 5,
        recordedAt: '2026-08-24T04:05:00.000Z',
      })
      .expect(201);
    expect(response.body.data.currentUpdated).toBe(true);

    const current = await request(app.getHttpServer())
      .get('/api/v1/locations/me/current')
      .set(auth('token-a'))
      .expect(200);
    expect(current.body.data).toMatchObject({
      latitude: 10.7,
      longitude: 106.6,
    });

    const history = await request(app.getHttpServer())
      .get('/api/v1/locations/me/history?limit=20')
      .set(auth('token-a'))
      .expect(200);
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).not.toHaveProperty('deviceId');
  });

  it('stores older points in history without moving current backward', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 11,
        longitude: 107,
        recordedAt: '2026-08-24T04:06:00.000Z',
      })
      .expect(201);
    const stale = await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 9,
        longitude: 105,
        recordedAt: '2026-08-24T04:03:00.000Z',
      })
      .expect(201);
    expect(stale.body.data.currentUpdated).toBe(false);

    const current = await request(app.getHttpServer())
      .get('/api/v1/locations/me/current')
      .set(auth('token-a'))
      .expect(200);
    expect(current.body.data).toMatchObject({ latitude: 11, longitude: 107 });

    const firstPage = await request(app.getHttpServer())
      .get('/api/v1/locations/me/history?limit=2')
      .set(auth('token-a'))
      .expect(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.pagination.hasMore).toBe(true);
    await request(app.getHttpServer())
      .get(
        `/api/v1/locations/me/history?limit=2&cursor=${firstPage.body.pagination.nextCursor}`,
      )
      .set(auth('token-a'))
      .expect(200)
      .expect((result) => expect(result.body.data).toHaveLength(1));
  });

  it('denies foreign/inactive devices and rejects mass assignment', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-b'))
      .send({
        latitude: 10,
        longitude: 106,
        recordedAt: '2026-08-24T04:07:00.000Z',
      })
      .expect(404);
    repository.deviceActive = false;
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 10,
        longitude: 106,
        recordedAt: '2026-08-24T04:07:00.000Z',
      })
      .expect(422);
    repository.deviceActive = true;
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 10,
        longitude: 106,
        recordedAt: '2026-08-24T04:07:00.000Z',
        userId: USER_B,
      })
      .expect(400);
  });

  it('enforces accepted family and cross-family member scoping', async () => {
    const map = await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_X}/locations/current`)
      .set(auth('token-b'))
      .expect(200);
    expect(map.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ memberId: MEMBER_A })]),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_X}/members/${MEMBER_A}/location`)
      .set(auth('token-b'))
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_X}/members/${MEMBER_D}/location`)
      .set(auth('token-b'))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY_X}/locations/current`)
      .set(auth('token-c'))
      .expect(403);

    const memberB = repository.members.find(
      (member) => member.id === MEMBER_B,
    )!;
    for (const status of ['pending', 'rejected', 'removed']) {
      memberB.status = status;
      await request(app.getHttpServer())
        .get(`/api/v1/families/${FAMILY_X}/locations/current`)
        .set(auth('token-b'))
        .expect(403);
    }
    memberB.status = 'accepted';
  });

  it('emits safe realtime only after successful current persistence', async () => {
    realtime.emitToUser.mockClear();
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 12,
        longitude: 108,
        recordedAt: '2026-08-24T04:08:00.000Z',
      })
      .expect(201);
    expect(realtime.emitToUser).toHaveBeenCalled();
    const payload = realtime.emitToUser.mock.calls[0][2];
    expect(payload).not.toHaveProperty('fcmToken');
    expect(payload).not.toHaveProperty('installationId');
    expect(payload).not.toHaveProperty('deviceId');

    const count = realtime.emitToUser.mock.calls.length;
    repository.failNext = true;
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 13,
        longitude: 109,
        recordedAt: '2026-08-24T04:09:00.000Z',
      })
      .expect(500);
    expect(realtime.emitToUser).toHaveBeenCalledTimes(count);
  });

  it('applies owner and recipient sharing policy to private realtime delivery', async () => {
    const memberA = repository.members.find(
      (member) => member.id === MEMBER_A,
    )!;
    const memberB = repository.members.find(
      (member) => member.id === MEMBER_B,
    )!;
    let capturedAt = Date.now() - 60_000;
    const submit = async () => {
      capturedAt += 1_000;
      realtime.emitToUser.mockClear();
      await request(app.getHttpServer())
        .post(`/api/v1/devices/${DEVICE_A}/locations`)
        .set(auth('token-a'))
        .send({
          latitude: 14,
          longitude: 110,
          recordedAt: new Date(capturedAt).toISOString(),
        })
        .expect(201);
      return realtime.emitToUser.mock.calls.map((call) => call[0]);
    };

    await expect(submit()).resolves.toEqual(
      expect.arrayContaining([USER_A, USER_B]),
    );

    repository.globalSharing[USER_A] = false;
    await expect(submit()).resolves.toEqual([USER_A]);
    repository.globalSharing[USER_A] = true;

    memberA.sharing = false;
    await expect(submit()).resolves.toEqual([USER_A]);
    memberA.sharing = true;

    // D7: a recipient with their own sharing off still sees the family map.
    memberB.sharing = false;
    await expect(submit()).resolves.toEqual(
      expect.arrayContaining([USER_A, USER_B]),
    );
    memberB.sharing = true;

    for (const status of ['pending', 'rejected', 'removed']) {
      memberB.status = status;
      await expect(submit()).resolves.toEqual([USER_A]);
    }
    memberB.status = 'accepted';

    repository.activeFamilies.delete(FAMILY_X);
    await expect(submit()).resolves.toEqual([USER_A]);
    repository.activeFamilies.add(FAMILY_X);

    const recipients = await submit();
    expect(recipients).toContain(USER_A);
    expect(recipients).toContain(USER_B);
    expect(recipients).not.toContain(USER_C);
  });

  afterAll(async () => {
    await app.close();
  });

  it('nhận body chạy ngầm (batteryRatio, speed/heading -1) và lưu pin phần trăm', async () => {
    repository.deviceActive = true;
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE_A}/locations`)
      .set(auth('token-a'))
      .send({
        latitude: 10.7,
        longitude: 106.6,
        accuracy: 5,
        speed: -1,
        heading: -1,
        batteryRatio: 0.87,
        recordedAt: new Date().toISOString(),
      })
      .expect(201);

    const current = await request(app.getHttpServer())
      .get('/api/v1/locations/me/current')
      .set(auth('token-a'))
      .expect(200);
    expect(current.body.data.batteryLevel).toBe(87);
  });
});
