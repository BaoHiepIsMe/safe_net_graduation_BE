import {
  nextOccurrenceForSchedule,
  normalizeReminderSchedule,
  zonedDateTimeToUtc,
} from './reminder-schedule';

describe('Reminder schedule calculation', () => {
  it('preserves the intended local wall-clock time in an IANA timezone', () => {
    expect(
      zonedDateTimeToUtc(
        { year: 2030, month: 1, day: 1 },
        '08:30',
        'Asia/Ho_Chi_Minh',
      ).toISOString(),
    ).toBe('2030-01-01T01:30:00.000Z');
  });

  it('calculates a deterministic one-time occurrence', () => {
    const schedule = normalizeReminderSchedule(
      {
        type: 'once',
        occurrenceAt: '2030-01-01T08:00:00+07:00',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      new Date('2029-01-01T00:00:00Z'),
    );
    expect(schedule.nextOccurrenceAt?.toISOString()).toBe(
      '2030-01-01T01:00:00.000Z',
    );
  });

  it('calculates daily occurrences after the supplied instant', () => {
    const next = nextOccurrenceForSchedule(
      {
        type: 'daily',
        timeOfDay: '08:00',
        startsOn: '2030-01-01',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      new Date('2030-01-01T01:00:00Z'),
    );
    expect(next?.toISOString()).toBe('2030-01-02T01:00:00.000Z');
  });

  it('calculates only selected weekdays', () => {
    const next = nextOccurrenceForSchedule(
      {
        type: 'weekly',
        timeOfDay: '09:00',
        startsOn: '2030-01-01',
        weekdays: [1],
        timezone: 'UTC',
      },
      new Date('2030-01-01T00:00:00Z'),
    );
    expect(next?.getUTCDay()).toBe(1);
  });

  it('honors schedule end boundaries', () => {
    expect(
      nextOccurrenceForSchedule(
        {
          type: 'daily',
          timeOfDay: '08:00',
          startsOn: '2030-01-01',
          endsAt: '2030-01-01T08:00:00Z',
          timezone: 'UTC',
        },
        new Date('2030-01-01T08:00:00Z'),
      ),
    ).toBeNull();
  });

  it('rejects a past one-time schedule', () => {
    expect(() =>
      normalizeReminderSchedule(
        {
          type: 'once',
          occurrenceAt: '2029-01-01T00:00:00Z',
          timezone: 'UTC',
        },
        new Date('2030-01-01T00:00:00Z'),
      ),
    ).toThrow('future');
  });

  it('handles DST offset changes without changing wall-clock intent', () => {
    const winter = zonedDateTimeToUtc(
      { year: 2030, month: 1, day: 10 },
      '08:00',
      'America/New_York',
    );
    const summer = zonedDateTimeToUtc(
      { year: 2030, month: 7, day: 10 },
      '08:00',
      'America/New_York',
    );
    expect(winter.getUTCHours()).toBe(13);
    expect(summer.getUTCHours()).toBe(12);
  });
});
