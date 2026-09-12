import { ErrorCode } from '../../common/constants/error-codes';
import { DailyStatusRepository } from './daily-status.repository';
import { DailyStatusService } from './daily-status.service';

const REPORT = '11111111-1111-4111-8111-111111111111';
const FAMILY = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const SUBJECT = '44444444-4444-4444-8444-444444444444';
const MANAGER = '55555555-5555-4555-8555-555555555555';

const summary = {
  schemaVersion: 1 as const,
  availability: {
    location: 'available' as const,
    geofence: 'available' as const,
    sos: 'available' as const,
    reminders: 'available' as const,
    phoneUsage: 'available' as const,
  },
  location: { recordCount: 2, lastRecordedAt: '2026-09-01T10:00:00.000Z' },
  geofence: { enterCount: 1, exitCount: 0 },
  sos: { totalCount: 1, activeCount: 0, resolvedCount: 1, cancelledCount: 0 },
  reminders: {
    occurrenceCount: 2,
    notificationProcessedCount: 1,
    missedCount: 1,
  },
  phoneUsage: { totalUsageSeconds: 100, topApps: [] },
};

const report = (overrides: Record<string, unknown> = {}) => ({
  id: REPORT,
  familyId: FAMILY,
  memberId: MEMBER,
  subjectUserId: SUBJECT,
  reportDate: new Date('2026-09-01T00:00:00.000Z'),
  timezone: 'UTC',
  dayStart: new Date('2026-09-01T00:00:00.000Z'),
  dayEnd: new Date('2026-09-02T00:00:00.000Z'),
  schemaVersion: 1,
  summary,
  generatedAt: new Date('2026-09-02T01:00:00.000Z'),
  createdAt: new Date('2026-09-02T01:00:00.000Z'),
  subject: { id: SUBJECT, fullName: 'Subject', avatarUrl: null },
  family: { status: 'active' },
  member: {
    id: MEMBER,
    userId: SUBJECT,
    role: 'child',
    status: 'accepted',
    locationSharingEnabled: true,
    profile: { UserSetting: { locationSharingEnabled: true } },
  },
  ...overrides,
});

describe('DailyStatusService authorization and privacy', () => {
  const setup = () => {
    const repository = {
      generate: jest.fn(),
      listOwn: jest.fn().mockResolvedValue([]),
      listMember: jest.fn().mockResolvedValue([]),
      findAccessReport: jest.fn().mockResolvedValue(report()),
      findCurrentMembership: jest.fn().mockResolvedValue({
        role: 'manager',
        locationSharingEnabled: true,
      }),
      findCurrentSubject: jest
        .fn()
        .mockResolvedValue({ id: MEMBER, userId: SUBJECT, role: 'child' }),
      countSosNotAuthorizedForViewer: jest.fn().mockResolvedValue(0),
    };
    return {
      repository,
      service: new DailyStatusService(
        repository as unknown as DailyStatusRepository,
      ),
    };
  };

  it('lets the subject read their immutable historical report after removal', async () => {
    const { repository, service } = setup();
    repository.findAccessReport.mockResolvedValue(
      report({
        family: { status: 'archived' },
        member: {
          ...report().member,
          status: 'removed',
          locationSharingEnabled: false,
        },
      }),
    );
    await expect(service.detail(SUBJECT, REPORT)).resolves.toMatchObject({
      locationSummary: { recordCount: 2 },
      sosSummary: { totalCount: 1 },
    });
    expect(repository.findCurrentMembership).not.toHaveBeenCalled();
  });

  it('allows a current manager but applies source-domain privacy', async () => {
    const { repository, service } = setup();
    repository.findAccessReport.mockResolvedValue(
      report({
        member: {
          ...report().member,
          locationSharingEnabled: false,
        },
      }),
    );
    repository.countSosNotAuthorizedForViewer.mockResolvedValue(1);
    await expect(service.detail(MANAGER, REPORT)).resolves.toMatchObject({
      dataAvailability: {
        location: 'restricted',
        geofence: 'restricted',
        sos: 'restricted',
        reminders: 'available',
        phoneUsage: 'available',
      },
      locationSummary: null,
      geofenceSummary: null,
      sosSummary: null,
      reminderSummary: { occurrenceCount: 2 },
      phoneUsageSummary: { totalUsageSeconds: 100 },
    });
  });

  it.each([
    ['adult', 'accepted'],
    ['manager', 'removed'],
    ['manager', 'pending'],
    ['manager', 'rejected'],
  ])('denies a %s viewer with %s relationship', async (role, status) => {
    const { repository, service } = setup();
    repository.findCurrentMembership.mockResolvedValue(
      status === 'accepted' ? { role, locationSharingEnabled: true } : null,
    );
    await expect(service.detail(MANAGER, REPORT)).rejects.toMatchObject({
      code: ErrorCode.DAILY_STATUS_ACCESS_DENIED,
    });
  });

  it('requires current manager authorization for member history', async () => {
    const { repository, service } = setup();
    repository.findCurrentMembership.mockResolvedValue({ role: 'adult' });
    await expect(
      service.memberHistory(MANAGER, FAMILY, MEMBER, { limit: 30 }),
    ).rejects.toMatchObject({ code: ErrorCode.DAILY_STATUS_ACCESS_DENIED });
  });

  it('returns only minimized overview data in history', async () => {
    const { repository, service } = setup();
    repository.listOwn.mockResolvedValue([report()]);
    const result = await service.ownHistory(SUBJECT, { limit: 30 });
    expect(result.data[0]).toEqual(
      expect.objectContaining({ id: REPORT, reportDate: '2026-09-01' }),
    );
    expect(result.data[0]).not.toHaveProperty('summary');
    expect(result.data[0]).not.toHaveProperty('locationSummary');
  });

  it('maps malformed stored JSON to a safe internal error', async () => {
    const { repository, service } = setup();
    repository.findAccessReport.mockResolvedValue(report({ summary: {} }));
    await expect(service.detail(SUBJECT, REPORT)).rejects.toMatchObject({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
    });
  });
});
