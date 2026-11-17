import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationsRepository } from './notifications.repository';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const RECIPIENT_ID = '55555555-5555-4555-8555-555555555555';
const GEOFENCE_ID = '66666666-6666-4666-8666-666666666666';
const NOTIFICATION_ID = '77777777-7777-4777-8777-777777777777';

describe('NotificationsRepository geofence privacy and idempotency', () => {
  function setup(overrides?: {
    event?: any;
    assignment?: any;
    existing?: any;
  }) {
    const event =
      overrides && 'event' in overrides
        ? overrides.event
        : {
            id: EVENT_ID,
            family_id: FAMILY_ID,
            member_id: MEMBER_ID,
            event_type: 'enter',
            detected_at: new Date('2026-08-27T00:00:00.000Z'),
            Geofence: { id: GEOFENCE_ID, name: 'Home' },
            FamilyMember: {
              userId: OWNER_ID,
              displayName: 'Owner',
              profile: { fullName: 'Owner Name' },
            },
          };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      geofenceEvent: { findFirst: jest.fn().mockResolvedValue(event) },
      geofenceMember: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            overrides && 'assignment' in overrides
              ? overrides.assignment
              : { notify_on_enter: true, notify_on_exit: true },
          ),
      },
      familyMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: RECIPIENT_ID,
            profile: {
              UserSetting: { pushNotificationsEnabled: true },
              Device: [{ id: crypto.randomUUID() }],
            },
          },
        ]),
      },
      notification: {
        findUnique: jest.fn().mockResolvedValue(overrides?.existing ?? null),
        create: jest.fn().mockResolvedValue({
          id: NOTIFICATION_ID,
          family_id: FAMILY_ID,
          notification_type: 'geofence_enter',
          title: 'Đã vào vùng an toàn',
          message: 'Owner đã vào Home',
          metadata: {},
          is_read: false,
          read_at: null,
          created_at: new Date(),
        }),
      },
      notificationDelivery: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: any) => unknown) => work(tx)),
    };
    return {
      tx,
      repository: new NotificationsRepository(
        prisma as unknown as PrismaService,
      ),
    };
  }

  it('requires active accepted source membership plus global and per-family sharing', async () => {
    const { tx, repository } = setup();
    await repository.createFromGeofenceEvent(EVENT_ID);
    expect(tx.geofenceEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: EVENT_ID,
          Family: { status: 'active' },
          FamilyMember: expect.objectContaining({
            status: 'accepted',
            locationSharingEnabled: true,
            profile: { UserSetting: { locationSharingEnabled: true } },
          }),
        }),
      }),
    );
  });

  it('selects only accepted recipients in the active family with sharing enabled', async () => {
    const { tx, repository } = setup();
    const created = await repository.createFromGeofenceEvent(EVENT_ID);
    expect(tx.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          familyId: FAMILY_ID,
          status: 'accepted',
          locationSharingEnabled: true,
          family: { status: 'active' },
        },
      }),
    );
    expect(created).toHaveLength(1);
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(1);
    expect(
      tx.familyMember.findMany.mock.calls[0][0].select.profile.select.Device
        .where,
    ).toEqual({
      isActive: true,
      fcmToken: { not: null },
    });
  });

  it('creates a stable EXIT notification from an enabled exit assignment', async () => {
    const fixture = setup();
    fixture.tx.geofenceEvent.findFirst.mockResolvedValue({
      ...(await fixture.tx.geofenceEvent.findFirst()),
      event_type: 'exit',
    });
    await fixture.repository.createFromGeofenceEvent(EVENT_ID);
    expect(fixture.tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notification_type: 'geofence_exit' }),
      }),
    );
  });

  it('creates nothing when source privacy fails or assignment delivery is disabled', async () => {
    const sourceDenied = setup({ event: null });
    await expect(
      sourceDenied.repository.createFromGeofenceEvent(EVENT_ID),
    ).resolves.toEqual([]);
    expect(sourceDenied.tx.familyMember.findMany).not.toHaveBeenCalled();

    const assignmentDenied = setup({
      assignment: { notify_on_enter: false, notify_on_exit: true },
    });
    await expect(
      assignmentDenied.repository.createFromGeofenceEvent(EVENT_ID),
    ).resolves.toEqual([]);
    expect(assignmentDenied.tx.familyMember.findMany).not.toHaveBeenCalled();
  });

  it('uses the durable recipient/source key to suppress duplicate notifications', async () => {
    const { tx, repository } = setup({ existing: { id: NOTIFICATION_ID } });
    await expect(repository.createFromGeofenceEvent(EVENT_ID)).resolves.toEqual(
      [],
    );
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('keeps in-app notification creation while push preference suppresses deliveries', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findMany.mockResolvedValue([
      {
        userId: RECIPIENT_ID,
        profile: {
          UserSetting: { pushNotificationsEnabled: false },
          Device: [{ id: crypto.randomUUID() }],
        },
      },
    ]);
    await expect(
      repository.createFromGeofenceEvent(EVENT_ID),
    ).resolves.toHaveLength(1);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });

  it('creates one logical notification while fanning out pending rows to all active token devices', async () => {
    const { tx, repository } = setup();
    tx.familyMember.findMany.mockResolvedValue([
      {
        userId: RECIPIENT_ID,
        profile: {
          UserSetting: { pushNotificationsEnabled: true },
          Device: [{ id: crypto.randomUUID() }, { id: crypto.randomUUID() }],
        },
      },
    ]);
    await repository.createFromGeofenceEvent(EVENT_ID);
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(
      tx.notificationDelivery.createMany.mock.calls[0][0].data,
    ).toHaveLength(2);
  });
});

describe('NotificationsRepository reminder occurrence integration', () => {
  it('creates one notification and multiple device deliveries for one due target log', async () => {
    const logId = crypto.randomUUID();
    const tx = {
      $queryRaw: jest.fn(),
      reminderLog: {
        findUnique: jest.fn().mockResolvedValue({
          id: logId,
          status: 'due',
          memberId: MEMBER_ID,
          scheduledAt: new Date(),
          reminder: {
            id: crypto.randomUUID(),
            familyId: FAMILY_ID,
            creatorUserId: OWNER_ID,
            title: 'Medicine',
            family: { status: 'active' },
            targets: [{ memberId: MEMBER_ID }],
          },
          member: {
            familyId: FAMILY_ID,
            status: 'accepted',
            userId: RECIPIENT_ID,
            profile: {
              UserSetting: { pushNotificationsEnabled: true },
              Device: [
                { id: crypto.randomUUID() },
                { id: crypto.randomUUID() },
              ],
            },
          },
        }),
      },
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: NOTIFICATION_ID }),
      },
      notificationDelivery: { createMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: any) => unknown) => work(tx)),
    };
    const repository = new NotificationsRepository(
      prisma as unknown as PrismaService,
    );
    await expect(repository.createFromReminderLog(logId)).resolves.toHaveLength(
      1,
    );
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([expect.any(Object), expect.any(Object)]),
      }),
    );
  });

  it('reprocessing the same reminder log does not duplicate notification state', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      reminderLog: {
        findUnique: jest.fn().mockResolvedValue({
          id: EVENT_ID,
          status: 'due',
          memberId: MEMBER_ID,
          scheduledAt: new Date(),
          reminder: {
            id: EVENT_ID,
            familyId: FAMILY_ID,
            creatorUserId: OWNER_ID,
            title: 'Due',
            family: { status: 'active' },
            targets: [{ memberId: MEMBER_ID }],
          },
          member: {
            familyId: FAMILY_ID,
            status: 'accepted',
            userId: RECIPIENT_ID,
            profile: { UserSetting: null, Device: [] },
          },
        }),
      },
      notification: {
        findUnique: jest.fn().mockResolvedValue({ id: NOTIFICATION_ID }),
        create: jest.fn(),
      },
      notificationDelivery: { createMany: jest.fn() },
    };
    const repository = new NotificationsRepository({
      $transaction: (work: (client: any) => unknown) => work(tx),
    } as unknown as PrismaService);
    await expect(repository.createFromReminderLog(EVENT_ID)).resolves.toEqual(
      [],
    );
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it.each([
    ['removed member', { memberStatus: 'removed' }],
    ['rejected member', { memberStatus: 'rejected' }],
    ['pending member', { memberStatus: 'pending' }],
    ['inactive family', { familyStatus: 'inactive' }],
    ['removed target assignment', { targets: [] }],
  ])(
    'suppresses reminder delivery for %s at execution time',
    async (_label, state) => {
      const current = state as {
        memberStatus?: string;
        familyStatus?: string;
        targets?: Array<{ memberId: string }>;
      };
      const tx = {
        $queryRaw: jest.fn(),
        reminderLog: {
          findUnique: jest.fn().mockResolvedValue({
            id: EVENT_ID,
            status: 'due',
            memberId: MEMBER_ID,
            scheduledAt: new Date(),
            reminder: {
              id: EVENT_ID,
              familyId: FAMILY_ID,
              creatorUserId: OWNER_ID,
              title: 'Private',
              family: { status: current.familyStatus ?? 'active' },
              targets: current.targets ?? [{ memberId: MEMBER_ID }],
            },
            member: {
              familyId: FAMILY_ID,
              status: current.memberStatus ?? 'accepted',
              userId: RECIPIENT_ID,
              profile: {
                UserSetting: null,
                Device: [{ id: crypto.randomUUID() }],
              },
            },
          }),
        },
        notification: { findUnique: jest.fn(), create: jest.fn() },
        notificationDelivery: { createMany: jest.fn() },
      };
      const repository = new NotificationsRepository({
        $transaction: (work: (client: any) => unknown) => work(tx),
      } as unknown as PrismaService);
      await expect(repository.createFromReminderLog(EVENT_ID)).resolves.toEqual(
        [],
      );
      expect(tx.notification.create).not.toHaveBeenCalled();
    },
  );
});

describe('NotificationsRepository SOS integration', () => {
  it('creates one SOS notification per durable recipient and fans out per device', async () => {
    const sosId = crypto.randomUUID();
    const recipientId = crypto.randomUUID();
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      sosEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: sosId,
          actorUserId: OWNER_ID,
          triggeredAt: new Date('2026-08-31T00:00:00Z'),
          actor: { fullName: 'Actor' },
          recipients: [
            {
              recipientUserId: recipientId,
              recipient: {
                UserSetting: { pushNotificationsEnabled: true },
                Device: [
                  { id: crypto.randomUUID() },
                  { id: crypto.randomUUID() },
                ],
              },
            },
          ],
        }),
      },
      notification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: NOTIFICATION_ID,
          family_id: null,
          notification_type: 'sos_alert',
          title: 'SOS khẩn cấp',
          message: 'Actor cần trợ giúp.',
          metadata: { sosEventId: sosId },
          is_read: false,
          read_at: null,
          created_at: new Date(),
        }),
      },
      notificationDelivery: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: any) => unknown) => work(tx)),
    };
    const repository = new NotificationsRepository(
      prisma as unknown as PrismaService,
    );
    const created = await repository.createFromSosEvent(sosId);
    expect(created).toHaveLength(1);
    expect(tx.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipient_user_id: recipientId,
          notification_type: 'sos_alert',
          related_table: 'sos_event',
          related_id: sosId,
        }),
      }),
    );
    expect(
      tx.notificationDelivery.createMany.mock.calls[0][0].data,
    ).toHaveLength(2);
  });

  it('does not duplicate an SOS notification on repeated processing', async () => {
    const tx: any = {
      $queryRaw: jest.fn(),
      sosEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: EVENT_ID,
          actorUserId: OWNER_ID,
          triggeredAt: new Date(),
          actor: { fullName: 'Actor' },
          recipients: [
            {
              recipientUserId: RECIPIENT_ID,
              recipient: { UserSetting: null, Device: [] },
            },
          ],
        }),
      },
      notification: {
        findUnique: jest.fn().mockResolvedValue({ id: NOTIFICATION_ID }),
        create: jest.fn(),
      },
      notificationDelivery: { createMany: jest.fn() },
    };
    const repository = new NotificationsRepository({
      $transaction: (work: (client: any) => unknown) => work(tx),
    } as unknown as PrismaService);
    await expect(repository.createFromSosEvent(EVENT_ID)).resolves.toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});
