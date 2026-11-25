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
  HiredScopeActor,
  hiredScopeMemberIds,
} from '../families/care-scope.util';
import { FamilyAccessService } from '../families/family-access.service';
import {
  CreateGeofenceDto,
  GeofenceEventCursor,
  GeofenceEventQueryDto,
  GeofenceListQueryDto,
  ReplaceGeofenceMembersDto,
  UpdateGeofenceDto,
} from './dto/geofence.dto';
import { GeofencesRepository } from './geofences.repository';

type GeofenceRow = NonNullable<
  Awaited<ReturnType<GeofencesRepository['findOne']>>
>;

const cursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([detectedAt, id]) => ({ detectedAt: new Date(detectedAt), id }));

@Injectable()
export class GeofencesService {
  constructor(
    private readonly repository: GeofencesRepository,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  async create(userId: string, familyId: string, dto: CreateGeofenceDto) {
    await this.familyAccess.requireCareManager(userId, familyId);
    await this.assertCanManageMembers(
      userId,
      familyId,
      dto.members.map((item) => item.memberId),
    );
    const result = await this.repository.createWithMembers(
      familyId,
      userId,
      dto,
    );
    if (result.outcome === 'invalid_members')
      this.invalidMembers(result.invalidMemberIds);
    return this.mapGeofence(result.geofence);
  }

  async list(userId: string, familyId: string, query: GeofenceListQueryDto) {
    const actor = await this.familyAccess.requireAcceptedMember(
      userId,
      familyId,
    );
    const scope = hiredScopeMemberIds(actor);
    const { rows, total } = await this.repository.list(
      familyId,
      query,
      scope ? [...scope] : null,
    );
    return {
      data: rows.map((row) => this.mapGeofence(row)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getOne(userId: string, familyId: string, geofenceId: string) {
    const actor = await this.familyAccess.requireAcceptedMember(
      userId,
      familyId,
    );
    const row = await this.repository.findOne(familyId, geofenceId);
    if (!row) this.notFound();
    const scope = hiredScopeMemberIds(actor);
    if (
      scope &&
      !row.GeofenceMember.some((assignment) => scope.has(assignment.member_id))
    ) {
      this.notFound();
    }
    return this.mapGeofence(row);
  }

  async update(
    userId: string,
    familyId: string,
    geofenceId: string,
    dto: UpdateGeofenceDto,
  ) {
    const actor = await this.familyAccess.requireCareManager(userId, familyId);
    await this.assertGeofenceInScope(actor, familyId, geofenceId);
    const row = await this.repository.update(familyId, geofenceId, dto);
    if (!row) this.notFound();
    return this.mapGeofence(row);
  }

  async deactivate(userId: string, familyId: string, geofenceId: string) {
    const actor = await this.familyAccess.requireCareManager(userId, familyId);
    await this.assertGeofenceInScope(actor, familyId, geofenceId);
    const result = await this.repository.deactivate(familyId, geofenceId);
    if (result.count === 0) this.notFound();
  }

  async replaceMembers(
    userId: string,
    familyId: string,
    geofenceId: string,
    dto: ReplaceGeofenceMembersDto,
  ) {
    const actor = await this.familyAccess.requireCareManager(userId, familyId);
    await this.assertGeofenceInScope(actor, familyId, geofenceId);
    await this.assertCanManageMembers(
      userId,
      familyId,
      dto.members.map((item) => item.memberId),
    );
    const result = await this.repository.replaceMembers(
      familyId,
      geofenceId,
      dto,
    );
    if (result.outcome === 'not_found') this.notFound();
    if (result.outcome === 'invalid_members')
      this.invalidMembers(result.invalidMemberIds);
    return this.mapGeofence(result.geofence);
  }

  async listEvents(
    userId: string,
    familyId: string,
    query: GeofenceEventQueryDto,
  ) {
    const actor = await this.familyAccess.requireAcceptedMember(
      userId,
      familyId,
    );
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const scope = hiredScopeMemberIds(actor);
    const rows = await this.repository.listEvents(
      familyId,
      query,
      cursor,
      scope ? [...scope] : null,
    );
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) => ({
        id: row.id,
        transition: row.event_type,
        geofence: row.Geofence,
        member: {
          id: row.FamilyMember.id,
          displayName:
            row.FamilyMember.displayName ?? row.FamilyMember.profile.fullName,
          avatarUrl: row.FamilyMember.profile.avatarUrl,
        },
        location:
          row.latitude === null || row.longitude === null
            ? null
            : {
                latitude: Number(row.latitude),
                longitude: Number(row.longitude),
              },
        occurredAt: row.detected_at,
        createdAt: row.created_at,
      })),
      pagination: {
        limit: query.limit,
        nextCursor: hasMore && last ? this.encodeCursor(last) : null,
        hasMore,
      },
    };
  }

  /** A hired caregiver may only edit geofences whose members are all in scope. */
  private async assertGeofenceInScope(
    actor: HiredScopeActor,
    familyId: string,
    geofenceId: string,
  ) {
    const scope = hiredScopeMemberIds(actor);
    if (!scope) return;
    const row = await this.repository.findOne(familyId, geofenceId);
    if (!row) this.notFound();
    if (
      !row.GeofenceMember.every((assignment) => scope.has(assignment.member_id))
    ) {
      throw new ForbiddenError(
        'Vùng an toàn có thành viên ngoài phạm vi chăm sóc của bạn',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
  }

  private async assertCanManageMembers(
    userId: string,
    familyId: string,
    memberIds: string[],
  ) {
    if (memberIds.length === 0) return;
    const invalidIds: string[] = [];
    for (const memberId of memberIds) {
      const allowed = await this.familyAccess.canManage(
        userId,
        memberId,
        familyId,
      );
      if (!allowed) invalidIds.push(memberId);
    }
    if (invalidIds.length > 0) {
      this.invalidMembers(invalidIds);
    }
  }

  private mapGeofence(row: GeofenceRow) {
    return {
      id: row.id,
      familyId: row.family_id,
      name: row.name,
      address: row.address,
      centerLatitude: Number(row.center_latitude),
      centerLongitude: Number(row.center_longitude),
      radiusMeters: row.radius_meters,
      icon: row.icon ?? null,
      isActive: row.is_active,
      members: row.GeofenceMember.map((assignment) => ({
        memberId: assignment.member_id,
        userId: assignment.FamilyMember.userId,
        displayName:
          assignment.FamilyMember.displayName ??
          assignment.FamilyMember.profile.fullName,
        avatarUrl: assignment.FamilyMember.profile.avatarUrl,
        notifyOnEnter: assignment.notify_on_enter,
        notifyOnExit: assignment.notify_on_exit,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private encodeCursor(row: { id: string; detected_at: Date }) {
    return Buffer.from(
      `${row.detected_at.toISOString()}|${row.id}`,
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): GeofenceEventCursor {
    try {
      const parsed = cursorSchema.safeParse(
        Buffer.from(cursor, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Invalid geofence event cursor' }],
        'Invalid cursor',
      );
    }
  }

  private notFound(): never {
    throw new NotFoundError('Geofence not found', ErrorCode.GEOFENCE_NOT_FOUND);
  }

  private invalidMembers(memberIds: string[]): never {
    throw new BusinessRuleError(
      ErrorCode.GEOFENCE_MEMBER_INVALID,
      'All assigned members must be accepted members of this family',
      { memberIds },
    );
  }
}
