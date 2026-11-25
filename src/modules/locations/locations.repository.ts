import { Injectable } from '@nestjs/common';
import {
  isEffectiveCareRecipient,
  minorBirthDateCutoff,
} from '../../common/utils/age.util';
import { isWithinHiredScope } from '../families/care-scope.util';
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
  owner_user_id?: string;
  can_manage_care?: boolean;
  is_care_recipient?: boolean;
  is_hired?: boolean;
  date_of_birth?: Date | null;
  care_scope_member_ids?: string[];
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

          const recipientUserIds =
            projection.length > 0
              ? await this.resolveLiveLocationRecipients(tx, userId)
              : [];

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

  /**
   * Who receives a live location update from [userId], per family:
   * - as a care recipient (flag or under 18) the whole family receives it,
   *   whatever their sharing switches or viewer list say;
   * - otherwise only when both sharing switches are on, limited to the
   *   viewer list when visibility is `selected`;
   * - a hired caregiver who is not the owner only receives members in scope.
   */
  private async resolveLiveLocationRecipients(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string[]> {
    const [senderMemberships, setting] = await Promise.all([
      tx.familyMember.findMany({
        where: {
          userId,
          status: 'accepted',
          family: { status: 'active' },
        },
        select: {
          id: true,
          familyId: true,
          isCareRecipient: true,
          locationSharingEnabled: true,
          profile: { select: { dateOfBirth: true } },
          family: { select: { ownerUserId: true } },
        },
      }),
      tx.userSetting.findUnique({
        where: { userId },
        select: { locationSharingEnabled: true, locationVisibility: true },
      }),
    ]);
    const visibleFamilies = senderMemberships
      .map((membership) => ({
        ...membership,
        careRecipient: isEffectiveCareRecipient(membership),
      }))
      .filter(
        (membership) =>
          membership.careRecipient ||
          (membership.locationSharingEnabled &&
            setting?.locationSharingEnabled === true),
      );
    if (visibleFamilies.length === 0) return [];

    const selectedViewers =
      setting?.locationVisibility === 'selected'
        ? new Set(
            (
              await tx.locationShareViewer.findMany({
                where: { ownerUserId: userId },
                select: { viewerUserId: true },
              })
            ).map((viewer) => viewer.viewerUserId),
          )
        : null;
    const recipients = await tx.familyMember.findMany({
      where: {
        familyId: { in: visibleFamilies.map((item) => item.familyId) },
        status: 'accepted',
        family: { status: 'active' },
      },
      select: {
        id: true,
        userId: true,
        familyId: true,
        isHired: true,
        careScopes: { select: { targetMemberId: true } },
        family: { select: { ownerUserId: true } },
      },
    });
    const senderByFamily = new Map(
      visibleFamilies.map((item) => [item.familyId, item]),
    );
    const result = new Set<string>();
    for (const recipient of recipients) {
      const sender = senderByFamily.get(recipient.familyId);
      if (!sender || recipient.userId === userId) continue;
      if (!isWithinHiredScope(recipient, sender.id)) continue;
      if (
        !sender.careRecipient &&
        selectedViewers &&
        !selectedViewers.has(recipient.userId)
      ) {
        continue;
      }
      result.add(recipient.userId);
    }
    return [...result];
  }

  findHistoryTarget(familyId: string, memberId: string) {
    return this.prisma.familyMember.findFirst({
      where: {
        id: memberId,
        familyId,
        status: 'accepted',
        family: { status: 'active' },
      },
      select: { userId: true },
    });
  }

  findFamilyCurrentLocations(familyId: string, viewerId: string) {
    return this.prisma.$queryRaw<FamilyCurrentLocationRow[]>(
      this.familyCurrentLocationQuery(familyId, viewerId, Prisma.empty),
    );
  }

  async findFamilyMemberCurrentLocation(
    familyId: string,
    memberId: string,
    viewerId: string,
  ) {
    const rows = await this.prisma.$queryRaw<FamilyCurrentLocationRow[]>(
      this.familyCurrentLocationQuery(
        familyId,
        viewerId,
        Prisma.sql`AND fm."id" = ${memberId}::uuid`,
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Current locations visible to [viewerId] in one family.
   * - A care recipient (flag or under 18) is always visible to the family:
   *   their own sharing switches and viewer list cannot hide them.
   * - Anyone else follows their sharing switches and `location_visibility`.
   * - A hired caregiver who is not the owner only sees members in their scope.
   */
  private familyCurrentLocationQuery(
    familyId: string,
    viewerId: string,
    extraWhere: Prisma.Sql,
  ) {
    const minorCutoff = minorBirthDateCutoff();
    return Prisma.sql`
      SELECT
        fm."id" AS member_id,
        fm."user_id",
        f."owner_user_id",
        fm."can_manage_care",
        fm."is_care_recipient",
        fm."is_hired",
        p."date_of_birth",
        ARRAY(
          SELECT cs."target_member_id"
          FROM "public"."family_member_care_scopes" cs
          WHERE cs."member_id" = fm."id"
          ORDER BY cs."target_member_id" ASC
        ) AS care_scope_member_ids,
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
        ${extraWhere}
        AND f."status" = 'active'
        AND fm."status" = 'accepted'
        AND (
          fm."is_care_recipient" = true
          OR p."date_of_birth" > ${minorCutoff}::date
          OR (
            fm."location_sharing_enabled" = true
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
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM "public"."family_members" viewer
          WHERE viewer."family_id" = fm."family_id"
            AND viewer."user_id" = ${viewerId}::uuid
            AND viewer."status" = 'accepted'
            AND viewer."is_hired" = true
            AND f."owner_user_id" <> ${viewerId}::uuid
            AND fm."user_id" <> ${viewerId}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM "public"."family_member_care_scopes" cs
              WHERE cs."member_id" = viewer."id"
                AND cs."target_member_id" = fm."id"
            )
        )
      ORDER BY fm."created_at" ASC, fm."id" ASC
    `;
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
