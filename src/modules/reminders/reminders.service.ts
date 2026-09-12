import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import {
  CreateReminderDto,
  ReminderListQueryDto,
  ReminderLogQueryDto,
  ReminderScheduleDto,
  UpdateReminderDto,
  UpcomingReminderQueryDto,
} from './dto/reminder.dto';
import {
  normalizeReminderSchedule,
  nextOccurrenceForSchedule,
  storedScheduleToDto,
} from './reminder-schedule';
import { RemindersRepository } from './reminders.repository';

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
  constructor(private readonly repository: RemindersRepository) {}

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
    return this.mapReminder(result.reminder);
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
      data: pageRows.map((row) => this.mapReminder(row)),
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
      data: rows.map((row) => this.mapReminder(row)),
      horizonEndsAt: until,
    };
  }

  async detail(userId: string, reminderId: string) {
    const reminder = await this.repository.findVisible(userId, reminderId);
    if (!reminder) this.notFound();
    return this.mapReminder(reminder);
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
    return this.mapReminder(result.reminder);
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
      data: pageRows.map((row) => ({
        id: row.id,
        reminderId: row.reminderId,
        memberId: row.memberId,
        recipient: {
          userId: row.member.userId,
          displayName:
            row.member.displayName ?? row.member.profile.fullName ?? null,
        },
        scheduledAt: row.scheduledAt,
        status: row.status,
        processedAt: row.processedAt,
      })),
      pagination: {
        limit: query.limit,
        nextCursor:
          hasMore && last ? this.encodeCursor(last.scheduledAt, last.id) : null,
        hasMore,
      },
    };
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

  private mapReminder(row: any) {
    return {
      id: row.id,
      familyId: row.familyId,
      creator: {
        id: row.creator.id,
        fullName: row.creator.fullName,
        avatarUrl: row.creator.avatarUrl,
      },
      title: row.title,
      description: row.description,
      reminderType: row.reminderType,
      schedule: storedScheduleToDto(row),
      isActive: row.isActive,
      nextOccurrenceAt: row.nextOccurrenceAt,
      targets: row.targets.map((target: any) => ({
        memberId: target.member.id,
        userId: target.member.userId,
        displayName:
          target.member.displayName ?? target.member.profile.fullName ?? null,
        avatarUrl: target.member.profile.avatarUrl,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
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
