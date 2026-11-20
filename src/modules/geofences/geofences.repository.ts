import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { isPointInsideCircularGeofence } from './geofence-distance';
import { decideGeofenceTransition } from './geofence-transition';
import {
  CreateGeofenceDto,
  GeofenceEventCursor,
  GeofenceEventQueryDto,
  GeofenceListQueryDto,
  ReplaceGeofenceMembersDto,
  UpdateGeofenceDto,
} from './dto/geofence.dto';
import { GEOFENCE_TRANSACTION_RETRY_LIMIT } from './geofences.constants';

const assignmentSelect = {
  member_id: true,
  notify_on_enter: true,
  notify_on_exit: true,
  FamilyMember: {
    select: {
      userId: true,
      displayName: true,
      role: true,
      profile: { select: { fullName: true, avatarUrl: true } },
    },
  },
} as const;

const geofenceSelect = {
  id: true,
  family_id: true,
  name: true,
  address: true,
  center_latitude: true,
  center_longitude: true,
  radius_meters: true,
  icon: true,
  is_active: true,
  created_at: true,
  updated_at: true,
  GeofenceMember: { select: assignmentSelect, orderBy: { id: 'asc' } },
} as const;

export interface CommittedLocationForGeofences {
  id: string;
  userId: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
}

@Injectable()
export class GeofencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  createWithMembers(
    familyId: string,
    actorUserId: string,
    dto: CreateGeofenceDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const invalidMemberIds = await this.findInvalidMemberIds(
        tx,
        familyId,
        dto.members.map((item) => item.memberId),
      );
      if (invalidMemberIds.length > 0) {
        return { outcome: 'invalid_members' as const, invalidMemberIds };
      }
      const geofence = await tx.geofence.create({
        data: {
          family_id: familyId,
          created_by: actorUserId,
          name: dto.name,
          address: dto.address,
          center_latitude: dto.centerLatitude,
          center_longitude: dto.centerLongitude,
          radius_meters: dto.radiusMeters,
          icon: dto.icon,
          GeofenceMember: {
            create: dto.members.map((item) => ({
              family_id: familyId,
              member_id: item.memberId,
              notify_on_enter: item.notifyOnEnter,
              notify_on_exit: item.notifyOnExit,
            })),
          },
        },
        select: geofenceSelect,
      });
      return { outcome: 'created' as const, geofence };
    });
  }

  async list(familyId: string, query: GeofenceListQueryDto) {
    const where = {
      family_id: familyId,
      ...(query.active === undefined ? {} : { is_active: query.active }),
    } satisfies Prisma.GeofenceWhereInput;
    const [rows, total] = await Promise.all([
      this.prisma.geofence.findMany({
        where,
        select: geofenceSelect,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.geofence.count({ where }),
    ]);
    return { rows, total };
  }

  findOne(familyId: string, geofenceId: string) {
    return this.prisma.geofence.findFirst({
      where: { id: geofenceId, family_id: familyId },
      select: geofenceSelect,
    });
  }

  update(familyId: string, geofenceId: string, dto: UpdateGeofenceDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.geofence.findFirst({
        where: { id: geofenceId, family_id: familyId },
        select: { id: true },
      });
      if (!existing) return null;
      return tx.geofence.update({
        where: { id: geofenceId },
        data: {
          name: dto.name,
          address: dto.address,
          center_latitude: dto.centerLatitude,
          center_longitude: dto.centerLongitude,
          radius_meters: dto.radiusMeters,
          icon: dto.icon,
          is_active: dto.isActive,
          updated_at: new Date(),
        },
        select: geofenceSelect,
      });
    });
  }

  deactivate(familyId: string, geofenceId: string) {
    return this.prisma.geofence.updateMany({
      where: { id: geofenceId, family_id: familyId },
      data: { is_active: false, updated_at: new Date() },
    });
  }

  replaceMembers(
    familyId: string,
    geofenceId: string,
    dto: ReplaceGeofenceMembersDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const geofence = await tx.geofence.findFirst({
        where: { id: geofenceId, family_id: familyId },
        select: { id: true },
      });
      if (!geofence) return { outcome: 'not_found' as const };
      const invalidMemberIds = await this.findInvalidMemberIds(
        tx,
        familyId,
        dto.members.map((item) => item.memberId),
      );
      if (invalidMemberIds.length > 0) {
        return { outcome: 'invalid_members' as const, invalidMemberIds };
      }
      await tx.geofenceMember.deleteMany({
        where: { geofence_id: geofenceId },
      });
      if (dto.members.length > 0) {
        await tx.geofenceMember.createMany({
          data: dto.members.map((item) => ({
            family_id: familyId,
            geofence_id: geofenceId,
            member_id: item.memberId,
            notify_on_enter: item.notifyOnEnter,
            notify_on_exit: item.notifyOnExit,
          })),
        });
      }
      const updated = await tx.geofence.findUniqueOrThrow({
        where: { id: geofenceId },
        select: geofenceSelect,
      });
      return { outcome: 'updated' as const, geofence: updated };
    });
  }

  async listEvents(
    familyId: string,
    query: GeofenceEventQueryDto,
    cursor?: GeofenceEventCursor,
  ) {
    const cursorWhere = cursor
      ? {
          OR: [
            { detected_at: { lt: cursor.detectedAt } },
            { detected_at: cursor.detectedAt, id: { lt: cursor.id } },
          ],
        }
      : {};
    return this.prisma.geofenceEvent.findMany({
      where: {
        family_id: familyId,
        Family: { status: 'active' },
        FamilyMember: {
          status: 'accepted',
          locationSharingEnabled: true,
          profile: { UserSetting: { locationSharingEnabled: true } },
        },
        ...(query.geofenceId ? { geofence_id: query.geofenceId } : {}),
        ...(query.memberId ? { member_id: query.memberId } : {}),
        ...(query.eventType ? { event_type: query.eventType } : {}),
        ...cursorWhere,
      },
      select: {
        id: true,
        event_type: true,
        latitude: true,
        longitude: true,
        detected_at: true,
        created_at: true,
        Geofence: { select: { id: true, name: true } },
        FamilyMember: {
          select: {
            id: true,
            displayName: true,
            profile: { select: { fullName: true, avatarUrl: true } },
          },
        },
      },
      orderBy: [{ detected_at: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  evaluateCommittedLocation(location: CommittedLocationForGeofences) {
    return this.withTransactionRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const assignments = await tx.geofenceMember.findMany({
            where: {
              FamilyMember: {
                userId: location.userId,
                status: 'accepted',
                locationSharingEnabled: true,
                family: { status: 'active' },
                profile: {
                  UserSetting: { locationSharingEnabled: true },
                },
              },
              Geofence: { is_active: true, Family: { status: 'active' } },
            },
            select: {
              family_id: true,
              member_id: true,
              notify_on_enter: true,
              notify_on_exit: true,
              Geofence: {
                select: {
                  id: true,
                  name: true,
                  center_latitude: true,
                  center_longitude: true,
                  radius_meters: true,
                },
              },
            },
            orderBy: [{ geofence_id: 'asc' }, { member_id: 'asc' }],
          });

          const transitions: Array<{
            id: string;
            familyId: string;
            geofenceId: string;
            geofenceName: string;
            memberId: string;
            eventType: 'enter' | 'exit';
            latitude: number;
            longitude: number;
            occurredAt: Date;
            recipientUserIds: string[];
          }> = [];

          for (const assignment of assignments) {
            const lockKey = `${assignment.Geofence.id}:${assignment.member_id}`;
            await tx.$executeRaw(
              Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
            );
            const state = await tx.geofenceState.findUnique({
              where: {
                geofence_id_member_id: {
                  geofence_id: assignment.Geofence.id,
                  member_id: assignment.member_id,
                },
              },
            });
            const isInside = isPointInsideCircularGeofence(
              location.latitude,
              location.longitude,
              Number(assignment.Geofence.center_latitude),
              Number(assignment.Geofence.center_longitude),
              assignment.Geofence.radius_meters,
            );
            const decision = decideGeofenceTransition(
              state
                ? {
                    isInside: state.is_inside,
                    lastLocationId: state.last_location_id,
                    lastRecordedAt: state.last_recorded_at,
                  }
                : null,
              isInside,
              location.id,
              location.recordedAt,
            );
            if (decision === 'stale') continue;

            if (!state) {
              await tx.geofenceState.create({
                data: {
                  family_id: assignment.family_id,
                  geofence_id: assignment.Geofence.id,
                  member_id: assignment.member_id,
                  is_inside: isInside,
                  last_location_id: location.id,
                  last_recorded_at: location.recordedAt,
                },
              });
              continue;
            }

            await tx.geofenceState.update({
              where: { id: state.id },
              data: {
                is_inside: isInside,
                last_location_id: location.id,
                last_recorded_at: location.recordedAt,
                updated_at: new Date(),
              },
            });
            if (decision === 'inside' || decision === 'outside') continue;

            const eventType =
              decision === 'enter' ? ('enter' as const) : ('exit' as const);
            const event = await tx.geofenceEvent.create({
              data: {
                family_id: assignment.family_id,
                geofence_id: assignment.Geofence.id,
                member_id: assignment.member_id,
                location_id: location.id,
                event_type: eventType,
                latitude: location.latitude,
                longitude: location.longitude,
                detected_at: location.recordedAt,
              },
              select: { id: true, detected_at: true },
            });

            const deliveryEnabled = isInside
              ? assignment.notify_on_enter
              : assignment.notify_on_exit;
            const recipients = deliveryEnabled
              ? await tx.familyMember.findMany({
                  where: {
                    familyId: assignment.family_id,
                    status: 'accepted',
                    locationSharingEnabled: true,
                    family: { status: 'active' },
                  },
                  select: { userId: true },
                })
              : [];
            transitions.push({
              id: event.id,
              familyId: assignment.family_id,
              geofenceId: assignment.Geofence.id,
              geofenceName: assignment.Geofence.name,
              memberId: assignment.member_id,
              eventType,
              latitude: location.latitude,
              longitude: location.longitude,
              occurredAt: event.detected_at,
              recipientUserIds: [
                ...new Set(recipients.map((item) => item.userId)),
              ],
            });
          }
          return transitions;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async findInvalidMemberIds(
    tx: Prisma.TransactionClient,
    familyId: string,
    memberIds: string[],
  ) {
    if (memberIds.length === 0) return [];
    const valid = await tx.familyMember.findMany({
      where: { id: { in: memberIds }, familyId, status: 'accepted' },
      select: { id: true },
    });
    const validIds = new Set(valid.map((item) => item.id));
    return memberIds.filter((id) => !validIds.has(id));
  }

  private async withTransactionRetry<T>(work: () => Promise<T>): Promise<T> {
    for (
      let attempt = 1;
      attempt <= GEOFENCE_TRANSACTION_RETRY_LIMIT;
      attempt++
    ) {
      try {
        return await work();
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';
        if (!retryable || attempt === GEOFENCE_TRANSACTION_RETRY_LIMIT)
          throw error;
      }
    }
    throw new Error('Unreachable geofence transaction retry state');
  }
}
