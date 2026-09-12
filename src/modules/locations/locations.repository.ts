import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IngestLocationDto,
  LocationHistoryCursor,
  LocationHistoryQueryDto,
} from './dto/location.dto';
import { LOCATION_TRANSACTION_RETRY_LIMIT } from './locations.constants';

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
                  locationSharingEnabled: true,
                  family: { status: 'active' },
                },
                select: { userId: true },
              });
              recipientUserIds = [
                ...new Set(recipients.map((item) => item.userId)),
              ];
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

  async listOwnHistory(
    userId: string,
    query: LocationHistoryQueryDto,
    cursor?: LocationHistoryCursor,
  ) {
    const cursorWhere = cursor
      ? {
          OR: [
            { recordedAt: { lt: cursor.recordedAt } },
            { recordedAt: cursor.recordedAt, id: { lt: cursor.id } },
          ],
        }
      : {};
    return this.prisma.location.findMany({
      where: { userId, ...cursorWhere },
      select: locationHistorySelect,
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  findFamilyCurrentLocations(familyId: string) {
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
      ORDER BY fm."created_at" ASC, fm."id" ASC
    `);
  }

  async findFamilyMemberCurrentLocation(familyId: string, memberId: string) {
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
        LIMIT 1
      `,
    );
    return rows[0] ?? null;
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
