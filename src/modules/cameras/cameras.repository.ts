import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  CameraCursor,
  CameraListQueryDto,
  CreateCameraDto,
  UpdateCameraDto,
} from './dto/camera.dto';

export const internalCameraSelect = {
  id: true,
  familyId: true,
  name: true,
  locationLabel: true,
  connectionUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CamerasRepository {
  constructor(private readonly prisma: PrismaService) {}

  getFamilyAccess(userId: string, familyId: string) {
    return this.prisma.familyMember.findFirst({
      where: {
        userId,
        familyId,
        status: 'accepted',
        family: { status: 'active' },
      },
      select: { id: true, role: true },
    });
  }

  async create(userId: string, familyId: string, dto: CreateCameraDto) {
    return this.prisma.$transaction(async (tx) => {
      const access = await tx.familyMember.findFirst({
        where: {
          userId,
          familyId,
          status: 'accepted',
          role: 'manager',
          family: { status: 'active' },
        },
        select: { id: true },
      });
      if (!access) return { outcome: 'forbidden' as const };
      const camera = await tx.camera.create({
        data: {
          familyId,
          creatorUserId: userId,
          name: dto.name,
          locationLabel: dto.locationLabel,
          connectionUrl: dto.connectionUrl,
          fallDetectionEnabled: false,
          status: 'active',
        },
        select: internalCameraSelect,
      });
      return { outcome: 'created' as const, camera };
    });
  }

  list(familyId: string, query: CameraListQueryDto, cursor?: CameraCursor) {
    return this.prisma.camera.findMany({
      where: {
        familyId,
        ...(query.active === 'all'
          ? {}
          : { status: query.active === 'true' ? 'active' : 'inactive' }),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: internalCameraSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
  }

  find(familyId: string, cameraId: string) {
    return this.prisma.camera.findFirst({
      where: { id: cameraId, familyId },
      select: internalCameraSelect,
    });
  }

  async update(
    userId: string,
    familyId: string,
    cameraId: string,
    dto: UpdateCameraDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`camera:${cameraId}`}, 0))`,
      );
      const access = await tx.familyMember.findFirst({
        where: {
          userId,
          familyId,
          status: 'accepted',
          role: 'manager',
          family: { status: 'active' },
        },
        select: { id: true },
      });
      if (!access) return { outcome: 'forbidden' as const };
      const existing = await tx.camera.findFirst({
        where: { id: cameraId, familyId },
        select: { id: true, status: true },
      });
      if (!existing) return { outcome: 'not_found' as const };
      if (
        dto.isActive === false &&
        existing.status === 'inactive' &&
        Object.keys(dto).length === 1
      ) {
        const camera = await tx.camera.findUniqueOrThrow({
          where: { id: cameraId },
          select: internalCameraSelect,
        });
        return { outcome: 'unchanged' as const, camera };
      }
      const camera = await tx.camera.update({
        where: { id: cameraId },
        data: {
          name: dto.name,
          locationLabel: dto.locationLabel,
          connectionUrl: dto.connectionUrl,
          ...(dto.isActive === undefined
            ? {}
            : { status: dto.isActive ? 'active' : 'inactive' }),
          updatedAt: new Date(),
        },
        select: internalCameraSelect,
      });
      return { outcome: 'updated' as const, camera };
    });
  }

  deactivate(userId: string, familyId: string, cameraId: string) {
    return this.update(userId, familyId, cameraId, { isActive: false });
  }
}
