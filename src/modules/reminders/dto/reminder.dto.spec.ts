import {
  createReminderSchema,
  reminderListQuerySchema,
  updateReminderSchema,
} from './reminder.dto';

const id = '11111111-1111-4111-8111-111111111111';

describe('Reminder DTO validation', () => {
  it('accepts strict once, daily and selected-weekday schedules', () => {
    expect(
      createReminderSchema.safeParse({
        familyId: id,
        title: 'Medicine',
        schedule: {
          type: 'once',
          occurrenceAt: '2030-01-01T08:00:00+07:00',
          timezone: 'Asia/Ho_Chi_Minh',
        },
        targetMemberIds: [id],
      }).success,
    ).toBe(true);
    expect(
      createReminderSchema.safeParse({
        familyId: id,
        title: 'Daily meal',
        schedule: {
          type: 'daily',
          timeOfDay: '08:30',
          startsOn: '2030-01-01',
          timezone: 'Asia/Ho_Chi_Minh',
        },
        targetMemberIds: [id],
      }).success,
    ).toBe(true);
    expect(
      createReminderSchema.safeParse({
        familyId: id,
        title: 'Weekdays',
        schedule: {
          type: 'weekly',
          timeOfDay: '09:00',
          startsOn: '2030-01-01',
          weekdays: [1, 3, 5],
          timezone: 'UTC',
        },
        targetMemberIds: [id],
      }).success,
    ).toBe(true);
  });

  it('rejects creator spoofing, arbitrary timestamps and notification fields', () => {
    for (const extra of [
      { createdBy: id },
      { userId: id },
      { nextOccurrenceAt: '2030-01-01T00:00:00Z' },
      { notificationId: id },
    ]) {
      expect(
        createReminderSchema.safeParse({
          familyId: id,
          title: 'Strict',
          schedule: {
            type: 'once',
            occurrenceAt: '2030-01-01T00:00:00Z',
            timezone: 'UTC',
          },
          targetMemberIds: [id],
          ...extra,
        }).success,
      ).toBe(false);
    }
  });

  it('rejects invalid timezone, duplicate targets and duplicate weekdays', () => {
    expect(
      createReminderSchema.safeParse({
        familyId: id,
        title: 'Bad',
        schedule: {
          type: 'weekly',
          timeOfDay: '25:00',
          startsOn: '2030-01-01',
          weekdays: [1, 1],
          timezone: 'Not/AZone',
        },
        targetMemberIds: [id, id],
      }).success,
    ).toBe(false);
  });

  it('requires a non-empty strict update', () => {
    expect(updateReminderSchema.safeParse({}).success).toBe(false);
    expect(
      updateReminderSchema.safeParse({ title: 'New', ownerId: id }).success,
    ).toBe(false);
    expect(updateReminderSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
  });

  it('bounds list pagination and rejects unknown filters', () => {
    expect(reminderListQuerySchema.parse({})).toMatchObject({ limit: 20 });
    expect(reminderListQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(reminderListQuerySchema.safeParse({ familyId: id }).success).toBe(
      false,
    );
  });
});
