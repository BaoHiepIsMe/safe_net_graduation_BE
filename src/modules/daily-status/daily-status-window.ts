import {
  addLocalDays,
  formatLocalDate,
  localPartsAt,
  parseLocalDate,
  zonedDateTimeToUtc,
} from '../reminders/reminder-schedule';

export const dailyStatusWindow = (reportDate: string, timezone: string) => {
  const local = parseLocalDate(reportDate);
  const dayStart = zonedDateTimeToUtc(local, '00:00', timezone);
  const next = addLocalDays(local, 1);
  const dayEnd = zonedDateTimeToUtc(next, '00:00', timezone);
  return { reportDate, timezone, dayStart, dayEnd };
};

export const dueReportDate = (
  now: Date,
  timezone: string,
  graceMinutes: number,
) => {
  const local = localPartsAt(now, timezone);
  if (local.hour * 60 + local.minute < graceMinutes) return null;
  return formatLocalDate(
    addLocalDays({ year: local.year, month: local.month, day: local.day }, -1),
  );
};
