import { Injectable } from '@nestjs/common';
import { isEffectiveCareRecipient } from '../../common/utils/age.util';
import { Prisma } from '../../generated/prisma/client';
import {
  HiredScopeActor,
  isWithinHiredScope,
} from '../families/care-scope.util';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  CreateReminderDto,
  ReminderCursor,
  ReminderListQueryDto,
  ReminderLogCursor,
  ReminderLogQueryDto,
  UpdateReminderDto,
} from './dto/reminder.dto';
import {
  nextOccurrenceForSchedule,
  StoredReminderSchedule,
  storedScheduleToDto,
} from './reminder-schedule';
import {
  REMINDER_AGENDA_MAX_REMINDERS,
  REMINDER_LOG_COMPLETED,
  REMINDER_LOG_DUE,
  REMINDER_LOG_MISSED,
  REMINDER_TRANSACTION_RETRIES,
} from './reminders.constants';

export const safeReminderSelect = {
  id: true,
  familyId: true,
  creatorUserId: true,
  title: true,
  description: true,
  reminderType: true,
  priority: true,
  startAt: true,
  scheduleType: true,
  scheduleRule: true,
  timezone: true,
  endAt: true,
  nextOccurrenceAt: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, fullName: true, avatarUrl: true } },
  targets: {
    select: {
      member: {
        select: {
          id: true,
          userId: true,
          displayName: true,
          status: true,
          profile: { select: { fullName: true, avatarUrl: true } },
        },
      },
    },
    orderBy: { memberId: 'asc' as const },
  },
} as const;

const visibleReminderWhere = (userId: string) => ({
  OR: [
    {
      creatorUserId: userId,
      family: {
        status: 'active',
        members: { some: { userId, status: 'accepted' } },
      },
    },
    {
      family: {
        status: 'active',
        members: {
          some: {
            userId,
            status: 'accepted',
            canManageCare: true,
            isHired: false,
          },
        },
      },
    },
    {
      family: {
        status: 'active',
        ownerUserId: userId,
        members: {
          some: { userId, status: 'accepted', canManageCare: true },
        },
      },
    },
    {
      family: { status: 'active' },
      targets: {
        some: {
          member: {
            status: 'accepted',
            scopedByCaregivers: {
              some: {
                member: {
                  userId,
                  status: 'accepted',
                  canManageCare: true,
                  isHired: true,
                },
              },
            },
          },
        },
      },
    },
    {
      family: { status: 'active' },
      targets: {
        some: { member: { userId, status: 'accepted' } },
      },
    },
  ],
});

export const safeReminderLogSelect = {
  id: true,
  reminderId: true,
  memberId: true,
  scheduledAt: true,
  status: true,
  processedAt: true,
  completedAt: true,
  member: {
    select: {
      userId: true,
      displayName: true,
      profile: { select: { fullName: true, avatarUrl: true } },
    },
  },
} as const;

const toScheduleData = (schedule: StoredReminderSchedule) => ({
  ...schedule,
  scheduleRule:
    // SQL NULL, not JSON `null`: reminders_schedule_rule_check only allows
    // NULL or a JSON object.
    schedule.scheduleRule === null
      ? Prisma.DbNull
      : (schedule.scheduleRule as Prisma.InputJsonValue),
});

@Injectable()
export class RemindersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    actorUserId: string,
    dto: CreateReminderDto,
    schedule: StoredReminderSchedule,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const manager = await tx.familyMember.findFirst({
        where: {
          familyId: dto.familyId,
          userId: actorUserId,
          status: 'accepted',
          canManageCare: true,
          family: { status: 'active' },
        },
        select: {
          id: true,
          userId: true,
          canManageCare: true,
          isHired: true,
          careScopes: { select: { targetMemberId: true } },
          family: { select: { ownerUserId: true } },
        },
      });
      if (!manager) return { outcome: 'forbidden' as const };
      const targets = await tx.familyMember.findMany({
        where: {
          id: { in: dto.targetMemberIds },
          familyId: dto.familyId,
          status: 'accepted',
          family: { status: 'active' },
        },
        select: {
          id: true,
          userId: true,
          isCareRecipient: true,
          profile: { select: { dateOfBirth: true } },
        },
      });
      if (
        targets.length !== dto.targetMemberIds.length ||
        targets.some(
          (target) => !this.canManageTarget(actorUserId, manager, target),
        )
      ) {
        return { outcome: 'invalid_target' as const };
      }
      const reminder = await tx.reminder.create({
        data: {
          familyId: dto.familyId,
          creatorUserId: actorUserId,
          title: dto.title,
          description: dto.description,
          reminderType: dto.reminderType,
          priority: dto.priority,
          ...toScheduleData(schedule),
          targets: {
            create: targets.map(({ id }) => ({ memberId: id })),
          },
        },
        select: safeReminderSelect,
      });
      return { outcome: 'created' as const, reminder };
    });
  }

  listVisible(
    userId: string,
    query: ReminderListQueryDto,
    cursor?: ReminderCursor,
  ) {
    return this.prisma.reminder.findMany({
      where: {
        AND: [
          visibleReminderWhere(userId),
          ...(cursor
            ? [
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
        ...(query.active ? { isActive: query.active === 'true' } : {}),
      },
      select: safeReminderSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  listUpcoming(userId: string, now: Date, until: Date, limit: number) {
    return this.prisma.reminder.findMany({
      where: {
        ...visibleReminderWhere(userId),
        isActive: true,
        nextOccurrenceAt: { not: null, gte: now, lte: until },
      },
      select: safeReminderSelect,
      orderBy: [{ nextOccurrenceAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  findVisible(userId: string, reminderId: string) {
    return this.prisma.reminder.findFirst({
      where: { id: reminderId, ...visibleReminderWhere(userId) },
      select: safeReminderSelect,
    });
  }

  async update(
    actorUserId: string,
    reminderId: string,
    dto: UpdateReminderDto,
    schedule: StoredReminderSchedule | undefined,
    reactivatedNextOccurrenceAt: Date | null | undefined,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`reminder:${reminderId}`}, 0))`,
        );
        const existing = await tx.reminder.findUnique({
          where: { id: reminderId },
          select: { id: true, familyId: true, isActive: true },
        });
        if (!existing) return { outcome: 'not_found' as const };
        const manager = await tx.familyMember.findFirst({
          where: {
            familyId: existing.familyId,
            userId: actorUserId,
            status: 'accepted',
            canManageCare: true,
            family: { status: 'active' },
          },
          select: {
            id: true,
            userId: true,
            canManageCare: true,
            isHired: true,
            careScopes: { select: { targetMemberId: true } },
            family: { select: { ownerUserId: true } },
          },
        });
        if (!manager) return { outcome: 'not_found' as const };
        // A hired caregiver changes a reminder only when every current
        // recipient is in their care scope.
        const current = await tx.reminderTarget.findMany({
          where: { reminderId },
          select: { memberId: true },
        });
        if (
          current.some(({ memberId }) => !isWithinHiredScope(manager, memberId))
        ) {
          return { outcome: 'forbidden' as const };
        }
        if (dto.targetMemberIds) {
          const targets = await tx.familyMember.findMany({
            where: {
              id: { in: dto.targetMemberIds },
              familyId: existing.familyId,
              status: 'accepted',
              family: { status: 'active' },
            },
            select: {
              id: true,
              userId: true,
              isCareRecipient: true,
              profile: { select: { dateOfBirth: true } },
            },
          });
          if (
            targets.length !== dto.targetMemberIds.length ||
            targets.some(
              (target) => !this.canManageTarget(actorUserId, manager, target),
            )
          ) {
            return { outcome: 'invalid_target' as const };
          }
          await tx.reminderTarget.deleteMany({ where: { reminderId } });
          await tx.reminderTarget.createMany({
            data: dto.targetMemberIds.map((memberId) => ({
              reminderId,
              memberId,
            })),
          });
        }
        const reminder = await tx.reminder.update({
          where: { id: reminderId },
          data: {
            title: dto.title,
            description: dto.description,
            reminderType: dto.reminderType,
            priority: dto.priority,
            ...(schedule ? toScheduleData(schedule) : {}),
            ...(schedule && !existing.isActive && dto.isActive !== true
              ? { nextOccurrenceAt: null }
              : {}),
            ...(dto.isActive === false
              ? { isActive: false, nextOccurrenceAt: null }
              : dto.isActive === true
                ? {
                    isActive: true,
                    nextOccurrenceAt:
                      schedule?.nextOccurrenceAt ?? reactivatedNextOccurrenceAt,
                  }
                : {}),
            updatedAt: new Date(),
          },
          select: safeReminderSelect,
        });
        return { outcome: 'updated' as const, reminder };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  deactivate(actorUserId: string, reminderId: string) {
    return this.update(
      actorUserId,
      reminderId,
      { isActive: false },
      undefined,
      undefined,
    );
  }

  /**
   * [memberIds] limits the history to those recipients; null shows all.
   */
  listLogs(
    userId: string,
    reminderId: string,
    query: ReminderLogQueryDto,
    cursor?: ReminderLogCursor,
    memberIds: string[] | null = null,
  ) {
    return this.prisma.reminderLog.findMany({
      where: {
        reminderId,
        reminder: visibleReminderWhere(userId),
        ...(memberIds ? { memberId: { in: memberIds } } : {}),
        ...(cursor
          ? {
              OR: [
                { scheduledAt: { lt: cursor.scheduledAt } },
                { scheduledAt: cursor.scheduledAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: safeReminderLogSelect,
      orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  async canView(userId: string, reminderId: string) {
    return Boolean(
      await this.prisma.reminder.findFirst({
        where: { id: reminderId, ...visibleReminderWhere(userId) },
        select: { id: true },
      }),
    );
  }

  listDue(now: Date, limit: number) {
    return this.prisma.reminder.findMany({
      where: { isActive: true, nextOccurrenceAt: { not: null, lte: now } },
      select: { id: true, nextOccurrenceAt: true },
      orderBy: [{ nextOccurrenceAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async claimOccurrence(
    reminderId: string,
    occurrenceAt: Date,
    now: Date,
    catchUpCutoff: Date,
  ) {
    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`reminder:${reminderId}`}, 0))`,
          );
          const reminder = await tx.reminder.findFirst({
            where: {
              id: reminderId,
              isActive: true,
              nextOccurrenceAt: occurrenceAt,
              family: { status: 'active' },
            },
            select: {
              id: true,
              familyId: true,
              scheduleType: true,
              timezone: true,
              startAt: true,
              endAt: true,
              scheduleRule: true,
              targets: {
                where: { member: { status: 'accepted' } },
                select: {
                  memberId: true,
                  member: { select: { familyId: true } },
                },
              },
            },
          });
          if (!reminder) return { outcome: 'skipped' as const, dueLogIds: [] };
          const isMissed = occurrenceAt < catchUpCutoff;
          const status = isMissed ? REMINDER_LOG_MISSED : REMINDER_LOG_DUE;
          const authorizedTargets = reminder.targets.filter(
            (target) => target.member.familyId === reminder.familyId,
          );
          await tx.reminderLog.createMany({
            data: authorizedTargets.map(({ memberId }) => ({
              reminderId,
              memberId,
              scheduledAt: occurrenceAt,
              status,
              processedAt: now,
            })),
            skipDuplicates: true,
          });
          const schedule = storedScheduleToDto(reminder);
          const nextOccurrenceAt = nextOccurrenceForSchedule(
            schedule,
            isMissed ? now : occurrenceAt,
          );
          await tx.reminder.update({
            where: { id: reminderId },
            data: {
              nextOccurrenceAt,
              isActive: nextOccurrenceAt !== null,
              updatedAt: now,
            },
          });
          const dueLogs = isMissed
            ? []
            : await tx.reminderLog.findMany({
                where: {
                  reminderId,
                  scheduledAt: occurrenceAt,
                  status: REMINDER_LOG_DUE,
                  notificationProcessedAt: null,
                },
                select: { id: true },
              });
          return {
            outcome: isMissed ? ('missed' as const) : ('due' as const),
            dueLogIds: dueLogs.map(({ id }) => id),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  listPendingNotificationLogs(limit: number) {
    return this.prisma.reminderLog.findMany({
      where: { status: REMINDER_LOG_DUE, notificationProcessedAt: null },
      select: { id: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  markNotificationProcessed(logId: string) {
    return this.prisma.reminderLog.updateMany({
      where: { id: logId, notificationProcessedAt: null },
      data: { notificationProcessedAt: new Date() },
    });
  }

  /**
   * Recipient confirms a due occurrence. Only the recipient may, and only
   * while the occurrence is still due; repeating it is a no-op.
   */
  async completeLog(
    userId: string,
    logId: string,
    note: string | null | undefined,
    now: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const log = await tx.reminderLog.findFirst({
        where: {
          id: logId,
          member: { userId, status: 'accepted' },
          reminder: { family: { status: 'active' } },
        },
        select: { id: true, status: true },
      });
      if (!log) return { outcome: 'not_found' as const };
      if (log.status === REMINDER_LOG_MISSED) {
        return { outcome: 'missed' as const };
      }
      if (log.status === REMINDER_LOG_DUE) {
        await tx.reminderLog.updateMany({
          where: { id: logId, status: REMINDER_LOG_DUE },
          data: {
            status: REMINDER_LOG_COMPLETED,
            completedAt: now,
            ...(note !== undefined ? { note } : {}),
          },
        });
      }
      const updated = await tx.reminderLog.findUniqueOrThrow({
        where: { id: logId },
        select: safeReminderLogSelect,
      });
      if (updated.status === REMINDER_LOG_MISSED) {
        return { outcome: 'missed' as const };
      }
      return {
        outcome: 'completed' as const,
        changed: log.status === REMINDER_LOG_DUE,
        log: updated,
      };
    });
  }

  /** Due occurrences nobody confirmed before [cutoff] become missed. */
  async markUnconfirmedMissed(cutoff: Date, limit: number) {
    const stale = await this.prisma.reminderLog.findMany({
      where: { status: REMINDER_LOG_DUE, scheduledAt: { lt: cutoff } },
      select: { id: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    if (stale.length === 0) return [];
    const ids = stale.map(({ id }) => id);
    await this.prisma.reminderLog.updateMany({
      where: { id: { in: ids }, status: REMINDER_LOG_DUE },
      data: { status: REMINDER_LOG_MISSED },
    });
    const missed = await this.prisma.reminderLog.findMany({
      where: { id: { in: ids }, status: REMINDER_LOG_MISSED },
      select: { id: true },
    });
    return missed.map(({ id }) => id);
  }

  findLogsForBroadcast(logIds: string[]) {
    return this.prisma.reminderLog.findMany({
      where: { id: { in: logIds } },
      select: {
        ...safeReminderLogSelect,
        reminder: {
          select: {
            creatorUserId: true,
            familyId: true,
            family: { select: { ownerUserId: true } },
          },
        },
      },
    });
  }

  /**
   * Users who see a member's reminder occurrences: managers of the family
   * (hired ones only within their care scope).
   */
  async managerUserIds(familyId: string, memberId: string) {
    const rows = await this.prisma.familyMember.findMany({
      where: {
        familyId,
        status: 'accepted',
        canManageCare: true,
      },
      select: {
        userId: true,
        isHired: true,
        careScopes: { select: { targetMemberId: true } },
        family: { select: { ownerUserId: true } },
      },
    });
    return rows
      .filter((row) => isWithinHiredScope(row, memberId))
      .map((row) => row.userId);
  }

  /** Reminders and their logs that can appear on one agenda day. */
  listAgendaReminders(userId: string, start: Date, end: Date) {
    return this.prisma.reminder.findMany({
      where: {
        AND: [
          visibleReminderWhere(userId),
          {
            OR: [
              { isActive: true, nextOccurrenceAt: { not: null, lt: end } },
              { logs: { some: { scheduledAt: { gte: start, lt: end } } } },
            ],
          },
        ],
      },
      select: {
        ...safeReminderSelect,
        logs: {
          where: { scheduledAt: { gte: start, lt: end } },
          select: {
            id: true,
            memberId: true,
            scheduledAt: true,
            status: true,
            completedAt: true,
            member: {
              select: {
                id: true,
                userId: true,
                displayName: true,
                status: true,
                profile: { select: { fullName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
      orderBy: [{ id: 'asc' }],
      take: REMINDER_AGENDA_MAX_REMINDERS,
    });
  }

  /** The viewer's accepted memberships, to scope which members they see. */
  viewerMemberships(userId: string) {
    return this.prisma.familyMember.findMany({
      where: { userId, status: 'accepted', family: { status: 'active' } },
      select: {
        id: true,
        userId: true,
        familyId: true,
        canManageCare: true,
        isHired: true,
        careScopes: { select: { targetMemberId: true } },
        family: { select: { ownerUserId: true } },
      },
    });
  }

  /** Same rule as FamilyAccessService.canManage, on rows already loaded in the transaction. */
  private canManageTarget(
    actorUserId: string,
    manager: HiredScopeActor,
    target: {
      id: string;
      userId: string;
      isCareRecipient: boolean;
      profile: { dateOfBirth: Date | null };
    },
  ): boolean {
    return (
      target.userId !== actorUserId &&
      isEffectiveCareRecipient(target) &&
      isWithinHiredScope(manager, target.id)
    );
  }

  private async withSerializableRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (
          attempt + 1 >= REMINDER_TRANSACTION_RETRIES ||
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034'
        ) {
          throw error;
        }
      }
    }
  }
}
