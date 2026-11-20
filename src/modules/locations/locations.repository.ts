import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IngestLocationDto,
  LocationHistoryCursor,
  LocationHistoryQueryDto,
  LocationHistoryRange,
} from './dto/location.dto';
import {
  LOCATION_TRANSACTION_RETRY_LIMIT,
  SIGNAL_LOSS_MAX_AGE_MS,
  SIGNAL_LOSS_THRESHOLD_MS,
} from './locations.constants';

export interface SignalLossCandidateRow {
  user_id: string;
  location_id: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  last_location_at: Date;
  last_seen_at: Date;
  sharing_mode: string;
}

export const locationHistorySelect = {
  id: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  speed: true,
  heading: true,
  batteryLevel: true,
  recordedAt: true,
  createdAt: true,
} as const;

export const currentLocationSelect = {
  latitude: true,
  longitude: true,
  accuracy: true,
  batteryLevel: true,
  recordedAt: true,
  updatedAt: true,
} as const;

export interface FamilyCurrentLocationRow {
  member_id: string;
  user_id: string;
  role: string;
  family_label: string;
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  latitude: string | number;
  longitude: string | number;
  accuracy: number | null;
  battery_level: number | null;
  recorded_at: Date;
  updated_at: Date;
}

@Injectable()
export class LocationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  ingest(userId: string, deviceId: string, dto: IngestLocationDto) {
    return this.withTransactionRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const device = await tx.device.findFirst({
            where: { id: deviceId, userId },
            select: { id: true, isActive: true },
          });
          if (!device) return { outcome: 'not_found' as const };
          if (!device.isActive) return { outcome: 'inactive' as const };

          const history = await tx.location.create({
            data: {
              userId,
              deviceId,
              latitude: dto.latitude,
              longitude: dto.longitude,
              accuracy: dto.accuracy,
              speed: dto.speed,
              heading: dto.heading,
              batteryLevel: dto.batteryLevel,
              recordedAt: dto.recordedAt,
            },
            select: locationHistorySelect,
          });

          const now = new Date();
          const projection = await tx.$queryRaw<Array<{ user_id: string }>>(
            Prisma.sql`
              INSERT INTO "public"."current_locations" (
                "user_id", "member_id", "device_id", "location_id",
                "latitude", "longitude", "accuracy", "battery_level",
                "recorded_at", "updated_at"
              ) VALUES (
                ${userId}::uuid, NULL, ${deviceId}::uuid, ${history.id}::uuid,
                ${dto.latitude}, ${dto.longitude}, ${dto.accuracy ?? null},
                ${dto.batteryLevel ?? null}, ${dto.recordedAt}, ${now}
              )
              ON CONFLICT ("user_id") DO UPDATE SET
                "member_id" = NULL,
                "device_id" = EXCLUDED."device_id",
                "location_id" = EXCLUDED."location_id",
                "latitude" = EXCLUDED."latitude",
                "longitude" = EXCLUDED."longitude",
                "accuracy" = EXCLUDED."accuracy",
                "battery_level" = EXCLUDED."battery_level",
                "recorded_at" = EXCLUDED."recorded_at",
                "updated_at" = EXCLUDED."updated_at"
              WHERE EXCLUDED."recorded_at" > "current_locations"."recorded_at"
                 OR (
                   EXCLUDED."recorded_at" = "current_locations"."recorded_at"
                   AND EXCLUDED."location_id" > "current_locations"."location_id"
                 )
              RETURNING "user_id"
            `,
          );

          await tx.device.update({
            where: { id: deviceId },
            data: {
              lastSeenAt: now,
              ...(dto.batteryLevel !== undefined
                ? { batteryLevel: dto.batteryLevel }
                : {}),
              updatedAt: now,
            },
            select: { id: true },
          });

          let recipientUserIds: string[] = [];
          if (projection.length > 0) {
            const sharedFamilies = await tx.familyMember.findMany({
              where: {
                userId,
                status: 'accepted',
                locationSharingEnabled: true,
                family: { status: 'active' },
                profile: {
                  UserSetting: { locationSharingEnabled: true },
                },
              },
              select: { familyId: true },
            });
            const familyIds = sharedFamilies.map((item) => item.familyId);
            if (familyIds.length > 0) {
              const recipients = await tx.familyMember.findMany({
                where: {
                  familyId: { in: familyIds },
                  status: 'accepted',
                  family: { status: 'active' },
                },
                select: { userId: true },
              });
              recipientUserIds = [
                ...new Set(recipients.map((item) => item.userId)),
              ];
              const setting = await tx.userSetting.findUnique({
                where: { userId },
                select: { locationVisibility: true },
              });
              if (setting?.locationVisibility === 'selected') {
                const viewers = await tx.locationShareViewer.findMany({
                  where: { ownerUserId: userId },
                  select: { viewerUserId: true },
                });
                const allowed = new Set(viewers.map((v) => v.viewerUserId));
                recipientUserIds = recipientUserIds.filter((id) =>
                  allowed.has(id),
                );
              }
            }
          }

          return {
            outcome: 'stored' as const,
            history,
            currentUpdated: projection.length > 0,
            recipientUserIds,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  findOwnCurrent(userId: string) {
    return this.prisma.currentLocation.findUnique({
      where: { userId },
      select: currentLocationSelect,
    });
  }

  async listHistory(
    userId: string,
    query: LocationHistoryQueryDto,
    cursor?: LocationHistoryCursor,
    range?: LocationHistoryRange,
  ) {
    const rangeWhere =
      range?.from || range?.to
        ? {
            recordedAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lt: range.to } : {}),
            },
          }
        : {};
    const cursorWhere = cursor
      ? {
          OR: [
            { recordedAt: { lt: cursor.recordedAt } },
            { recordedAt: cursor.recordedAt, id: { lt: cursor.id } },
          ],
        }
      : {};
    return this.prisma.location.findMany({
      where: { userId, ...rangeWhere, ...cursorWhere },
      select: locationHistorySelect,
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  async findHistoryTarget(
    familyId: string,
    memberId: string,
    viewerId: string,
  ) {
    const member = await this.prisma.familyMember.findFirst({
      where: {
        id: memberId,
        familyId,
        status: 'accepted',
        family: { status: 'active' },
      },
      select: {
        userId: true,
        locationSharingEnabled: true,
        profile: {
          select: {
            UserSetting: {
              select: {
                locationSharingEnabled: true,
                locationVisibility: true,
              },
            },
          },
        },
      },
    });
    if (!member) return null;
    let visible = true;
    if (
      member.userId !== viewerId &&
      member.profile.UserSetting?.locationVisibility === 'selected'
    ) {
      visible =
        (await this.prisma.locationShareViewer.count({
          where: { ownerUserId: member.userId, viewerUserId: viewerId },
        })) > 0;
    }
    return {
      userId: member.userId,
      sharing:
        member.locationSharingEnabled &&
        member.profile.UserSetting?.locationSharingEnabled === true &&
        visible,
    };
  }

  findFamilyCurrentLocations(familyId: string, viewerId: string) {
    return this.prisma.$queryRaw<FamilyCurrentLocationRow[]>(Prisma.sql`
      SELECT
        fm."id" AS member_id,
        fm."user_id",
        fm."role",
        fm."family_label",
        fm."display_name",
        p."full_name",
        p."avatar_url",
        c."latitude",
        c."longitude",
        c."accuracy",
        c."battery_level",
        c."recorded_at",
        c."updated_at"
      FROM "public"."family_members" fm
      JOIN "public"."families" f ON f."id" = fm."family_id"
      JOIN "public"."profiles" p ON p."id" = fm."user_id"
      JOIN "public"."user_settings" us ON us."user_id" = fm."user_id"
      JOIN "public"."current_locations" c ON c."user_id" = fm."user_id"
      WHERE fm."family_id" = ${familyId}::uuid
        AND f."status" = 'active'
        AND fm."status" = 'accepted'
        AND fm."location_sharing_enabled" = true
        AND us."location_sharing_enabled" = true
        AND (
          fm."user_id" = ${viewerId}::uuid
          OR us."location_visibility" = 'all'
          OR EXISTS (
            SELECT 1 FROM "public"."location_share_viewers" v
            WHERE v."owner_user_id" = fm."user_id"
              AND v."viewer_user_id" = ${viewerId}::uuid
          )
        )
      ORDER BY fm."created_at" ASC, fm."id" ASC
    `);
  }

  async findFamilyMemberCurrentLocation(
    familyId: string,
    memberId: string,
    viewerId: string,
  ) {
    const rows = await this.prisma.$queryRaw<FamilyCurrentLocationRow[]>(
      Prisma.sql`
        SELECT
          fm."id" AS member_id,
          fm."user_id",
          fm."role",
          fm."family_label",
          fm."display_name",
          p."full_name",
          p."avatar_url",
          c."latitude",
          c."longitude",
          c."accuracy",
          c."battery_level",
          c."recorded_at",
          c."updated_at"
        FROM "public"."family_members" fm
        JOIN "public"."families" f ON f."id" = fm."family_id"
        JOIN "public"."profiles" p ON p."id" = fm."user_id"
        JOIN "public"."user_settings" us ON us."user_id" = fm."user_id"
        JOIN "public"."current_locations" c ON c."user_id" = fm."user_id"
        WHERE fm."family_id" = ${familyId}::uuid
          AND fm."id" = ${memberId}::uuid
          AND f."status" = 'active'
          AND fm."status" = 'accepted'
          AND fm."location_sharing_enabled" = true
          AND us."location_sharing_enabled" = true
          AND (
          fm."user_id" = ${viewerId}::uuid
          OR us."location_visibility" = 'all'
          OR EXISTS (
            SELECT 1 FROM "public"."location_share_viewers" v
            WHERE v."owner_user_id" = fm."user_id"
              AND v."viewer_user_id" = ${viewerId}::uuid
          )
        )
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
  }

  /**
   * Sharing phones whose last accepted location is older than their mode's
   * threshold (but not dormant) and that nobody was told about yet. iOS is
   * left out until it tracks in the background. Newest silences first so a
   * pile of old ones cannot starve a fresh alert.
   */
  listSignalLossCandidates(now: Date, limit: number) {
    const continuous = SIGNAL_LOSS_THRESHOLD_MS.continuous / 1000;
    const saver = SIGNAL_LOSS_THRESHOLD_MS.battery_saver / 1000;
    const maxAge = SIGNAL_LOSS_MAX_AGE_MS / 1000;
    return this.prisma.$queryRaw<SignalLossCandidateRow[]>(Prisma.sql`
      SELECT
        c."user_id",
        c."location_id",
        c."latitude",
        c."longitude",
        c."updated_at" AS last_location_at,
        d."last_seen_at",
        us."sharing_mode"
      FROM "public"."current_locations" c
      JOIN "public"."devices" d
        ON d."id" = c."device_id" AND d."is_active" = true
        AND d."device_type" <> 'ios'
      JOIN "public"."user_settings" us ON us."user_id" = c."user_id"
      WHERE us."location_sharing_enabled" = true
        AND us."notify_on_signal_lost" = true
        AND c."updated_at" >= ${now}::timestamptz - make_interval(secs => ${maxAge}::double precision)
        AND c."updated_at" < ${now}::timestamptz - make_interval(
          secs => CASE us."sharing_mode"
            WHEN 'battery_saver' THEN ${saver}::double precision
            ELSE ${continuous}::double precision
          END
        )
        AND EXISTS (
          SELECT 1
          FROM "public"."family_members" me
          JOIN "public"."families" f
            ON f."id" = me."family_id" AND f."status" = 'active'
          JOIN "public"."family_members" other
            ON other."family_id" = me."family_id"
            AND other."user_id" <> me."user_id"
            AND other."status" = 'accepted'
          WHERE me."user_id" = c."user_id"
            AND me."status" = 'accepted'
            AND me."location_sharing_enabled" = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM "public"."notifications" n
          WHERE n."related_table" = 'location_signal'
            AND n."related_id" = c."location_id"
        )
      ORDER BY c."updated_at" DESC
      LIMIT ${limit}
    `);
  }

  async listViewerUserIds(ownerUserId: string) {
    const rows = await this.prisma.locationShareViewer.findMany({
      where: { ownerUserId },
      select: { viewerUserId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.viewerUserId);
  }

  /** User ids that share an active family with [userId] (excluding them). */
  async findFamilyPeerUserIds(userId: string) {
    const rows = await this.prisma.familyMember.findMany({
      where: {
        status: 'accepted',
        userId: { not: userId },
        family: {
          status: 'active',
          members: { some: { userId, status: 'accepted' } },
        },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((row) => row.userId))];
  }

  async replaceViewers(ownerUserId: string, viewerUserIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.locationShareViewer.deleteMany({ where: { ownerUserId } }),
      this.prisma.locationShareViewer.createMany({
        data: viewerUserIds.map((viewerUserId) => ({
          ownerUserId,
          viewerUserId,
        })),
      }),
    ]);
  }

  private async withTransactionRetry<T>(work: () => Promise<T>): Promise<T> {
    for (
      let attempt = 1;
      attempt <= LOCATION_TRANSACTION_RETRY_LIMIT;
      attempt++
    ) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';
        if (!retryable || attempt === LOCATION_TRANSACTION_RETRY_LIMIT) {
          throw error;
        }
      }
    }
    throw new Error('Unreachable location transaction retry state');
  }
}
