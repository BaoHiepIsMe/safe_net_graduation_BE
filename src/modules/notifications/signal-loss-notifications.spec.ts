import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationsRepository } from './notifications.repository';

const OWNER = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const FAMILY = '44444444-4444-4444-8444-444444444444';
const OWNER_MEMBER = '55555555-5555-4555-8555-555555555555';
const LOCATION = '66666666-6666-4666-8666-666666666666';

const input = {
  userId: OWNER,
  locationId: LOCATION,
  reason: 'no_connection' as const,
  silentMinutes: 12,
  lastLocationAt: new Date('2026-11-19T09:48:00.000Z'),
  lastSeenAt: new Date('2026-11-19T09:49:00.000Z'),
  latitude: 10.5,
  longitude: 106.5,
};

function setup(
  overrides: {
    settings?: Record<string, unknown> | null;
    memberships?: unknown[];
    recipients?: unknown[];
    viewers?: { viewerUserId: string }[];
    existing?: unknown;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    userSetting: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.settings === undefined
          ? {
              locationSharingEnabled: true,
              notifyOnSignalLost: true,
              locationVisibility: 'all',
            }
          : overrides.settings,
      ),
    },
    locationShareViewer: {
      findMany: jest.fn().mockResolvedValue(overrides.viewers ?? []),
    },
    familyMember: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce(
          overrides.memberships ?? [
            {
              id: OWNER_MEMBER,
              familyId: FAMILY,
              displayName: null,
              isCareRecipient: false,
              locationSharingEnabled: true,
              profile: {
                fullName: 'Bé An',
                dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
              },
            },
          ],
        )
        .mockResolvedValueOnce(
          overrides.recipients ?? [
            {
              userId: PEER,
              familyId: FAMILY,
              profile: {
                UserSetting: { pushNotificationsEnabled: true },
                Device: [{ id: 'device-1' }],
              },
            },
          ],
        ),
    },
    notification: {
      findUnique: jest.fn().mockResolvedValue(overrides.existing ?? null),
      create: jest.fn().mockResolvedValue({ id: 'n1' }),
    },
    notificationDelivery: { createMany: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((callback) => callback(tx)),
  } as unknown as PrismaService;
  return { tx, repository: new NotificationsRepository(prisma) };
}

describe('NotificationsRepository.createFromSignalLoss', () => {
  it('notifies the other family members once, keyed by the last location', async () => {
    const { tx, repository } = setup();

    const created = await repository.createFromSignalLoss(input);

    expect(created).toHaveLength(1);
    expect(created[0].recipientUserId).toBe(PEER);
    const data = tx.notification.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      recipient_user_id: PEER,
      sender_user_id: OWNER,
      notification_type: 'location_signal_lost',
      related_table: 'location_signal',
      related_id: LOCATION,
      family_id: FAMILY,
    });
    expect(data.message).toContain('Bé An');
    expect(data.message).toContain('12 phút');
    expect(data.metadata).toMatchObject({
      memberId: OWNER_MEMBER,
      reason: 'no_connection',
      latitude: 10.5,
    });
    expect(tx.notificationDelivery.createMany).toHaveBeenCalledTimes(1);
    expect(tx.familyMember.findMany.mock.calls[1][0].where).toMatchObject({
      status: 'accepted',
      userId: { not: OWNER },
    });
  });

  it('words a no_location silence differently', async () => {
    const { tx, repository } = setup();
    await repository.createFromSignalLoss({ ...input, reason: 'no_location' });
    const message = tx.notification.create.mock.calls[0][0].data.message;
    expect(message).toContain('không lấy được vị trí');
    expect(message).not.toContain('12 phút');
  });

  it('is idempotent: an existing notification for the silence is skipped', async () => {
    const { tx, repository } = setup({ existing: { id: 'already' } });
    await expect(repository.createFromSignalLoss(input)).resolves.toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('sends nothing when the owner turned the alert off or stopped sharing', async () => {
    for (const settings of [
      {
        locationSharingEnabled: true,
        notifyOnSignalLost: false,
        locationVisibility: 'all',
      },
      {
        locationSharingEnabled: false,
        notifyOnSignalLost: true,
        locationVisibility: 'all',
      },
      null,
    ]) {
      const { tx, repository } = setup({ settings });
      await expect(repository.createFromSignalLoss(input)).resolves.toEqual([]);
      expect(tx.notification.create).not.toHaveBeenCalled();
    }
  });

  it('sends nothing when the owner shares with no family', async () => {
    const { tx, repository } = setup({ memberships: [] });
    await expect(repository.createFromSignalLoss(input)).resolves.toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('only tells the chosen viewers when visibility is selected', async () => {
    const recipient = (userId: string) => ({
      userId,
      familyId: FAMILY,
      profile: {
        UserSetting: { pushNotificationsEnabled: true },
        Device: [],
      },
    });
    const { repository } = setup({
      settings: {
        locationSharingEnabled: true,
        notifyOnSignalLost: true,
        locationVisibility: 'selected',
      },
      viewers: [{ viewerUserId: PEER }],
      recipients: [recipient(PEER), recipient(OTHER)],
    });

    const created = await repository.createFromSignalLoss(input);

    expect(created.map((item) => item.recipientUserId)).toEqual([PEER]);
  });

  it('always tells the care managers of a care recipient, whatever their own settings', async () => {
    const { tx, repository } = setup({
      settings: {
        locationSharingEnabled: false,
        notifyOnSignalLost: false,
        locationVisibility: 'selected',
      },
      memberships: [
        {
          id: OWNER_MEMBER,
          familyId: FAMILY,
          displayName: 'Bà',
          isCareRecipient: true,
          locationSharingEnabled: false,
          profile: {
            fullName: 'Bà Nội',
            dateOfBirth: new Date('1950-01-01T00:00:00.000Z'),
          },
        },
      ],
    });
    // 2nd query: care managers of the member; 3rd: notification candidates.
    tx.familyMember.findMany
      .mockReset()
      .mockResolvedValueOnce([
        {
          id: OWNER_MEMBER,
          familyId: FAMILY,
          displayName: 'Bà',
          isCareRecipient: true,
          locationSharingEnabled: false,
          profile: {
            fullName: 'Bà Nội',
            dateOfBirth: new Date('1950-01-01T00:00:00.000Z'),
          },
        },
      ])
      .mockResolvedValueOnce([
        { userId: PEER, isHired: false, careScopes: [], family: null },
      ])
      .mockResolvedValueOnce([
        {
          userId: PEER,
          familyId: FAMILY,
          profile: { UserSetting: null, Device: [] },
        },
        {
          userId: OTHER,
          familyId: FAMILY,
          profile: { UserSetting: null, Device: [] },
        },
      ]);

    const created = await repository.createFromSignalLoss(input);

    expect(created.map((item) => item.recipientUserId)).toEqual([PEER]);
    expect(tx.locationShareViewer.findMany).toHaveBeenCalled();
  });

  it('skips push deliveries when the recipient turned push off', async () => {
    const { tx, repository } = setup({
      recipients: [
        {
          userId: PEER,
          familyId: FAMILY,
          profile: {
            UserSetting: { pushNotificationsEnabled: false },
            Device: [{ id: 'device-1' }],
          },
        },
      ],
    });
    const created = await repository.createFromSignalLoss(input);
    expect(created).toHaveLength(1); // still in the app
    expect(tx.notificationDelivery.createMany).not.toHaveBeenCalled();
  });
});
