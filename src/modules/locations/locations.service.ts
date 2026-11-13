import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { RealtimeGateway } from '../../infrastructure/realtime/realtime.gateway';
import { FamilyAccessService } from '../families/family-access.service';
import { GeofenceEvaluationService } from '../geofences/geofence-evaluation.service';
import {
  IngestLocationDto,
  LocationHistoryCursor,
  LocationHistoryQueryDto,
  LocationHistoryRange,
} from './dto/location.dto';
import {
  LOCATION_EVENT_NAME,
  LOCATION_FAMILY_HISTORY_MAX_DAYS,
} from './locations.constants';
import {
  FamilyCurrentLocationRow,
  LocationsRepository,
} from './locations.repository';

const cursorPayloadSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([recordedAt, id]) => ({
    recordedAt: new Date(recordedAt),
    id,
  }));

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);

  constructor(
    private readonly locationsRepository: LocationsRepository,
    private readonly familyAccess: FamilyAccessService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly geofenceEvaluation: GeofenceEvaluationService,
  ) {}

  async ingest(userId: string, deviceId: string, dto: IngestLocationDto) {
    let result;
    try {
      result = await this.locationsRepository.ingest(userId, deviceId, dto);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        throw new ConflictError(
          'Vị trí đang được cập nhật đồng thời; vui lòng thử lại',
          ErrorCode.INVALID_LOCATION,
        );
      }
      throw error;
    }

    if (result.outcome === 'not_found') this.throwDeviceNotFound();
    if (result.outcome === 'inactive') {
      throw new BusinessRuleError(
        ErrorCode.DEVICE_INACTIVE,
        'Thiết bị đã ngừng hoạt động',
      );
    }

    const location = this.mapLocation(result.history);
    if (result.currentUpdated) {
      await this.geofenceEvaluation.evaluateCommittedLocation({
        id: location.id,
        userId,
        latitude: location.latitude,
        longitude: location.longitude,
        recordedAt: location.recordedAt,
      });
      const payload = {
        userId,
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          batteryLevel: location.batteryLevel,
          recordedAt: location.recordedAt,
          updatedAt: location.createdAt,
        },
      };
      const recipients = new Set([userId, ...result.recipientUserIds]);
      recipients.forEach((recipientUserId) => {
        try {
          this.realtimeGateway.emitToUser(
            recipientUserId,
            LOCATION_EVENT_NAME,
            payload,
          );
        } catch {
          this.logger.warn('Realtime location delivery failed after commit');
        }
      });
    }

    return { ...location, currentUpdated: result.currentUpdated };
  }

  async getOwnCurrent(userId: string) {
    const current = await this.locationsRepository.findOwnCurrent(userId);
    if (!current) this.throwLocationNotFound();
    return this.mapCurrent(current);
  }

  async getOwnHistory(userId: string, query: LocationHistoryQueryDto) {
    return this.listHistoryPage(userId, query, {
      from: query.from,
      to: query.to,
    });
  }

  async getFamilyMemberHistory(
    viewerId: string,
    familyId: string,
    memberId: string,
    query: LocationHistoryQueryDto,
  ) {
    await this.familyAccess.requireAcceptedMember(viewerId, familyId);
    const target = await this.locationsRepository.findHistoryTarget(
      familyId,
      memberId,
    );
    if (!target || (target.userId !== viewerId && !target.sharing)) {
      this.throwLocationNotFound();
    }
    const oldest =
      Date.now() - LOCATION_FAMILY_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;
    const from = new Date(Math.max(query.from?.getTime() ?? 0, oldest));
    return this.listHistoryPage(target.userId, query, { from, to: query.to });
  }

  private async listHistoryPage(
    userId: string,
    query: LocationHistoryQueryDto,
    range: LocationHistoryRange,
  ) {
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.locationsRepository.listHistory(
      userId,
      query,
      cursor,
      range,
    );
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) => this.mapLocation(row)),
      pagination: {
        limit: query.limit,
        nextCursor: hasMore && last ? this.encodeCursor(last) : null,
        hasMore,
      },
    };
  }

  async getFamilyCurrent(userId: string, familyId: string) {
    await this.familyAccess.requireAcceptedMember(userId, familyId);
    const rows =
      await this.locationsRepository.findFamilyCurrentLocations(familyId);
    return rows.map((row) => this.mapFamilyCurrent(row));
  }

  async getFamilyMemberCurrent(
    userId: string,
    familyId: string,
    memberId: string,
  ) {
    await this.familyAccess.requireAcceptedMember(userId, familyId);
    const row = await this.locationsRepository.findFamilyMemberCurrentLocation(
      familyId,
      memberId,
    );
    if (!row) this.throwLocationNotFound();
    return this.mapFamilyCurrent(row);
  }

  private encodeCursor(row: { id: string; recordedAt: Date }): string {
    return Buffer.from(
      `${row.recordedAt.toISOString()}|${row.id}`,
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): LocationHistoryCursor {
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const parsed = cursorPayloadSchema.safeParse(decoded.split('|'));
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Cursor lịch sử vị trí không hợp lệ' }],
        'Cursor không hợp lệ',
      );
    }
  }

  private mapLocation(location: {
    id: string;
    latitude: Prisma.Decimal;
    longitude: Prisma.Decimal;
    accuracy: number | null;
    speed: number | null;
    heading: number | null;
    batteryLevel: number | null;
    recordedAt: Date;
    createdAt: Date;
  }) {
    return {
      id: location.id,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracy: location.accuracy,
      speed: location.speed,
      heading: location.heading,
      batteryLevel: location.batteryLevel,
      recordedAt: location.recordedAt,
      createdAt: location.createdAt,
    };
  }

  private mapCurrent(location: {
    latitude: Prisma.Decimal;
    longitude: Prisma.Decimal;
    accuracy: number | null;
    batteryLevel: number | null;
    recordedAt: Date;
    updatedAt: Date;
  }) {
    return {
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      accuracy: location.accuracy,
      batteryLevel: location.batteryLevel,
      recordedAt: location.recordedAt,
      updatedAt: location.updatedAt,
    };
  }

  private mapFamilyCurrent(row: FamilyCurrentLocationRow) {
    return {
      memberId: row.member_id,
      userId: row.user_id,
      role: row.role,
      familyLabel: row.family_label,
      displayName: row.display_name,
      profile: {
        fullName: row.full_name,
        avatarUrl: row.avatar_url,
      },
      location: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        accuracy: row.accuracy,
        batteryLevel: row.battery_level,
        recordedAt: row.recorded_at,
        updatedAt: row.updated_at,
      },
    };
  }

  private throwDeviceNotFound(): never {
    throw new NotFoundError(
      'Không tìm thấy thiết bị',
      ErrorCode.DEVICE_NOT_FOUND,
    );
  }

  private throwLocationNotFound(): never {
    throw new NotFoundError(
      'Không tìm thấy vị trí được phép truy cập',
      ErrorCode.LOCATION_NOT_FOUND,
    );
  }
}
