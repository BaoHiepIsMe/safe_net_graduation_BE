import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
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
    await this.familyAccess.requireManager(userId, familyId);
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
    await this.familyAccess.requireAcceptedMember(userId, familyId);
    const { rows, total } = await this.repository.list(familyId, query);
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
    await this.familyAccess.requireAcceptedMember(userId, familyId);
    const row = await this.repository.findOne(familyId, geofenceId);
    if (!row) this.notFound();
    return this.mapGeofence(row);
  }

  async update(
    userId: string,
    familyId: string,
    geofenceId: string,
    dto: UpdateGeofenceDto,
  ) {
    await this.familyAccess.requireManager(userId, familyId);
    const row = await this.repository.update(familyId, geofenceId, dto);
    if (!row) this.notFound();
    return this.mapGeofence(row);
  }

  async deactivate(userId: string, familyId: string, geofenceId: string) {
    await this.familyAccess.requireManager(userId, familyId);
    const result = await this.repository.deactivate(familyId, geofenceId);
    if (result.count === 0) this.notFound();
  }

  async replaceMembers(
    userId: string,
    familyId: string,
    geofenceId: string,
    dto: ReplaceGeofenceMembersDto,
  ) {
    await this.familyAccess.requireManager(userId, familyId);
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
    await this.familyAccess.requireAcceptedMember(userId, familyId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.listEvents(familyId, query, cursor);
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

  private mapGeofence(row: any) {
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
      members: row.GeofenceMember.map((assignment: any) => ({
        memberId: assignment.member_id,
        userId: assignment.FamilyMember.userId,
        role: assignment.FamilyMember.role,
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
