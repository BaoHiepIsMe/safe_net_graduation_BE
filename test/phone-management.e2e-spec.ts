import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { FirebaseService } from '../src/infrastructure/firebase/firebase.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RealtimeGateway } from '../src/infrastructure/realtime/realtime.gateway';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { PhoneManagementRepository } from '../src/modules/phone-management/phone-management.repository';

const MANAGER = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';
const ADULT = '33333333-3333-4333-8333-333333333333';
const UNRELATED = '44444444-4444-4444-8444-444444444444';
const FAMILY = '55555555-5555-4555-8555-555555555555';
const MEMBER = '66666666-6666-4666-8666-666666666666';
const DEVICE = '77777777-7777-4777-8777-777777777777';
const FOREIGN_DEVICE = '88888888-8888-4888-8888-888888888888';
const CHILD_SECOND_DEVICE = '99999999-9999-4999-8999-999999999999';

class InMemoryPhoneRepository {
  managerStatus = 'accepted';
  managerRole = 'manager';
  childStatus = 'accepted';
  childRole = 'child';
  deviceActive = true;
  usages: any[] = [];
  rules: any[] = [];
  commands: any[] = [];

  private managerAllowed(actor: string) {
    return (
      actor === MANAGER &&
      this.managerStatus === 'accepted' &&
      this.managerRole === 'manager'
    );
  }

  private childAllowed(memberId = MEMBER) {
    return (
      memberId === MEMBER &&
      this.childStatus === 'accepted' &&
      this.childRole === 'child'
    );
  }

  createUsage(
    actor: string,
    familyId: string,
    memberId: string,
    deviceId: string,
    dto: any,
    fingerprint: string,
  ) {
    if (
      actor !== CHILD ||
      familyId !== FAMILY ||
      !this.childAllowed(memberId) ||
      deviceId !== DEVICE ||
      !this.deviceActive
    ) {
      return Promise.resolve({ outcome: 'invalid_target' });
    }
    const existing = this.usages.find(
      (usage) =>
        usage.deviceId === deviceId &&
        usage.clientRecordId === dto.clientRecordId,
    );
    if (existing) {
      return Promise.resolve(
        existing.requestFingerprint === fingerprint
          ? { outcome: 'reused', usage: existing }
          : { outcome: 'conflict' },
      );
    }
    const usage = {
      id: crypto.randomUUID(),
      memberId,
      deviceId,
      clientRecordId: dto.clientRecordId,
      requestFingerprint: fingerprint,
      appName: dto.appName ?? null,
      appPackage: dto.appPackage,
      startedAt: new Date(dto.startedAt),
      endedAt: new Date(dto.endedAt),
      durationSeconds: dto.durationSeconds,
      createdAt: new Date(),
    };
    this.usages.push(usage);
    return Promise.resolve({ outcome: 'created', usage });
  }

  listOwnUsage(actor: string, query: any) {
    return Promise.resolve(
      actor === CHILD && this.childAllowed()
        ? this.usages.slice(0, query.limit + 1)
        : [],
    );
  }

  listManagedUsage(
    actor: string,
    familyId: string,
    memberId: string,
    query: any,
  ) {
    if (
      familyId !== FAMILY ||
      !this.managerAllowed(actor) ||
      !this.childAllowed(memberId)
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    return Promise.resolve({
      outcome: 'listed',
      rows: this.usages.slice(0, query.limit + 1),
    });
  }

  createRule(actor: string, familyId: string, memberId: string, data: any) {
    if (
      familyId !== FAMILY ||
      !this.managerAllowed(actor) ||
      !this.childAllowed(memberId)
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    if (this.rules.length) return Promise.resolve({ outcome: 'conflict' });
    const now = new Date();
    const rule = {
      id: crypto.randomUUID(),
      familyId,
      memberId,
      dailyLimitMinutes: data.dailyLimitMinutes ?? null,
      bedtimeStart: data.bedtimeStart ?? null,
      bedtimeEnd: data.bedtimeEnd ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.rules.push(rule);
    return Promise.resolve({ outcome: 'created', rule });
  }

  listRules(actor: string, familyId: string, memberId: string) {
    return Promise.resolve(
      familyId === FAMILY &&
        this.managerAllowed(actor) &&
        this.childAllowed(memberId)
        ? { outcome: 'listed', rules: this.rules }
        : { outcome: 'forbidden' },
    );
  }

  listOwnRules(actor: string) {
    return Promise.resolve(
      actor === CHILD && this.childAllowed()
        ? this.rules.filter((rule) => rule.isActive)
        : [],
    );
  }

  updateRule(
    actor: string,
    familyId: string,
    memberId: string,
    ruleId: string,
    data: any,
  ) {
    if (
      familyId !== FAMILY ||
      !this.managerAllowed(actor) ||
      !this.childAllowed(memberId)
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    const rule = this.rules.find((item) => item.id === ruleId);
    if (!rule) return Promise.resolve({ outcome: 'not_found' });
    Object.assign(rule, data, { updatedAt: new Date() });
    return Promise.resolve({ outcome: 'updated', rule });
  }

  deactivateRule(
    actor: string,
    familyId: string,
    memberId: string,
    ruleId: string,
  ) {
    return this.updateRule(actor, familyId, memberId, ruleId, {
      isActive: false,
    });
  }

  createCommand(
    actor: string,
    familyId: string,
    memberId: string,
    deviceId: string,
    dto: any,
    fingerprint: string,
  ) {
    if (
      familyId !== FAMILY ||
      !this.managerAllowed(actor) ||
      !this.childAllowed(memberId)
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    if (deviceId !== DEVICE || !this.deviceActive) {
      return Promise.resolve({ outcome: 'invalid_target' });
    }
    const existing = this.commands.find(
      (command) =>
        command.creatorUserId === actor &&
        command.clientRequestId === dto.clientRequestId,
    );
    if (existing) {
      return Promise.resolve(
        existing.requestFingerprint === fingerprint
          ? {
              outcome: 'reused',
              command: existing,
              targetUserId: CHILD,
              fcmToken: 'private-token',
            }
          : { outcome: 'conflict' },
      );
    }
    const now = new Date();
    const command = {
      id: crypto.randomUUID(),
      familyId,
      memberId,
      targetDeviceId: deviceId,
      creatorUserId: actor,
      clientRequestId: dto.clientRequestId,
      requestFingerprint: fingerprint,
      commandType: dto.commandType,
      commandPayload:
        dto.commandType === 'warning' ? { message: dto.message } : null,
      status: 'pending',
      resultCode: null,
      resultMessage: null,
      createdAt: now,
      sentAt: null,
      acknowledgedAt: null,
      updatedAt: now,
    };
    this.commands.push(command);
    return Promise.resolve({
      outcome: 'created',
      command,
      targetUserId: CHILD,
      fcmToken: 'private-token',
    });
  }

  markCommandSent(commandId: string) {
    const command = this.commands.find((item) => item.id === commandId);
    if (command?.status === 'pending') {
      command.status = 'sent';
      command.sentAt = new Date();
    }
    return Promise.resolve({ count: command ? 1 : 0 });
  }

  clearInvalidToken() {
    return Promise.resolve({ count: 1 });
  }

  listDeviceCommands(actor: string, deviceId: string, query: any) {
    if (
      actor !== CHILD ||
      deviceId !== DEVICE ||
      !this.deviceActive ||
      !this.childAllowed()
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    return Promise.resolve({
      outcome: 'listed',
      commands: this.commands.slice(0, query.limit + 1),
    });
  }

  listManagedCommands(
    actor: string,
    familyId: string,
    memberId: string,
    query: any,
  ) {
    if (
      familyId !== FAMILY ||
      !this.managerAllowed(actor) ||
      !this.childAllowed(memberId)
    ) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    return Promise.resolve({
      outcome: 'listed',
      commands: this.commands.slice(0, query.limit + 1),
    });
  }

  acknowledgeCommand(
    actor: string,
    deviceId: string,
    commandId: string,
    dto: any,
  ) {
    if (actor !== CHILD || deviceId !== DEVICE || !this.deviceActive) {
      return Promise.resolve({ outcome: 'forbidden' });
    }
    const command = this.commands.find((item) => item.id === commandId);
    if (!command || !this.childAllowed()) {
      return Promise.resolve({ outcome: 'not_found' });
    }
    if (command.status === 'completed' || command.status === 'failed') {
      const same =
        command.status === dto.status &&
        command.resultCode === (dto.resultCode ?? null) &&
        command.resultMessage === (dto.message ?? null);
      return Promise.resolve(
        same ? { outcome: 'unchanged', command } : { outcome: 'invalid_state' },
      );
    }
    command.status = dto.status;
    command.resultCode = dto.resultCode ?? null;
    command.resultMessage = dto.message ?? null;
    command.acknowledgedAt = new Date();
    command.updatedAt = new Date();
    return Promise.resolve({ outcome: 'updated', command });
  }
}

describe('Phase 11 Phone Management (e2e)', () => {
  let app: INestApplication<App>;
  let repository: InMemoryPhoneRepository;
  const firebase = { sendPushNotification: jest.fn() };
  const realtime = { emitToUser: jest.fn() };
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    repository = new InMemoryPhoneRepository();
    firebase.sendPushNotification.mockResolvedValue({ status: 'success' });
    const fixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseService)
      .useValue({
        verifyToken: jest.fn((token: string) => {
          const users: Record<string, string> = {
            manager: MANAGER,
            child: CHILD,
            adult: ADULT,
            unrelated: UNRELATED,
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
      .overrideProvider(PhoneManagementRepository)
      .useValue(repository)
      .overrideProvider(FirebaseService)
      .useValue(firebase)
      .overrideProvider(RealtimeGateway)
      .useValue(realtime)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('A: child Device submits idempotent telemetry, manager reads it, unrelated user cannot', async () => {
    const recordId = crypto.randomUUID();
    const body = {
      clientRecordId: recordId,
      appPackage: 'com.example.learning',
      appName: 'Learning',
      startedAt: '2020-01-01T00:00:00Z',
      endedAt: '2020-01-01T00:10:00Z',
      durationSeconds: 600,
    };
    const path = `/api/v1/families/${FAMILY}/members/${MEMBER}/devices/${DEVICE}/phone-usage`;
    const first = await request(app.getHttpServer())
      .post(path)
      .set(auth('child'))
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(path)
      .set(auth('child'))
      .send(body)
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(repository.usages).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY}/members/${MEMBER}/phone-usage`)
      .set(auth('manager'))
      .expect(200)
      .expect((response) => expect(response.body.data).toHaveLength(1));
    await request(app.getHttpServer())
      .get(`/api/v1/families/${FAMILY}/members/${MEMBER}/phone-usage`)
      .set(auth('unrelated'))
      .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set(auth('manager'))
      .send({ ...body, clientRecordId: crypto.randomUUID() })
      .expect(403);
  });

  it('B: manager creates policy intent, child reads it, adult cannot mutate', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/v1/families/${FAMILY}/members/${MEMBER}/phone-rules`)
      .set(auth('manager'))
      .send({
        dailyLimitMinutes: 120,
        bedtimeStart: '21:30',
        bedtimeEnd: '06:30',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      enforcementStatus: 'device_enforcement_pending',
    });
    await request(app.getHttpServer())
      .get('/api/v1/phone-management/me/rules')
      .set(auth('child'))
      .expect(200)
      .expect((response) => expect(response.body.data).toHaveLength(1));
    await request(app.getHttpServer())
      .patch(
        `/api/v1/families/${FAMILY}/members/${MEMBER}/phone-rules/${created.body.data.id}`,
      )
      .set(auth('adult'))
      .send({ dailyLimitMinutes: 60 })
      .expect(403);
  });

  it('C/D/E: command persists, transport is not completion, only target Device ACK completes', async () => {
    const clientRequestId = crypto.randomUUID();
    const path = `/api/v1/families/${FAMILY}/members/${MEMBER}/devices/${DEVICE}/phone-commands`;
    const created = await request(app.getHttpServer())
      .post(path)
      .set(auth('manager'))
      .send({ clientRequestId, commandType: 'lock' })
      .expect(201);
    expect(created.body.data.status).toBe('sent');
    expect(created.body.data.status).not.toBe('completed');
    const commandId = created.body.data.id;
    await request(app.getHttpServer())
      .post(path)
      .set(auth('manager'))
      .send({ clientRequestId, commandType: 'lock' })
      .expect(201)
      .expect((response) => expect(response.body.data.id).toBe(commandId));
    expect(repository.commands).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/api/v1/devices/${FOREIGN_DEVICE}/phone-commands`)
      .set(auth('unrelated'))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE}/phone-commands/${commandId}/ack`)
      .set(auth('manager'))
      .send({ status: 'completed' })
      .expect(403);
    // Ownership of another active Device by the same user would still not bind
    // it to this command: ACK authorization is the exact target Device ID.
    await request(app.getHttpServer())
      .post(
        `/api/v1/devices/${CHILD_SECOND_DEVICE}/phone-commands/${commandId}/ack`,
      )
      .set(auth('child'))
      .send({ status: 'completed' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE}/phone-commands/${commandId}/ack`)
      .set(auth('child'))
      .send({ status: 'completed' })
      .expect(200)
      .expect((response) =>
        expect(response.body.data.status).toBe('completed'),
      );
    await request(app.getHttpServer())
      .post(`/api/v1/devices/${DEVICE}/phone-commands/${commandId}/ack`)
      .set(auth('child'))
      .send({ status: 'failed', resultCode: 'NO' })
      .expect(409);
  });

  it('F: manager demotion and child removal revoke new management immediately', async () => {
    repository.managerRole = 'adult';
    await request(app.getHttpServer())
      .post(
        `/api/v1/families/${FAMILY}/members/${MEMBER}/devices/${DEVICE}/phone-commands`,
      )
      .set(auth('manager'))
      .send({ clientRequestId: crypto.randomUUID(), commandType: 'ring' })
      .expect(403);
    repository.managerRole = 'manager';
    repository.childStatus = 'removed';
    await request(app.getHttpServer())
      .post(
        `/api/v1/families/${FAMILY}/members/${MEMBER}/devices/${DEVICE}/phone-commands`,
      )
      .set(auth('manager'))
      .send({ clientRequestId: crypto.randomUUID(), commandType: 'ring' })
      .expect(403);
    repository.childStatus = 'accepted';
  });

  it('G: FCM failure leaves the committed command pending and pollable', async () => {
    firebase.sendPushNotification.mockResolvedValueOnce({ status: 'failure' });
    const created = await request(app.getHttpServer())
      .post(
        `/api/v1/families/${FAMILY}/members/${MEMBER}/devices/${DEVICE}/phone-commands`,
      )
      .set(auth('manager'))
      .send({ clientRequestId: crypto.randomUUID(), commandType: 'ring' })
      .expect(201);
    expect(created.body.data.status).toBe('pending');
    expect(
      repository.commands.find(
        (command) => command.id === created.body.data.id,
      ),
    ).toBeDefined();
    await request(app.getHttpServer())
      .get(`/api/v1/devices/${DEVICE}/phone-commands?status=pending`)
      .set(auth('child'))
      .expect(200)
      .expect((response) =>
        expect(response.body.data.map((item: any) => item.id)).toContain(
          created.body.data.id,
        ),
      );
  });

  it('rejects ownership, status and completion spoofing through strict Zod', async () => {
    for (const body of [
      {
        clientRequestId: crypto.randomUUID(),
        commandType: 'lock',
        userId: CHILD,
      },
      {
        clientRequestId: crypto.randomUUID(),
        commandType: 'lock',
        status: 'completed',
      },
      { clientRequestId: crypto.randomUUID(), commandType: 'fall' },
    ]) {
      await request(app.getHttpServer())
        .post(
          `/api/v1/families/${FAMILY}/members/${MEMBER}/devices/${DEVICE}/phone-commands`,
        )
        .set(auth('manager'))
        .send(body)
        .expect(400);
    }
  });

  afterAll(async () => app.close());
});
