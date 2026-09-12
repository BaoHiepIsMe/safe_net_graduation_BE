import { ReminderScheduleDto } from './dto/reminder.dto';

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export interface StoredReminderSchedule {
  scheduleType: 'once' | 'daily' | 'weekly';
  timezone: string;
  startAt: Date;
  endAt: Date | null;
  scheduleRule: Record<string, unknown> | null;
  nextOccurrenceAt: Date | null;
}

export const formatLocalDate = (value: LocalDateParts) =>
  `${value.year.toString().padStart(4, '0')}-${value.month
    .toString()
    .padStart(2, '0')}-${value.day.toString().padStart(2, '0')}`;

export const parseLocalDate = (value: string): LocalDateParts => {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
};

export const addLocalDays = (
  value: LocalDateParts,
  days: number,
): LocalDateParts => {
  const date = new Date(
    Date.UTC(value.year, value.month - 1, value.day + days),
  );
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const compareLocalDates = (left: LocalDateParts, right: LocalDateParts) =>
  formatLocalDate(left).localeCompare(formatLocalDate(right));

export const localPartsAt = (instant: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number('year'),
    month: number('month'),
    day: number('day'),
    hour: number('hour'),
    minute: number('minute'),
    second: number('second'),
  };
};

export const zonedDateTimeToUtc = (
  localDate: LocalDateParts,
  timeOfDay: string,
  timezone: string,
) => {
  const [hour, minute] = timeOfDay.split(':').map(Number);
  const desired = Date.UTC(
    localDate.year,
    localDate.month - 1,
    localDate.day,
    hour,
    minute,
  );
  let instant = new Date(desired);
  for (let index = 0; index < 4; index++) {
    const actual = localPartsAt(instant, timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    instant = new Date(instant.getTime() + desired - represented);
  }
  const final = localPartsAt(instant, timezone);
  if (
    final.year !== localDate.year ||
    final.month !== localDate.month ||
    final.day !== localDate.day ||
    final.hour !== hour ||
    final.minute !== minute
  ) {
    throw new Error('The local reminder time does not exist in this timezone');
  }
  return instant;
};

const weekday = (date: LocalDateParts) =>
  new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

const recurringOccurrence = (
  schedule: Extract<ReminderScheduleDto, { type: 'daily' | 'weekly' }>,
  after: Date,
) => {
  const startsOn = parseLocalDate(schedule.startsOn);
  const afterLocal = localPartsAt(after, schedule.timezone);
  let candidateDate = {
    year: afterLocal.year,
    month: afterLocal.month,
    day: afterLocal.day,
  };
  if (compareLocalDates(candidateDate, startsOn) < 0) candidateDate = startsOn;
  const allowed =
    schedule.type === 'weekly' ? new Set(schedule.weekdays) : undefined;
  const endAt = schedule.endsAt ? new Date(schedule.endsAt) : null;
  for (let offset = 0; offset < 3700; offset++) {
    const date = addLocalDays(candidateDate, offset);
    if (allowed && !allowed.has(weekday(date))) continue;
    let occurrence: Date;
    try {
      occurrence = zonedDateTimeToUtc(
        date,
        schedule.timeOfDay,
        schedule.timezone,
      );
    } catch {
      continue;
    }
    if (occurrence <= after) continue;
    if (endAt && occurrence > endAt) return null;
    return occurrence;
  }
  return null;
};

export const nextOccurrenceForSchedule = (
  schedule: ReminderScheduleDto,
  after: Date,
) => {
  if (schedule.type === 'once') {
    const occurrence = new Date(schedule.occurrenceAt);
    return occurrence > after ? occurrence : null;
  }
  return recurringOccurrence(schedule, after);
};

export const normalizeReminderSchedule = (
  schedule: ReminderScheduleDto,
  now: Date,
): StoredReminderSchedule => {
  if (schedule.type === 'once') {
    const occurrence = new Date(schedule.occurrenceAt);
    if (occurrence <= now)
      throw new Error('One-time reminder must be in the future');
    return {
      scheduleType: 'once',
      timezone: schedule.timezone,
      startAt: occurrence,
      endAt: occurrence,
      scheduleRule: null,
      nextOccurrenceAt: occurrence,
    };
  }

  const startDate = parseLocalDate(schedule.startsOn);
  let firstDate = startDate;
  if (schedule.type === 'weekly') {
    const allowed = new Set(schedule.weekdays);
    for (let offset = 0; offset < 7; offset++) {
      const date = addLocalDays(startDate, offset);
      if (allowed.has(weekday(date))) {
        firstDate = date;
        break;
      }
    }
  }
  const startAt = zonedDateTimeToUtc(
    firstDate,
    schedule.timeOfDay,
    schedule.timezone,
  );
  const endAt = schedule.endsAt ? new Date(schedule.endsAt) : null;
  if (endAt && endAt < startAt) throw new Error('Schedule end precedes start');
  const nextOccurrenceAt = recurringOccurrence(
    schedule,
    new Date(now.getTime() - 1),
  );
  if (!nextOccurrenceAt) throw new Error('Schedule has no future occurrence');
  return {
    scheduleType: schedule.type,
    timezone: schedule.timezone,
    startAt,
    endAt,
    scheduleRule: {
      timeOfDay: schedule.timeOfDay,
      startsOn: schedule.startsOn,
      ...(schedule.type === 'weekly'
        ? { weekdays: [...schedule.weekdays].sort((a, b) => a - b) }
        : {}),
    },
    nextOccurrenceAt,
  };
};

export const storedScheduleToDto = (reminder: {
  scheduleType: string;
  timezone: string;
  startAt: Date;
  endAt: Date | null;
  scheduleRule: unknown;
}): ReminderScheduleDto => {
  if (reminder.scheduleType === 'once') {
    return {
      type: 'once',
      occurrenceAt: reminder.startAt.toISOString(),
      timezone: reminder.timezone,
    };
  }
  const rule = reminder.scheduleRule as {
    timeOfDay: string;
    startsOn: string;
    weekdays?: number[];
  };
  if (reminder.scheduleType === 'weekly') {
    return {
      type: 'weekly',
      timeOfDay: rule.timeOfDay,
      startsOn: rule.startsOn,
      weekdays: rule.weekdays ?? [],
      timezone: reminder.timezone,
      ...(reminder.endAt ? { endsAt: reminder.endAt.toISOString() } : {}),
    };
  }
  return {
    type: 'daily',
    timeOfDay: rule.timeOfDay,
    startsOn: rule.startsOn,
    timezone: reminder.timezone,
    ...(reminder.endAt ? { endsAt: reminder.endAt.toISOString() } : {}),
  };
};
