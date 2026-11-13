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
import { GeofencesRepository } from '../src/modules/geofences/geofences.repository';
import { LocationsRepository } from '../src/modules/locations/locations.repository';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const MANAGER = '11111111-1111-4111-8111-111111111111';
const MEMBER_USER = '22222222-2222-4222-8222-222222222222';
const UNRELATED = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const FOREIGN_FAMILY = '55555555-5555-4555-8555-555555555555';
const MEMBER = '77777777-7777-4777-8777-777777777777';
const FOREIGN_MEMBER = '88888888-8888-4888-8888-888888888888';
const DEVICE = '99999999-9999-4999-8999-999999999999';
const ZONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

class InMemoryGeofencesRepository {
  memberStatus = 'accepted';
  globalSharing = true;
  memberSharing = true;
  zone: any = null;
  state: { inside: boolean; locationId: string; recordedAt: Date } | null =
    null;
  events: any[] = [];

  private assignment() {
    return {
      member_id: MEMBER,
      notify_on_enter: true,
      notify_on_exit: true,
      FamilyMember: {
        userId: MEMBER_USER,
        displayName: 'Member B',
        role: 'adult',
        profile: { fullName: 'Member B', avatarUrl: null },
      },
    };
  }

  private buildZone(dto: any) {
    const now = new Date();
    return {
      id: ZONE,
      family_id: FAMILY,
      name: dto.name ?? this.zone?.name ?? 'Home',
      address: dto.address ?? this.zone?.address ?? null,
      center_latitude: new Prisma.Decimal(
        dto.centerLatitude ?? this.zone?.center_latitude ?? 0,
      ),
      center_longitude: new Prisma.Decimal(
        dto.centerLongitude ?? this.zone?.center_longitude ?? 0,
      ),
      radius_meters: dto.radiusMeters ?? this.zone?.radius_meters ?? 100,
      is_active: dto.isActive ?? this.zone?.is_active ?? true,
      created_at: this.zone?.created_at ?? now,
      updated_at: now,
      GeofenceMember: dto.members?.length === 0 ? [] : [this.assignment()],
    };
  }

  createWithMembers(_familyId: string, _actor: string, dto: any) {
    if (dto.members.some((item: any) => item.memberId !== MEMBER)) {
      return Promise.resolve({
        outcome: 'invalid_members',
        invalidMemberIds: dto.members.map((item: any) => item.memberId),
      });
    }
    this.zone = this.buildZone(dto);
    return Promise.resolve({ outcome: 'created', geofence: this.zone });
  }

  list(_familyId: string, _query: any) {
    return Promise.resolve({
      rows: this.zone ? [this.zone] : [],
      total: this.zone ? 1 : 0,
    });
  }

  findOne(familyId: string, geofenceId: string) {
    return Promise.resolve(
      familyId === FAMILY && geofenceId === ZONE ? this.zone : null,
    );
  }

  update(familyId: string, geofenceId: string, dto: any) {
    if (familyId !== FAMILY || geofenceId !== ZONE || !this.zone)
      return Promise.resolve(null);
    this.zone = this.buildZone(dto);
    return Promise.resolve(this.zone);
  }

  deactivate(familyId: string, geofenceId: string) {
    if (familyId !== FAMILY || geofenceId !== ZONE || !this.zone)
      return Promise.resolve({ count: 0 });
    this.zone.is_active = false;
    return Promise.resolve({ count: 1 });
  }

  replaceMembers(familyId: string, geofenceId: string, dto: any) {
    if (familyId !== FAMILY || geofenceId !== ZONE || !this.zone)
      return Promise.resolve({ outcome: 'not_found' });
    const invalid = dto.members
      .filter((item: any) => item.memberId !== MEMBER)
      .map((item: any) => item.memberId);
    if (invalid.length)
      return Promise.resolve({
        outcome: 'invalid_members',
        invalidMemberIds: invalid,
      });
    this.zone.GeofenceMember = dto.members.length ? [this.assignment()] : [];
    return Promise.resolve({ outcome: 'updated', geofence: this.zone });
  }

  listEvents(familyId: string, query: any) {
    if (
      familyId !== FAMILY ||
      !this.globalSharing ||
      !this.memberSharing ||
      this.memberStatus !== 'accepted'
    )
      return Promise.resolve([]);
    return Promise.resolve(this.events.slice(0, query.limit + 1));
  }

  evaluateCommittedLocation(location: any) {
    if (
      !this.zone?.is_active ||
      !this.zone.GeofenceMember.length ||
      !this.globalSharing ||
      !this.memberSharing ||
      this.memberStatus !== 'accepted'
    )
      return Promise.resolve([]);
    if (
      this.state &&
      (this.state.recordedAt > location.recordedAt ||
        (this.state.recordedAt.getTime() === location.recordedAt.getTime() &&
          this.state.locationId >= location.id))
    )
      return Promise.resolve([]);
    const inside = Math.abs(location.longitude) < 0.0009;
    if (!this.state) {
      this.state = {
        inside,
        locationId: location.id,
        recordedAt: location.recordedAt,
      };
      return Promise.resolve([]);
    }
    const changed = this.state.inside !== inside;
    this.state = {
      inside,
      locationId: location.id,
      recordedAt: location.recordedAt,
    };
    if (!changed) return Promise.resolve([]);
    const eventType = inside ? 'enter' : 'exit';
    const persisted = {
      id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${this.events.length}`,
      event_type: eventType,
      latitude: new Prisma.Decimal(location.latitude),
      longitude: new Prisma.Decimal(location.longitude),
      detected_at: location.recordedAt,
      created_at: new Date(),
      Geofence: { id: ZONE, name: this.zone.name },
      FamilyMember: {
        id: MEMBER,
        displayName: 'Member B',
        profile: { fullName: 'Member B', avatarUrl: null },
      },
    };
    this.events.unshift(persisted);
    return Promise.resolve([
      {
        id: persisted.id,
        familyId: FAMILY,
        geofenceId: ZONE,
        geofenceName: this.zone.name,
        memberId: MEMBER,
        eventType,
        latitude: location.latitude,
        longitude: location.longitude,
        occurredAt: location.recordedAt,
        recipientUserIds: [MANAGER, MEMBER_USER],
      },
    ]);
  }
}

class InMemoryLocationsRepository {
  index = 0;
  current: any = null;
  ingest(userId: string, deviceId: string, dto: any) {
    if (userId !== MEMBER_USER || deviceId !== DEVICE)
      return Promise.resolve({ outcome: 'not_found' });
    const id = `cccccccc-cccc-4ccc-8ccc-ccccccccccc${this.index++}`;
    const history = {
      id,
      latitude: new Prisma.Decimal(dto.latitude),
      longitude: new Prisma.Decimal(dto.longitude),
      accuracy: null,
      speed: null,
      heading: null,
      batteryLevel: null,
      recordedAt: dto.recordedAt,
      createdAt: new Date(),
    };
    const currentUpdated =
      !this.current ||
      dto.recordedAt > this.current.recordedAt ||
      (dto.recordedAt.getTime() === this.current.recordedAt.getTime() &&
        id > this.current.id);
    if (currentUpdated) this.current = history;
    return Promise.resolve({
      outcome: 'stored',
      history,
      currentUpdated,
      recipientUserIds: [],
    });
  }
  findOwnCurrent() {
    return Promise.resolve(null);
  }
  listHistory() {
    return Promise.resolve([]);
  }
  findFamilyCurrentLocations() {
    return Promise.resolve([]);
  }
  findFamilyMemberCurrentLocation() {
    return Promise.resolve(null);
  }
}

describe('Phase 5 Geofences (e2e)', () => {
  let app: INestApplication<App>;
  const geofences = new InMemoryGeofencesRepository();
  const locations = new InMemoryLocationsRepository();
  const realtime = { emitToUser: jest.fn() };
  const notifications = {
    processGeofenceEvent: jest.fn().mockResolvedValue([]),
  };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let capturedAt = Date.now() - 60_000;

  beforeAll(async () => {
    const access = {
      requireAcceptedMember: jest.fn((userId: string, familyId: string) => {
        if (
          familyId !== FAMILY ||
          userId === UNRELATED ||
          geofences.memberStatus !== 'accepted'
        )
          return Promise.reject(new ForbiddenError());
        return Promise.resolve({
          role: userId === MANAGER ? 'manager' : 'adult',
        });
      }),
      requireManager: jest.fn((userId: string, familyId: string) => {
        if (familyId !== FAMILY || userId !== MANAGER)
          return Promise.reject(new ForbiddenError());
        return Promise.resolve({ role: 'manager' });
      }),
    };
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) =>
          Promise.resolve({
            id:
              token === 'manager'
                ? MANAGER
                : token === 'member'
                  ? MEMBER_USER
                  : UNRELATED,
          }),
        ),
      })
      .overrideProvider(PrismaService)
      .useValue({
        profile: { findFirst: jest.fn(), findUnique: jest.fn() },
        familyMember: { findFirst: jest.fn() },
        conversationMember: { findFirst: jest.fn() },
      })
      .overrideProvider(FamilyAccessService)
      .useValue(access)
      .overrideProvider(GeofencesRepository)
      .useValue(geofences)
      .overrideProvider(LocationsRepository)
      .useValue(locations)
      .overrideProvider(RealtimeGateway)
      .useValue(realtime)
      .overrideProvider(NotificationsService)
      .useValue(notifications)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('manager creates, reads, updates, and assigns an accepted same-family member', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY}/geofences`)
      .set(auth('manager'))
      .send({
        name: 'Home',
        centerLatitude: 0,
        centerLongitude: 0,
        radiusMeters: 100,
        members: [{ memberId: MEMBER }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY}/geofences/${ZONE}`)
      .set(auth('member'))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY}/geofences/${ZONE}`)
      .set(auth('manager'))
      .send({ name: 'Safe Home' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/families/${FAMILY}/geofences/${ZONE}/members`)
      .set(auth('manager'))
      .send({
        members: [
          { memberId: MEMBER, notifyOnEnter: true, notifyOnExit: true },
        ],
      })
      .expect(200);
  });

  it('blocks non-manager, foreign family, foreign member, unknown fields, and unrelated reads', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY}/geofences/${ZONE}`)
      .set(auth('member'))
      .send({ name: 'No' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/families/${FOREIGN_FAMILY}/geofences`)
      .set(auth('manager'))
      .send({
        name: 'No',
        centerLatitude: 0,
        centerLongitude: 0,
        radiusMeters: 100,
      })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/families/${FAMILY}/geofences/${ZONE}/members`)
      .set(auth('manager'))
      .send({ members: [{ memberId: FOREIGN_MEMBER }] })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/families/${FAMILY}/geofences/${ZONE}`)
      .set(auth('manager'))
      .send({ createdBy: MANAGER })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY}/geofences/events`)
      .set(auth('unrelated'))
      .expect(403);
  });

  const report = (longitude: number, timestamp?: Date) => {
    capturedAt += 1000;
    return request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE}/locations`)
      .set(auth('member'))
      .send({
        latitude: 0,
        longitude,
        recordedAt: (timestamp ?? new Date(capturedAt)).toISOString(),
      });
  };

  it('establishes initial outside state, persists one enter/exit, and suppresses duplicates/stale points', async () => {
    realtime.emitToUser.mockClear();
    await report(0.002).expect(201);
    expect(geofences.events).toHaveLength(0);
    await report(0).expect(201);
    expect(geofences.events.map((item) => item.event_type)).toEqual(['enter']);
    expect(notifications.processGeofenceEvent).toHaveBeenCalledWith(
      geofences.events[0].id,
    );
    expect(realtime.emitToUser).toHaveBeenCalledWith(
      MANAGER,
      'geofence.entered',
      expect.any(Object),
    );
    await report(0.0001).expect(201);
    expect(geofences.events).toHaveLength(1);
    await report(0.002).expect(201);
    expect(geofences.events.map((item) => item.event_type)).toEqual([
      'exit',
      'enter',
    ]);
    await report(0, new Date(capturedAt - 30_000)).expect(201);
    expect(geofences.events).toHaveLength(2);
    expect(notifications.processGeofenceEvent).toHaveBeenCalledTimes(2);
  });

  it('honors global and per-family source privacy despite assignment', async () => {
    geofences.globalSharing = false;
    await report(0).expect(201);
    expect(geofences.events).toHaveLength(2);
    geofences.globalSharing = true;
    geofences.memberSharing = false;
    await report(0).expect(201);
    expect(geofences.events).toHaveLength(2);
    geofences.memberSharing = true;
  });

  it('denies pending/removed membership and inactive zones produce no transitions', async () => {
    for (const status of ['pending', 'rejected', 'removed']) {
      geofences.memberStatus = status;
      await request(app.getHttpServer())
        .get(`/api/v1/families/${FAMILY}/geofences`)
        .set(auth('member'))
        .expect(403);
      await report(0).expect(201);
      expect(geofences.events).toHaveLength(2);
    }
    geofences.memberStatus = 'accepted';
    await request(app.getHttpServer())
      .delete(`/api/v1/families/${FAMILY}/geofences/${ZONE}`)
      .set(auth('manager'))
      .expect(204);
    await report(0).expect(201);
    expect(geofences.events).toHaveLength(2);
  });

  afterAll(async () => app.close());
});
