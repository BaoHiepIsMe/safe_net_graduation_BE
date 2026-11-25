import { Buffer } from 'node:buffer';
import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { isEffectiveCareRecipient, isMinor } from '../../common/utils/age.util';
import {
  HiredScopeActor,
  isWithinHiredScope,
} from '../families/care-scope.util';
import { DailyStatusRepository } from './daily-status.repository';
import { dailyStatusWindow } from './daily-status-window';
import type {
  DailyStatusHistoryQueryDto,
  DailyStatusSummary,
} from './dto/daily-status.dto';
import { dailyStatusSummarySchema } from './dto/daily-status.dto';

const cursorSchema = z
  .tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().uuid()])
  .transform(([date, id]) => ({
    reportDate: new Date(`${date}T00:00:00.000Z`),
    id,
  }));

@Injectable()
export class DailyStatusService {
  constructor(private readonly repository: DailyStatusRepository) {}

  async generate(
    familyId: string,
    memberId: string,
    reportDate: string,
    timezone: string,
  ) {
    let window;
    try {
      window = dailyStatusWindow(reportDate, timezone);
    } catch {
      throw new AppError(
        ErrorCode.DAILY_STATUS_INVALID_DATE,
        'Daily Status date or timezone is invalid',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const result = await this.repository.generate(
      familyId,
      memberId,
      new Date(`${reportDate}T00:00:00.000Z`),
      timezone,
      window.dayStart,
      window.dayEnd,
    );
    return result;
  }

  async ownHistory(userId: string, query: DailyStatusHistoryQueryDto) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    return this.page(
      await this.repository.listOwn(userId, query, cursor),
      query,
    );
  }

  async memberHistory(
    userId: string,
    familyId: string,
    memberId: string,
    query: DailyStatusHistoryQueryDto,
  ) {
    const subject = await this.repository.findCurrentSubject(
      memberId,
      familyId,
    );
    if (
      !subject ||
      !isEffectiveCareRecipient({
        isCareRecipient: subject.isCareRecipient,
        dateOfBirth: subject.profile?.dateOfBirth,
      })
    ) {
      this.denied();
    }
    if (subject.userId !== userId) {
      const viewer = await this.repository.findCurrentMembership(
        userId,
        familyId,
      );
      if (!this.canViewerManage(viewer, subject.id)) this.denied();
    }
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    return this.page(
      await this.repository.listMember(familyId, memberId, query, cursor),
      query,
    );
  }

  async detail(userId: string, reportId: string) {
    const report = await this.repository.findAccessReport(reportId);
    if (!report) this.notFound();
    const parsed = dailyStatusSummarySchema.safeParse(report.summary);
    if (!parsed.success) {
      throw new AppError(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Stored Daily Status data is invalid',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (report.subjectUserId === userId) {
      return this.mapDetail(report, parsed.data, {
        location: true,
        geofence: true,
        sos: true,
        reminders: true,
        phoneUsage: true,
      });
    }

    const viewer = await this.repository.findCurrentMembership(
      userId,
      report.familyId,
    );
    if (
      !this.canViewerManage(viewer, report.member.id) ||
      report.family.status !== 'active' ||
      report.member.status !== 'accepted' ||
      !isEffectiveCareRecipient({
        isCareRecipient: report.member.isCareRecipient,
        dateOfBirth: report.member.profile?.dateOfBirth,
      })
    ) {
      this.denied();
    }

    // The subject is a care recipient the viewer canManage: their own sharing
    // switches cannot hide location parts from the report.
    const locationAllowed = viewer.locationSharingEnabled !== false;
    const sosAllowed =
      (await this.repository.countSosNotAuthorizedForViewer(report, userId)) ===
      0;
    return this.mapDetail(report, parsed.data, {
      location: locationAllowed,
      geofence: locationAllowed,
      sos: sosAllowed,
      reminders: true,
      phoneUsage: isMinor(report.member.profile?.dateOfBirth),
    });
  }

  /** canManage for a target already known to be a care recipient. */
  private canViewerManage(
    viewer: (HiredScopeActor & { id: string; canManageCare: boolean }) | null,
    targetMemberId: string,
  ): viewer is HiredScopeActor & { id: string; canManageCare: boolean } {
    return (
      viewer !== null &&
      viewer.canManageCare &&
      viewer.id !== targetMemberId &&
      isWithinHiredScope(viewer, targetMemberId)
    );
  }

  private page(rows: any[], query: DailyStatusHistoryQueryDto) {
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);
    return {
      data: page.map((row) => this.mapOverview(row)),
      pagination: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore && last ? this.encodeCursor(last) : null,
      },
    };
  }

  private mapOverview(report: any) {
    return {
      id: report.id,
      familyId: report.familyId,
      memberId: report.memberId,
      subject: report.subject,
      reportDate: this.dateOnly(report.reportDate),
      timezone: report.timezone,
      generatedAt: report.generatedAt,
    };
  }

  private mapDetail(
    report: any,
    summary: DailyStatusSummary,
    access: Record<
      'location' | 'geofence' | 'sos' | 'reminders' | 'phoneUsage',
      boolean
    >,
  ) {
    const availability = Object.fromEntries(
      Object.entries(summary.availability).map(([key, value]) => [
        key,
        // A section that never applied (phone usage of an adult) stays
        // not_applicable: it is not something the viewer is denied.
        access[key as keyof typeof access] || value === 'not_applicable'
          ? value
          : 'restricted',
      ]),
    );
    return {
      ...this.mapOverview(report),
      dayStart: report.dayStart,
      dayEnd: report.dayEnd,
      schemaVersion: report.schemaVersion,
      dataAvailability: availability,
      locationSummary: access.location ? summary.location : null,
      geofenceSummary: access.geofence ? summary.geofence : null,
      sosSummary: access.sos ? summary.sos : null,
      reminderSummary: access.reminders ? summary.reminders : null,
      phoneUsageSummary: access.phoneUsage ? summary.phoneUsage : null,
    };
  }

  private encodeCursor(report: { reportDate: Date; id: string }) {
    return Buffer.from(
      `${this.dateOnly(report.reportDate)}|${report.id}`,
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(value: string) {
    try {
      const parsed = cursorSchema.safeParse(
        Buffer.from(value, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Invalid Daily Status cursor' }],
        'Invalid cursor',
      );
    }
  }

  private dateOnly(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private notFound(): never {
    throw new NotFoundError(
      'Daily Status report not found',
      ErrorCode.DAILY_STATUS_NOT_FOUND,
    );
  }

  private denied(): never {
    throw new ForbiddenError(
      'Daily Status report access denied',
      ErrorCode.DAILY_STATUS_ACCESS_DENIED,
    );
  }
}
