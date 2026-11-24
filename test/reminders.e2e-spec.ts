import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SupabaseService } from '../src/infrastructure/supabase/supabase.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ReminderEventsService } from '../src/modules/reminders/reminder-events.service';
import { ReminderSchedulerService } from '../src/modules/reminders/reminder-scheduler.service';
import { RemindersRepository } from '../src/modules/reminders/reminders.repository';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const MEMBER_A = '55555555-5555-4555-8555-555555555555';
const MEMBER_B = '66666666-6666-4666-8666-666666666666';
const MEMBER_PENDING = '77777777-7777-4777-8777-777777777777';

class InMemoryRemindersRepository {
  reminders: any[] = [];
  logs: any[] = [];
  memberStatuses: Record<string, string> = {
    [USER_A]: 'accepted',
    [USER_B]: 'accepted',
    [USER_C]: 'pending',
  };
  familyActive = true;

  private member(id: string) {
    if (id === MEMBER_A)
      return {
        id,
        userId: USER_A,
        canManageCare: true,
        isCareRecipient: false,
        status: this.memberStatuses[USER_A],
      };
    if (id === MEMBER_B)
      return {
        id,
        userId: USER_B,
        canManageCare: false,
        isCareRecipient: true,
        status: this.memberStatuses[USER_B],
      };
    if (id === MEMBER_PENDING)
      return {
        id,
        userId: USER_C,
        canManageCare: false,
        isCareRecipient: true,
        status: 'pending',
      };
    return null;
  }

  private isVisible(userId: string, reminder: any) {
    return (
      this.familyActive &&
      this.memberStatuses[userId] === 'accepted' &&
      (reminder.creatorUserId === userId ||
        reminder.targets.some((target: any) => target.member.userId === userId))
    );
  }

  create(actorUserId: string, dto: any, schedule: any) {
    if (
      actorUserId !== USER_A ||
      dto.familyId !== FAMILY ||
      !this.familyActive ||
      this.memberStatuses[USER_A] !== 'accepted'
    )
      return Promise.resolve({ outcome: 'forbidden' });
    const members = dto.targetMemberIds.map((id: string) => this.member(id));
    if (members.some((member: any) => !member || member.status !== 'accepted'))
      return Promise.resolve({ outcome: 'invalid_target' });
    const now = new Date();
    const reminder = {
      id: crypto.randomUUID(),
      familyId: FAMILY,
      creatorUserId: actorUserId,
      title: dto.title,
      description: dto.description ?? null,
      reminderType: dto.reminderType ?? null,
      ...schedule,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      creator: { id: USER_A, fullName: 'Manager A', avatarUrl: null },
      targets: members.map((member: any) => ({
        member: {
          ...member,
          displayName: null,
          profile: {
            fullName: member.userId === USER_B ? 'Member B' : 'Manager A',
            avatarUrl: null,
          },
        },
      })),
    };
    this.reminders.push(reminder);
    return Promise.resolve({ outcome: 'created', reminder });
  }

  listVisible(userId: string, query: any) {
    return Promise.resolve(
      this.reminders
        .filter(
          (reminder) =>
            this.isVisible(userId, reminder) &&
            (!query.active || reminder.isActive === (query.active === 'true')),
        )
        .slice(0, query.limit + 1),
    );
  }

  listUpcoming(userId: string, _now: Date, until: Date, limit: number) {
    return Promise.resolve(
      this.reminders
        .filter(
          (reminder) =>
            this.isVisible(userId, reminder) &&
            reminder.isActive &&
            reminder.nextOccurrenceAt &&
            reminder.nextOccurrenceAt <= until,
        )
        .slice(0, limit),
    );
  }

  findVisible(userId: string, reminderId: string) {
    return Promise.resolve(
      this.reminders.find(
        (reminder) =>
          reminder.id === reminderId && this.isVisible(userId, reminder),
      ) ?? null,
    );
  }

  update(userId: string, reminderId: string, dto: any, schedule?: any) {
    const reminder = this.reminders.find(
      (item) =>
        item.id === reminderId &&
        userId === USER_A &&
        this.familyActive &&
        this.memberStatuses[USER_A] === 'accepted',
    );
    if (!reminder) return Promise.resolve({ outcome: 'not_found' });
    if (dto.targetMemberIds) {
      const members = dto.targetMemberIds.map((id: string) => this.member(id));
      if (
        members.some((member: any) => !member || member.status !== 'accepted')
      )
        return Promise.resolve({ outcome: 'invalid_target' });
    }
    Object.assign(reminder, dto, schedule, { updatedAt: new Date() });
    if (dto.isActive === false) {
      reminder.isActive = false;
      reminder.nextOccurrenceAt = null;
    }
    return Promise.resolve({ outcome: 'updated', reminder });
  }

  deactivate(userId: string, reminderId: string) {
    return this.update(userId, reminderId, { isActive: false });
  }

  canViewReminder(userId: string, reminderId: string) {
    return this.reminders.some(
      (reminder) =>
        reminder.id === reminderId && this.isVisible(userId, reminder),
    );
  }

  canView(userId: string, reminderId: string) {
    return Promise.resolve(this.canViewReminder(userId, reminderId));
  }

  listLogs(userId: string, reminderId: string, query: any) {
    if (!this.canViewReminder(userId, reminderId)) return Promise.resolve([]);
    return Promise.resolve(
      this.logs
        .filter((log) => log.reminderId === reminderId)
        .slice(0, query.limit + 1),
    );
  }

  listDue(now: Date, limit: number) {
    return Promise.resolve(
      this.reminders
        .filter(
          (reminder) =>
            reminder.isActive &&
            reminder.nextOccurrenceAt &&
            reminder.nextOccurrenceAt <= now,
        )
        .slice(0, limit)
        .map((reminder) => ({
          id: reminder.id,
          nextOccurrenceAt: reminder.nextOccurrenceAt,
        })),
    );
  }

  claimOccurrence(
    reminderId: string,
    occurrenceAt: Date,
    now: Date,
    cutoff: Date,
  ) {
    const reminder = this.reminders.find(
      (item) =>
        item.id === reminderId &&
        item.isActive &&
        item.nextOccurrenceAt?.getTime() === occurrenceAt.getTime(),
    );
    if (!reminder)
      return Promise.resolve({ outcome: 'skipped', dueLogIds: [] });
    const missed = occurrenceAt < cutoff;
    const dueLogIds: string[] = [];
    reminder.targets
      .filter(
        (target: any) =>
          this.familyActive &&
          this.memberStatuses[target.member.userId] === 'accepted',
      )
      .forEach((target: any) => {
        const existing = this.logs.find(
          (log) =>
            log.reminderId === reminderId &&
            log.memberId === target.member.id &&
            log.scheduledAt.getTime() === occurrenceAt.getTime(),
        );
        if (existing) return;
        const log = {
          id: crypto.randomUUID(),
          reminderId,
          memberId: target.member.id,
          scheduledAt: occurrenceAt,
          status: missed ? 'missed' : 'due',
          processedAt: now,
          completedAt: null,
          notificationProcessedAt: null,
          member: {
            userId: target.member.userId,
            displayName: target.member.displayName,
            profile: target.member.profile,
          },
        };
        this.logs.push(log);
        if (!missed) dueLogIds.push(log.id);
      });
    reminder.nextOccurrenceAt = null;
    reminder.isActive = false;
    return Promise.resolve({ outcome: missed ? 'missed' : 'due', dueLogIds });
  }

  listPendingNotificationLogs(limit: number) {
    return Promise.resolve(
      this.logs
        .filter((log) => log.status === 'due' && !log.notificationProcessedAt)
        .slice(0, limit)
        .map(({ id }) => ({ id })),
    );
  }

  markNotificationProcessed(logId: string) {
    const log = this.logs.find((item) => item.id === logId);
    if (log) log.notificationProcessedAt = new Date();
    return Promise.resolve({ count: log ? 1 : 0 });
  }

  completeLog(userId: string, logId: string, _note: unknown, now: Date) {
    const log = this.logs.find(
      (item) =>
        item.id === logId &&
        item.member.userId === userId &&
        this.familyActive &&
        this.memberStatuses[userId] === 'accepted',
    );
    if (!log) return Promise.resolve({ outcome: 'not_found' });
    if (log.status === 'missed') return Promise.resolve({ outcome: 'missed' });
    const changed = log.status === 'due';
    if (changed) {
      log.status = 'completed';
      log.completedAt = now;
    }
    return Promise.resolve({ outcome: 'completed', changed, log });
  }

  markUnconfirmedMissed(cutoff: Date, limit: number) {
    const stale = this.logs
      .filter((log) => log.status === 'due' && log.scheduledAt < cutoff)
      .slice(0, limit);
    stale.forEach((log) => (log.status = 'missed'));
    return Promise.resolve(stale.map(({ id }) => id));
  }

  findLogsForBroadcast(logIds: string[]) {
    return Promise.resolve(
      this.logs
        .filter((log) => logIds.includes(log.id))
        .map((log) => ({
          ...log,
          reminder: {
            creatorUserId: this.reminders.find((r) => r.id === log.reminderId)
              ?.creatorUserId,
            familyId: FAMILY,
          },
        })),
    );
  }

  managerUserIds() {
    return Promise.resolve([USER_A]);
  }
}

class InMemoryNotificationService {
  notifications: any[] = [];
  fcmFailure = false;

  constructor(private readonly reminders: InMemoryRemindersRepository) {}

  processReminderLog(logId: string) {
    const log = this.reminders.logs.find((item) => item.id === logId);
    if (!log) return Promise.resolve([]);
    if (
      !this.notifications.some((item) => item.metadata.reminderLogId === logId)
    ) {
      this.notifications.push({
        id: crypto.randomUUID(),
        recipientUserId: log.member.userId,
        type: 'reminder',
        title: 'Reminder due',
        message: 'Medicine',
        metadata: { reminderId: log.reminderId, reminderLogId: logId },
        isRead: false,
        readAt: null,
        createdAt: new Date(),
      });
    }
    // A provider failure is intentionally isolated after durable notification creation.
    return Promise.resolve(this.fcmFailure ? [] : [{}]);
  }

  list(userId: string, query: any) {
    const data = this.notifications.filter(
      (item) =>
        item.recipientUserId === userId &&
        (!query.type || item.type === query.type),
    );
    return Promise.resolve({
      data: data.map(({ recipientUserId: _recipient, ...safe }) => safe),
      pagination: { limit: query.limit, nextCursor: null, hasMore: false },
    });
  }

  unreadCount(userId: string) {
    return Promise.resolve({
      count: this.notifications.filter(
        (item) => item.recipientUserId === userId && !item.isRead,
      ).length,
    });
  }

  getOne() {
    return Promise.resolve(null);
  }

  markRead() {
    return Promise.resolve(null);
  }

  markAllRead() {
    return Promise.resolve({ updatedCount: 0 });
  }
}

describe('Phase 9 Reminders (e2e)', () => {
  let app: INestApplication<App>;
  const reminders = new InMemoryRemindersRepository();
  const notifications = new InMemoryNotificationService(reminders);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const future = () => new Date(Date.now() + 120_000);

  beforeAll(async () => {
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
      .overrideProvider(RemindersRepository)
      .useValue(reminders)
      .overrideProvider(NotificationsService)
      .useValue(notifications)
      .compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  let reminderId: string;

  it('A: manager creates an atomic reminder and accepted target can view it', async () => {
    const at = future();
    const created = await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-a'))
      .send({
        familyId: FAMILY,
        title: 'Medicine',
        schedule: {
          type: 'once',
          occurrenceAt: at.toISOString(),
          timezone: 'UTC',
        },
        targetMemberIds: [MEMBER_B],
      })
      .expect(201);
    reminderId = created.body.data.id;
    await request(app.getHttpServer())
      .get(`/api/v1/reminders/${reminderId}`)
      .set(auth('token-b'))
      .expect(200);
  });

  it('keeps upcoming data and horizon metadata at the envelope root', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/reminders/upcoming?days=7')
      .set(auth('token-a'))
      .expect(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.horizonEndsAt).toEqual(expect.any(String));
    expect(response.body.data).not.toHaveProperty('data');
  });

  it('B: due execution persists one log and one unread target notification', async () => {
    const reminder = reminders.reminders.find((item) => item.id === reminderId);
    await app
      .get(ReminderSchedulerService)
      .runDue(new Date(reminder.nextOccurrenceAt.getTime() + 60_000));
    expect(
      reminders.logs.filter((log) => log.reminderId === reminderId),
    ).toHaveLength(1);
    await request(app.getHttpServer())
      .get('/api/v1/notifications?type=reminder')
      .set(auth('token-b'))
      .expect(200)
      .expect((response) => expect(response.body.data).toHaveLength(1));
    await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set(auth('token-b'))
      .expect(200)
      .expect((response) => expect(response.body.data.count).toBe(1));
  });

  it('C: reprocessing the occurrence creates no duplicate log or notification', async () => {
    await app
      .get(ReminderSchedulerService)
      .runDue(new Date(Date.now() + 600_000));
    expect(
      reminders.logs.filter((log) => log.reminderId === reminderId),
    ).toHaveLength(1);
    expect(
      notifications.notifications.filter(
        (item) => item.metadata.reminderId === reminderId,
      ),
    ).toHaveLength(1);
  });

  it('two scheduler instances produce one occurrence and one notification', async () => {
    const at = future();
    const created = await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-a'))
      .send({
        familyId: FAMILY,
        title: 'Concurrent workers',
        schedule: {
          type: 'once',
          occurrenceAt: at.toISOString(),
          timezone: 'UTC',
        },
        targetMemberIds: [MEMBER_B],
      })
      .expect(201);
    const secondWorker = new ReminderSchedulerService(
      reminders as unknown as RemindersRepository,
      notifications as unknown as NotificationsService,
      app.get(ReminderEventsService),
    );
    await Promise.all([
      app.get(ReminderSchedulerService).runDue(new Date(at.getTime() + 60_000)),
      secondWorker.runDue(new Date(at.getTime() + 60_000)),
    ]);
    expect(
      reminders.logs.filter((log) => log.reminderId === created.body.data.id),
    ).toHaveLength(1);
    expect(
      notifications.notifications.filter(
        (item) => item.metadata.reminderId === created.body.data.id,
      ),
    ).toHaveLength(1);
  });

  it('recipient confirms a due occurrence once; others cannot', async () => {
    const log = reminders.logs.find(
      (item) => item.reminderId === reminderId && item.status === 'due',
    );
    await request(app.getHttpServer())
      .patch(`/api/v1/reminders/logs/${log.id}/complete`)
      .set(auth('token-a'))
      .send({})
      .expect(404);
    const done = await request(app.getHttpServer())
      .patch(`/api/v1/reminders/logs/${log.id}/complete`)
      .set(auth('token-b'))
      .send({})
      .expect(200);
    expect(done.body.data.status).toBe('completed');
    expect(done.body.data.completedAt).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .patch(`/api/v1/reminders/logs/${log.id}/complete`)
      .set(auth('token-b'))
      .send({})
      .expect(200);
  });

  it('an unconfirmed due occurrence becomes missed and cannot be completed', async () => {
    const log = {
      id: crypto.randomUUID(),
      reminderId,
      memberId: MEMBER_B,
      scheduledAt: new Date(Date.now() - 2 * 60 * 60_000),
      status: 'due',
      processedAt: new Date(),
      completedAt: null,
      notificationProcessedAt: new Date(),
      member: { userId: USER_B, displayName: null, profile: {} },
    };
    reminders.logs.push(log);
    await app.get(ReminderSchedulerService).runDue(new Date());
    expect(log.status).toBe('missed');
    await request(app.getHttpServer())
      .patch(`/api/v1/reminders/logs/${log.id}/complete`)
      .set(auth('token-b'))
      .send({})
      .expect(422)
      .expect((response) =>
        expect(response.body.error.code).toBe('REMINDER_OCCURRENCE_CONFLICT'),
      );
  });

  it('D: unrelated user cannot read, update or fetch logs', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/reminders/${reminderId}`)
      .set(auth('token-c'))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/reminders/${reminderId}`)
      .set(auth('token-c'))
      .send({ title: 'Stolen' })
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/reminders/${reminderId}/logs`)
      .set(auth('token-c'))
      .expect(404);
  });

  it('revokes creator and target visibility after accepted membership loss', async () => {
    reminders.memberStatuses[USER_A] = 'removed';
    await request(app.getHttpServer())
      .get(`/api/v1/reminders/${reminderId}`)
      .set(auth('token-a'))
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/reminders/${reminderId}/logs`)
      .set(auth('token-a'))
      .expect(404);
    reminders.memberStatuses[USER_A] = 'accepted';

    reminders.memberStatuses[USER_B] = 'removed';
    await request(app.getHttpServer())
      .get(`/api/v1/reminders/${reminderId}`)
      .set(auth('token-b'))
      .expect(404);
    reminders.memberStatuses[USER_B] = 'accepted';
  });

  it('removed target receives no future occurrence or notification', async () => {
    const at = future();
    const created = await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-a'))
      .send({
        familyId: FAMILY,
        title: 'Revoked target',
        schedule: {
          type: 'once',
          occurrenceAt: at.toISOString(),
          timezone: 'UTC',
        },
        targetMemberIds: [MEMBER_B],
      })
      .expect(201);
    reminders.memberStatuses[USER_B] = 'removed';
    await app
      .get(ReminderSchedulerService)
      .runDue(new Date(at.getTime() + 60_000));
    expect(
      reminders.logs.some((log) => log.reminderId === created.body.data.id),
    ).toBe(false);
    expect(
      notifications.notifications.some(
        (item) => item.metadata.reminderId === created.body.data.id,
      ),
    ).toBe(false);
    reminders.memberStatuses[USER_B] = 'accepted';
  });

  it('E: deactivated reminder creates no occurrence', async () => {
    const at = future();
    const created = await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-a'))
      .send({
        familyId: FAMILY,
        title: 'Deactivate',
        schedule: {
          type: 'once',
          occurrenceAt: at.toISOString(),
          timezone: 'UTC',
        },
        targetMemberIds: [MEMBER_B],
      })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/reminders/${created.body.data.id}`)
      .set(auth('token-a'))
      .expect(204);
    await app
      .get(ReminderSchedulerService)
      .runDue(new Date(at.getTime() + 60_000));
    expect(
      reminders.logs.some((log) => log.reminderId === created.body.data.id),
    ).toBe(false);
  });

  it('F: mocked FCM failure leaves ReminderLog and Notification durable', async () => {
    const at = future();
    const created = await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-a'))
      .send({
        familyId: FAMILY,
        title: 'FCM isolation',
        schedule: {
          type: 'once',
          occurrenceAt: at.toISOString(),
          timezone: 'UTC',
        },
        targetMemberIds: [MEMBER_B],
      })
      .expect(201);
    notifications.fcmFailure = true;
    await app
      .get(ReminderSchedulerService)
      .runDue(new Date(at.getTime() + 60_000));
    expect(
      reminders.logs.some((log) => log.reminderId === created.body.data.id),
    ).toBe(true);
    expect(
      notifications.notifications.some(
        (item) => item.metadata.reminderId === created.body.data.id,
      ),
    ).toBe(true);
    notifications.fcmFailure = false;
  });

  it('rejects creator spoofing, pending targets and non-manager creation', async () => {
    const base = {
      familyId: FAMILY,
      title: 'Strict',
      schedule: {
        type: 'once',
        occurrenceAt: future().toISOString(),
        timezone: 'UTC',
      },
      targetMemberIds: [MEMBER_B],
    };
    await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-a'))
      .send({ ...base, createdBy: USER_C })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-a'))
      .send({ ...base, targetMemberIds: [MEMBER_PENDING] })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/v1/reminders')
      .set(auth('token-b'))
      .send(base)
      .expect(403);
  });

  afterAll(async () => app.close());
});
