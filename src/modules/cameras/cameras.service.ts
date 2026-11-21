import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app.error';
import { isMinor } from '../../common/utils/age.util';
import {
  CameraCursor,
  CameraListQueryDto,
  CreateCameraDto,
  UpdateCameraDto,
} from './dto/camera.dto';
import { CamerasRepository } from './cameras.repository';

const cursorSchema = z
  .tuple([z.iso.datetime({ offset: true }), z.string().uuid()])
  .transform(([createdAt, id]) => ({ createdAt: new Date(createdAt), id }));

@Injectable()
export class CamerasService {
  constructor(private readonly repository: CamerasRepository) {}

  async create(userId: string, familyId: string, dto: CreateCameraDto) {
    const result = await this.repository.create(userId, familyId, dto);
    if (result.outcome === 'forbidden') this.denied();
    return this.mapCamera(result.camera);
  }

  async list(userId: string, familyId: string, query: CameraListQueryDto) {
    const access = await this.requireReadAccess(userId, familyId);
    if (!this.isCameraAdmin(access, userId) && query.active !== 'true') {
      this.denied();
    }
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const rows = await this.repository.list(familyId, query, cursor);
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      data: pageRows.map((row) => this.mapCamera(row)),
      pagination: {
        limit: query.limit,
        nextCursor:
          hasMore && last ? this.encodeCursor(last.createdAt, last.id) : null,
        hasMore,
      },
    };
  }

  async detail(userId: string, familyId: string, cameraId: string) {
    const access = await this.requireReadAccess(userId, familyId);
    const camera = await this.repository.find(familyId, cameraId);
    if (
      !camera ||
      (!this.isCameraAdmin(access, userId) && camera.status !== 'active')
    ) {
      this.notFound();
    }
    return this.mapCamera(camera);
  }

  async update(
    userId: string,
    familyId: string,
    cameraId: string,
    dto: UpdateCameraDto,
  ) {
    const result = await this.repository.update(
      userId,
      familyId,
      cameraId,
      dto,
    );
    if (result.outcome === 'forbidden') this.denied();
    if (result.outcome === 'not_found') this.notFound();
    return this.mapCamera(result.camera);
  }

  async deactivate(userId: string, familyId: string, cameraId: string) {
    const result = await this.repository.deactivate(userId, familyId, cameraId);
    if (result.outcome === 'forbidden') this.denied();
    if (result.outcome === 'not_found') this.notFound();
  }

  private isCameraAdmin(
    access: {
      canManageCare: boolean;
      isHired: boolean;
      family: { ownerUserId: string };
    },
    userId: string,
  ) {
    return (
      (access.canManageCare && !access.isHired) ||
      access.family.ownerUserId === userId
    );
  }

  private async requireReadAccess(userId: string, familyId: string) {
    const access = await this.repository.getFamilyAccess(userId, familyId);
    if (!access || access.isHired || isMinor(access.profile?.dateOfBirth)) {
      this.denied();
    }
    return access;
  }

  private mapCamera(row: any) {
    return {
      id: row.id,
      familyId: row.familyId,
      name: row.name,
      locationLabel: row.locationLabel,
      isActive: row.status === 'active',
      connectivityStatus: 'unknown' as const,
      hasConnectionConfiguration: Boolean(row.connectionUrl),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private encodeCursor(createdAt: Date, id: string) {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
      'base64url',
    );
  }

  private decodeCursor(value: string): CameraCursor {
    try {
      const parsed = cursorSchema.safeParse(
        Buffer.from(value, 'base64url').toString('utf8').split('|'),
      );
      if (!parsed.success) throw new Error('invalid cursor');
      return parsed.data;
    } catch {
      throw new ValidationError(
        [{ path: ['cursor'], message: 'Invalid camera cursor' }],
        'Invalid cursor',
      );
    }
  }

  private denied(): never {
    throw new ForbiddenError(
      'Camera access denied',
      ErrorCode.CAMERA_ACCESS_DENIED,
    );
  }

  private notFound(): never {
    throw new NotFoundError('Camera not found', ErrorCode.CAMERA_NOT_FOUND);
  }
}
