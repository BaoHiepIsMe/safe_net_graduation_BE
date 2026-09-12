import { dailyStatusWindow, dueReportDate } from './daily-status-window';

describe('Daily Status date/timezone window', () => {
  it('uses a start-inclusive, next-day-exclusive local window', () => {
    const result = dailyStatusWindow('2026-09-01', 'Asia/Ho_Chi_Minh');
    expect(result.dayStart.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(result.dayEnd.toISOString()).toBe('2026-09-01T17:00:00.000Z');
  });

  it('honors a 23-hour DST spring-forward day', () => {
    const result = dailyStatusWindow('2026-03-08', 'America/New_York');
    expect(result.dayEnd.getTime() - result.dayStart.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
  });

  it('is deterministic for identical input', () => {
    expect(dailyStatusWindow('2026-11-01', 'America/New_York')).toEqual(
      dailyStatusWindow('2026-11-01', 'America/New_York'),
    );
  });

  it('waits for the configured local grace period', () => {
    expect(
      dueReportDate(
        new Date('2026-09-01T17:30:00.000Z'),
        'Asia/Ho_Chi_Minh',
        60,
      ),
    ).toBeNull();
    expect(
      dueReportDate(
        new Date('2026-09-01T18:00:00.000Z'),
        'Asia/Ho_Chi_Minh',
        60,
      ),
    ).toBe('2026-09-01');
  });
});
