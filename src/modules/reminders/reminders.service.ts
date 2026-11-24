import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { isWithinHiredScope } from '../families/care-scope.util';
import {
  CompleteReminderLogDto,
  CreateReminderDto,
  ReminderAgendaQueryDto,
  ReminderListQueryDto,
  ReminderLogQueryDto,
  ReminderScheduleDto,
  UpdateReminderDto,
  UpcomingReminderQueryDto,
} from './dto/reminder.dto';
import { ReminderEventsService } from './reminder-events.service';
import {
  mapReminder,
  mapReminderLog,
  memberDisplayName,
} from './reminder-mappers';
import {
  addLocalDays,
  normalizeReminderSchedule,
  nextOccurrenceForSchedule,
  parseLocalDate,
  storedScheduleToDto,
  zonedDateTimeToUtc,
  LocalDateParts,
} from './reminder-schedule';
import { REMINDER_AGENDA_MAX_OCCURRENCES_PER_REMINDER } from './reminders.constants';
import { RemindersRepository } from './reminders.repository';

export type ReminderAgendaStatus = 'upcoming' | 'due' | 'completed' | 'missed';

const reminderCursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));
const logCursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([scheduledAt, id]) => ({
    scheduledAt: new Date(scheduledAt),
    id,
  }));

@Injectable()
export class RemindersService {
  constructor(
    private readonly repository: RemindersRepository,
    private readonly events: ReminderEventsService,
  ) {}

  async create(userId: string, dto: CreateReminderDto) {
    const schedule = this.normalize(dto.schedule);
    const result = await this.repository.create(userId, dto, schedule);
    if (result.outcome === 'forbidden') {
      throw new ForbiddenError(
        'Only an accepted family manager may create reminders',
        ErrorCode.REMINDER_ACCESS_DENIED,
      );
    }
    if (result.outcome === 'invalid_target') this.invalidTarget();
    return mapReminder(result.reminder);
  }

  async list(userId: string, query: ReminderListQueryDto) {
    const cursor = query.cursor
      ? this.decodeCursor(query.cursor, reminderCursorSchema, 'reminder')
      : undefined;
    const rows = await this.repository.listVisible(userId, query, cursor);
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map(mapReminder),
      pagination: {
        limit: query.limit,
        nextCursor:
          hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
        hasMore,
      },
    };
  }

  async upcoming(userId: string, query: UpcomingReminderQueryDto) {
    const now = new Date();
    const until = new Date(now.getTime() + query.days * 24 * 60 * 60 * 1000);
    const rows = await this.repository.listUpcoming(
      userId,
      now,
      until,
      query.limit,
    );
    return {
      data: rows.map(mapReminder),
      horizonEndsAt: until,
    };
  }

  async detail(userId: string, reminderId: string) {
    const reminder = await this.repository.findVisible(userId, reminderId);
    if (!reminder) this.notFound();
    return mapReminder(reminder);
  }

  async update(userId: string, reminderId: string, dto: UpdateReminderDto) {
    const visible = await this.repository.findVisible(userId, reminderId);
    if (!visible) this.notFound();
    const schedule = dto.schedule ? this.normalize(dto.schedule) : undefined;
    let reactivatedNextOccurrenceAt: Date | null | undefined;
    if (dto.isActive === true && !schedule) {
      reactivatedNextOccurrenceAt = nextOccurrenceForSchedule(
        storedScheduleToDto(visible),
        new Date(),
      );
      if (!reactivatedNextOccurrenceAt) {
        throw new BusinessRuleError(
          ErrorCode.REMINDER_INVALID_SCHEDULE,
          'This reminder has no future occurrence',
        );
      }
    }
    const result = await this.repository.update(
      userId,
      reminderId,
      dto,
      schedule,
      reactivatedNextOccurrenceAt,
    );
    if (result.outcome === 'not_found') this.notFound();
    if (result.outcome === 'invalid_target') this.invalidTarget();
    return mapReminder(result.reminder);
  }

  async deactivate(userId: string, reminderId: string) {
    const result = await this.repository.deactivate(userId, reminderId);
    if (result.outcome === 'not_found') this.notFound();
  }

  async logs(userId: string, reminderId: string, query: ReminderLogQueryDto) {
    if (!(await this.repository.canView(userId, reminderId))) this.notFound();
    const cursor = query.cursor
      ? this.decodeCursor(query.cursor, logCursorSchema, 'reminder log')
      : undefined;
    const rows = await this.repository.listLogs(
      userId,
      reminderId,
      query,
      cursor,
    );
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map(mapReminderLog),
      pagination: {
        limit: query.limit,
        nextCursor:
          hasMore && last ? this.encodeCursor(last.scheduledAt, last.id) : null,
        hasMore,
      },
    };
  }

  async complete(userId: string, logId: string, dto: CompleteReminderLogDto) {
    const now = new Date();
    const result = await this.repository.completeLog(
      userId,
      logId,
      dto.note,
      now,
    );
    if (result.outcome === 'not_found') {
      throw new NotFoundError(
        'Reminder occurrence not found',
        ErrorCode.REMINDER_LOG_NOT_FOUND,
      );
    }
    if (result.outcome === 'missed') {
      throw new BusinessRuleError(
        ErrorCode.REMINDER_OCCURRENCE_CONFLICT,
        'This reminder occurrence was already missed',
      );
    }
    if (result.changed) await this.events.emitLogsUpdated([logId], now);
    return mapReminderLog(result.log);
  }

  /**
   * Every occurrence of one local day the viewer may see: logged ones with
   * their status, plus not-yet-reached ones as `upcoming`.
   */
  async agenda(userId: string, query: ReminderAgendaQueryDto) {
    const day = parseLocalDate(query.date);
    const start = this.localDayStart(day, query.timezone);
    const end = this.localDayStart(addLocalDays(day, 1), query.timezone);
    const [reminders, memberships] = await Promise.all([
      this.repository.listAgendaReminders(userId, start, end),
      this.repository.viewerMemberships(userId),
    ]);
    const byFamily = new Map(memberships.map((m) => [m.familyId, m]));
    const canSee = (
      familyId: string,
      member: { id: string; userId: string },
    ) => {
      const me = byFamily.get(familyId);
      if (!me) return false;
      if (member.userId === userId) return true;
      return me.canManageCare && isWithinHiredScope(me, member.id);
    };

    const items: Array<ReturnType<typeof this.agendaItem>> = [];
    for (const reminder of reminders) {
      const logged = new Set<string>();
      for (const log of reminder.logs) {
        logged.add(`${log.memberId}|${log.scheduledAt.toISOString()}`);
        if (!canSee(reminder.familyId, log.member)) continue;
        items.push(
          this.agendaItem(reminder, log.member, log.scheduledAt, {
            logId: log.id,
            status: log.status as ReminderAgendaStatus,
            completedAt: log.completedAt,
          }),
        );
      }
      if (!reminder.isActive || !reminder.nextOccurrenceAt) continue;
      const schedule = storedScheduleToDto(reminder);
      const targets = reminder.targets
        .map((target) => target.member)
        .filter(
          (member) =>
            member.status === 'accepted' && canSee(reminder.familyId, member),
        );
      let occurrence: Date | null = reminder.nextOccurrenceAt;
      for (
        let count = 0;
        occurrence &&
        occurrence < end &&
        count < REMINDER_AGENDA_MAX_OCCURRENCES_PER_REMINDER;
        count++
      ) {
        if (occurrence >= start) {
          for (const member of targets) {
            const key = `${member.id}|${occurrence.toISOString()}`;
            if (logged.has(key)) continue;
            items.push(
              this.agendaItem(reminder, member, occurrence, {
                logId: null,
                status: 'upcoming',
                completedAt: null,
              }),
            );
          }
        }
        occurrence = nextOccurrenceForSchedule(schedule, occurrence);
      }
    }
    items.sort(
      (a, b) =>
        a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
        a.title.localeCompare(b.title) ||
        a.member.memberId.localeCompare(b.member.memberId),
    );
    return {
      data: items,
      date: query.date,
      timezone: query.timezone,
      startsAt: start,
      endsAt: end,
    };
  }

  private agendaItem(
    reminder: {
      id: string;
      title: string;
      description: string | null;
      reminderType: string | null;
      priority: string;
    },
    member: {
      id: string;
      userId: string;
      displayName: string | null;
      profile: { fullName: string | null; avatarUrl: string | null };
    },
    scheduledAt: Date,
    state: {
      logId: string | null;
      status: ReminderAgendaStatus;
      completedAt: Date | null;
    },
  ) {
    return {
      reminderId: reminder.id,
      logId: state.logId,
      title: reminder.title,
      description: reminder.description,
      reminderType: reminder.reminderType,
      priority: reminder.priority,
      scheduledAt,
      status: state.status,
      completedAt: state.completedAt,
      member: {
        memberId: member.id,
        userId: member.userId,
        displayName: memberDisplayName(member),
        avatarUrl: member.profile.avatarUrl,
      },
    };
  }

  /** Local midnight, or the first existing minute after a DST gap. */
  private localDayStart(day: LocalDateParts, timezone: string) {
    for (const time of ['00:00', '01:00', '02:00']) {
      try {
        return zonedDateTimeToUtc(day, time, timezone);
      } catch {
        continue;
      }
    }
    throw new ValidationError(
      [{ path: ['date'], message: 'Invalid local date' }],
      'Invalid date',
    );
  }

  private normalize(schedule: ReminderScheduleDto) {
    try {
      return normalizeReminderSchedule(schedule, new Date());
    } catch (error) {
      throw new BusinessRuleError(
        ErrorCode.REMINDER_INVALID_SCHEDULE,
        error instanceof Error ? error.message : 'Invalid reminder schedule',
      );
    }
  }

  private encodeCursor(date: Date, id: string) {
    return Buffer.from(`${date.toISOString()}|${id}`, 'utf8').toString(
      'base64url',
    );
  }

  private decodeCursor<T>(
    value: string,
    schema: z.ZodType<T>,
    label: string,
  ): T {
    try {
      const parsed = schema.safeParse(
        Buffer.from(value, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: `Invalid ${label} cursor` }],
        'Invalid cursor',
      );
    }
  }

  private notFound(): never {
    throw new NotFoundError('Reminder not found', ErrorCode.REMINDER_NOT_FOUND);
  }

  private invalidTarget(): never {
    throw new BusinessRuleError(
      ErrorCode.REMINDER_TARGET_INVALID,
      'Every target must be an accepted member of the reminder family',
    );
  }
}
