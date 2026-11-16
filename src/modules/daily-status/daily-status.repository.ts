import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  DAILY_STATUS_TOP_APPS_LIMIT,
  DAILY_STATUS_TRANSACTION_RETRY_LIMIT,
} from './daily-status.constants';
import type {
  DailyStatusCursor,
  DailyStatusHistoryQueryDto,
  DailyStatusSummary,
} from './dto/daily-status.dto';
import { dailyStatusSummarySchema } from './dto/daily-status.dto';

const safeReportSelect = {
  id: true,
  familyId: true,
  memberId: true,
  subjectUserId: true,
  reportDate: true,
  timezone: true,
  dayStart: true,
  dayEnd: true,
  schemaVersion: true,
  summary: true,
  generatedAt: true,
  createdAt: true,
  subject: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

const reportAccessSelect = {
  ...safeReportSelect,
  family: { select: { status: true } },
  member: {
    select: {
      id: true,
      userId: true,
      role: true,
      status: true,
      locationSharingEnabled: true,
      profile: {
        select: {
          UserSetting: { select: { locationSharingEnabled: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class DailyStatusRepository {
  constructor(private readonly prisma: PrismaService) {}

  generate(
    familyId: string,
    memberId: string,
    reportDate: Date,
    timezone: string,
    dayStart: Date,
    dayEnd: Date,
  ) {
    return this.withRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(
            Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`daily-status:${familyId}:${memberId}:${reportDate.toISOString()}:${timezone}`}, 0))`,
          );
          const member = await tx.familyMember.findFirst({
            where: {
              id: memberId,
              familyId,
              status: 'accepted',
              role: { in: ['child', 'elder'] },
              family: { status: 'active' },
            },
            select: { id: true, userId: true, role: true },
          });
          if (!member) return { outcome: 'ineligible' as const };

          const context = {
            familyId,
            subjectUserId: member.userId,
            reportDate,
            timezone,
          };
          const existing = await tx.dailyStatusReport.findUnique({
            where: { familyId_subjectUserId_reportDate_timezone: context },
            select: safeReportSelect,
          });
          if (existing) return { outcome: 'reused' as const, report: existing };

          const summary = dailyStatusSummarySchema.parse(
            await this.aggregateSources(
              tx,
              familyId,
              member.id,
              member.userId,
              member.role,
              dayStart,
              dayEnd,
            ),
          );
          const report = await tx.dailyStatusReport.create({
            data: {
              familyId,
              memberId: member.id,
              subjectUserId: member.userId,
              reportDate,
              timezone,
              dayStart,
              dayEnd,
              schemaVersion: 1,
              summary,
            },
            select: safeReportSelect,
          });
          return { outcome: 'created' as const, report };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  listOwn(
    userId: string,
    query: DailyStatusHistoryQueryDto,
    cursor?: DailyStatusCursor,
  ) {
    return this.prisma.dailyStatusReport.findMany({
      where: {
        subjectUserId: userId,
        ...this.cursorWhere(cursor),
      },
      select: safeReportSelect,
      orderBy: [{ reportDate: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  listMember(
    familyId: string,
    memberId: string,
    query: DailyStatusHistoryQueryDto,
    cursor?: DailyStatusCursor,
  ) {
    return this.prisma.dailyStatusReport.findMany({
      where: { familyId, memberId, ...this.cursorWhere(cursor) },
      select: safeReportSelect,
      orderBy: [{ reportDate: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  findAccessReport(reportId: string) {
    return this.prisma.dailyStatusReport.findUnique({
      where: { id: reportId },
      select: reportAccessSelect,
    });
  }

  findCurrentMembership(userId: string, familyId: string) {
    return this.prisma.familyMember.findFirst({
      where: {
        userId,
        familyId,
        status: 'accepted',
        family: { status: 'active' },
      },
      select: { id: true, role: true, locationSharingEnabled: true },
    });
  }

  findCurrentSubject(memberId: string, familyId: string) {
    return this.prisma.familyMember.findFirst({
      where: {
        id: memberId,
        familyId,
        status: 'accepted',
        role: { in: ['child', 'elder'] },
        family: { status: 'active' },
      },
      select: { id: true, userId: true, role: true },
    });
  }

  countSosNotAuthorizedForViewer(
    report: {
      familyId: string;
      memberId: string;
      dayStart: Date;
      dayEnd: Date;
    },
    viewerUserId: string,
  ) {
    return this.prisma.sosEvent.count({
      where: {
        familyId: report.familyId,
        memberId: report.memberId,
        triggeredAt: { gte: report.dayStart, lt: report.dayEnd },
        recipients: { none: { recipientUserId: viewerUserId } },
      },
    });
  }

  listEligibleMissing(reportDate: Date, timezone: string, limit: number) {
    return this.prisma.familyMember.findMany({
      where: {
        status: 'accepted',
        role: { in: ['child', 'elder'] },
        family: { status: 'active' },
        dailyStatusReports: {
          none: { reportDate, timezone },
        },
      },
      select: { id: true, familyId: true },
      orderBy: { id: 'asc' },
      take: limit,
    });
  }

  private async aggregateSources(
    tx: Prisma.TransactionClient,
    familyId: string,
    memberId: string,
    subjectUserId: string,
    role: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<DailyStatusSummary> {
    const window = { gte: dayStart, lt: dayEnd };
    const [
      locations,
      geofenceEvents,
      geofenceAssignments,
      sosEvents,
      reminderLogs,
      reminderProcessedCount,
      reminderTargets,
      phoneUsage,
      phoneTopApps,
      phoneRuleCount,
    ] = await Promise.all([
      tx.location.aggregate({
        where: { userId: subjectUserId, recordedAt: window },
        _count: { _all: true },
        _max: { recordedAt: true },
      }),
      tx.geofenceEvent.groupBy({
        by: ['event_type'],
        where: {
          family_id: familyId,
          member_id: memberId,
          detected_at: window,
        },
        _count: { _all: true },
      }),
      tx.geofenceMember.count({
        where: { family_id: familyId, member_id: memberId },
      }),
      tx.sosEvent.groupBy({
        by: ['status'],
        where: { familyId, memberId, triggeredAt: window },
        _count: { _all: true },
      }),
      tx.reminderLog.groupBy({
        by: ['status'],
        where: {
          memberId,
          scheduledAt: window,
          reminder: { familyId },
        },
        _count: { _all: true },
      }),
      tx.reminderLog.count({
        where: {
          memberId,
          scheduledAt: window,
          notificationProcessedAt: { not: null },
          reminder: { familyId },
        },
      }),
      tx.reminderTarget.count({
        where: { memberId, reminder: { familyId } },
      }),
      role === 'child'
        ? tx.phoneUsageLog.aggregate({
            where: { memberId, startedAt: window },
            _count: { _all: true },
            _sum: { durationSeconds: true },
          })
        : Promise.resolve({
            _count: { _all: 0 },
            _sum: { durationSeconds: null },
          }),
      role === 'child'
        ? tx.phoneUsageLog.groupBy({
            by: ['appPackage', 'appName'],
            where: { memberId, startedAt: window },
            _sum: { durationSeconds: true },
            orderBy: { _sum: { durationSeconds: 'desc' } },
            take: DAILY_STATUS_TOP_APPS_LIMIT,
          })
        : Promise.resolve([]),
      role === 'child'
        ? tx.phoneRule.count({ where: { familyId, memberId, isActive: true } })
        : Promise.resolve(0),
    ]);

    const countBy = (
      rows: Array<{
        status?: string;
        event_type?: string;
        _count: { _all: number };
      }>,
      value: string,
    ) =>
      rows.find((row) => row.status === value || row.event_type === value)
        ?._count._all ?? 0;
    const sosTotal = sosEvents.reduce((sum, row) => sum + row._count._all, 0);
    const reminderTotal = reminderLogs.reduce(
      (sum, row) => sum + row._count._all,
      0,
    );
    const locationCount = locations._count._all;
    const phoneCount = phoneUsage._count._all;

    return {
      schemaVersion: 1,
      availability: {
        location: locationCount > 0 ? 'available' : 'no_data',
        geofence:
          geofenceAssignments > 0 || geofenceEvents.length > 0
            ? 'available'
            : 'no_data',
        sos: 'available',
        reminders:
          reminderTargets > 0 || reminderTotal > 0 ? 'available' : 'no_data',
        phoneUsage:
          role !== 'child'
            ? 'not_applicable'
            : phoneRuleCount > 0 || phoneCount > 0
              ? 'available'
              : 'no_data',
      },
      location: {
        recordCount: locationCount,
        lastRecordedAt: locations._max.recordedAt?.toISOString() ?? null,
      },
      geofence: {
        enterCount: countBy(geofenceEvents, 'enter'),
        exitCount: countBy(geofenceEvents, 'exit'),
      },
      sos: {
        totalCount: sosTotal,
        activeCount: countBy(sosEvents, 'active'),
        resolvedCount: countBy(sosEvents, 'resolved'),
        cancelledCount: countBy(sosEvents, 'cancelled'),
      },
      reminders: {
        occurrenceCount: reminderTotal,
        notificationProcessedCount: reminderProcessedCount,
        missedCount: countBy(reminderLogs, 'missed'),
      },
      phoneUsage: {
        totalUsageSeconds: phoneUsage._sum.durationSeconds ?? 0,
        topApps: phoneTopApps.map((row) => ({
          appPackage: row.appPackage,
          appName: row.appName,
          durationSeconds: row._sum.durationSeconds ?? 0,
        })),
      },
    };
  }

  private cursorWhere(cursor?: DailyStatusCursor) {
    if (!cursor) return {};
    return {
      OR: [
        { reportDate: { lt: cursor.reportDate } },
        { reportDate: cursor.reportDate, id: { lt: cursor.id } },
      ],
    };
  }

  private async withRetry<T>(work: () => Promise<T>): Promise<T> {
    for (
      let attempt = 1;
      attempt <= DAILY_STATUS_TRANSACTION_RETRY_LIMIT;
      attempt++
    ) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';
        if (!retryable || attempt === DAILY_STATUS_TRANSACTION_RETRY_LIMIT) {
          throw error;
        }
      }
    }
    throw new Error('Unreachable Daily Status transaction retry state');
  }
}
