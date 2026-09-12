import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ACTIVE_FAMILY_STATUS,
  ARCHIVED_FAMILY_STATUS,
} from './families.constants';
import {
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyPaginationDto,
  UpdateFamilyDto,
  UpdateFamilyMemberDto,
} from './dto/family.dto';

const familySelect = {
  id: true,
  familyName: true,
  ownerUserId: true,
  avatarUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const memberSelect = {
  id: true,
  familyId: true,
  userId: true,
  role: true,
  familyLabel: true,
  displayName: true,
  status: true,
  locationSharingEnabled: true,
  invitedAt: true,
  acceptedAt: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
  profile: {
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
    },
  },
} as const;

@Injectable()
export class FamiliesRepository {
  constructor(private readonly prisma: PrismaService) {}

  createFamilyWithOwner(actorUserId: string, dto: CreateFamilyDto) {
    return this.prisma.$transaction(async (tx) => {
      const family = await tx.family.create({
        data: {
          familyName: dto.familyName,
          avatarUrl: dto.avatarUrl,
          ownerUserId: actorUserId,
          status: ACTIVE_FAMILY_STATUS,
        },
        select: familySelect,
      });

      const membership = await tx.familyMember.create({
        data: {
          familyId: family.id,
          userId: actorUserId,
          role: 'manager',
          familyLabel: dto.familyLabel,
          displayName: dto.displayName,
          status: 'accepted',
          acceptedAt: new Date(),
        },
        select: memberSelect,
      });

      return { family, membership };
    });
  }

  async listFamilies(userId: string, pagination: FamilyPaginationDto) {
    const where = {
      userId,
      status: 'accepted',
      family: { status: ACTIVE_FAMILY_STATUS },
    } satisfies Prisma.FamilyMemberWhereInput;
    const [memberships, total] = await Promise.all([
      this.prisma.familyMember.findMany({
        where,
        select: {
          role: true,
          familyLabel: true,
          family: { select: familySelect },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.familyMember.count({ where }),
    ]);
    return { memberships, total };
  }

  findAccessMembership(userId: string, familyId: string) {
    return this.prisma.familyMember.findFirst({
      where: {
        userId,
        familyId,
        status: 'accepted',
        family: { status: ACTIVE_FAMILY_STATUS },
      },
      select: {
        id: true,
        userId: true,
        familyId: true,
        role: true,
        familyLabel: true,
        family: { select: familySelect },
      },
    });
  }

  updateFamily(familyId: string, dto: UpdateFamilyDto) {
    return this.prisma.family.update({
      where: { id: familyId },
      data: {
        familyName: dto.familyName,
        avatarUrl: dto.avatarUrl,
        updatedAt: new Date(),
      },
      select: familySelect,
    });
  }

  archiveFamily(familyId: string) {
    return this.prisma.family.update({
      where: { id: familyId },
      data: { status: ARCHIVED_FAMILY_STATUS, updatedAt: new Date() },
      select: { id: true },
    });
  }

  async listMembers(familyId: string, pagination: FamilyPaginationDto) {
    const where = {
      familyId,
      status: 'accepted',
    } satisfies Prisma.FamilyMemberWhereInput;
    const [members, total] = await Promise.all([
      this.prisma.familyMember.findMany({
        where,
        select: memberSelect,
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.familyMember.count({ where }),
    ]);
    return { members, total };
  }

  findMember(familyId: string, memberId: string) {
    return this.prisma.familyMember.findFirst({
      where: { id: memberId, familyId },
      select: memberSelect,
    });
  }

  findProfileByInvitationTarget(dto: CreateInvitationDto) {
    return this.prisma.profile.findFirst({
      where: dto.email
        ? { email: { equals: dto.email, mode: 'insensitive' } }
        : { phoneNumber: dto.phoneNumber },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        accountStatus: true,
      },
    });
  }

  findMembershipForUser(familyId: string, userId: string) {
    return this.prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId } },
      select: memberSelect,
    });
  }

  createInvitation(
    familyId: string,
    targetUserId: string,
    actorUserId: string,
    dto: CreateInvitationDto,
  ) {
    return this.prisma.familyMember.create({
      data: {
        familyId,
        userId: targetUserId,
        invitedByUserId: actorUserId,
        role: dto.role,
        familyLabel: dto.familyLabel,
        displayName: dto.displayName,
        status: 'pending',
        invitedAt: new Date(),
      },
      select: memberSelect,
    });
  }

  renewInvitation(
    membershipId: string,
    actorUserId: string,
    dto: CreateInvitationDto,
  ) {
    return this.prisma.familyMember.update({
      where: { id: membershipId },
      data: {
        invitedByUserId: actorUserId,
        role: dto.role,
        familyLabel: dto.familyLabel,
        displayName: dto.displayName,
        status: 'pending',
        invitedAt: new Date(),
        acceptedAt: null,
        removedAt: null,
        updatedAt: new Date(),
      },
      select: memberSelect,
    });
  }

  async listPendingInvitations(
    userId: string,
    pagination: FamilyPaginationDto,
  ) {
    const where = {
      userId,
      status: 'pending',
      family: { status: ACTIVE_FAMILY_STATUS },
    } satisfies Prisma.FamilyMemberWhereInput;
    const [invitations, total] = await Promise.all([
      this.prisma.familyMember.findMany({
        where,
        select: {
          id: true,
          role: true,
          familyLabel: true,
          displayName: true,
          invitedAt: true,
          family: { select: familySelect },
          inviter: {
            select: { id: true, fullName: true, avatarUrl: true },
          },
        },
        orderBy: { invitedAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.familyMember.count({ where }),
    ]);
    return { invitations, total };
  }

  transitionInvitation(
    invitationId: string,
    actorUserId: string,
    nextStatus: 'accepted' | 'rejected',
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const invitation = await tx.familyMember.findUnique({
          where: { id: invitationId },
          select: {
            id: true,
            userId: true,
            status: true,
            familyId: true,
            family: { select: { status: true } },
          },
        });
        if (!invitation) return { outcome: 'not_found' as const };
        if (invitation.userId !== actorUserId) {
          return { outcome: 'forbidden' as const };
        }
        if (
          invitation.status !== 'pending' ||
          invitation.family.status !== ACTIVE_FAMILY_STATUS
        ) {
          return { outcome: 'invalid_state' as const };
        }

        const membership = await tx.familyMember.update({
          where: { id: invitationId },
          data: {
            status: nextStatus,
            acceptedAt: nextStatus === 'accepted' ? new Date() : null,
            updatedAt: new Date(),
          },
          select: memberSelect,
        });
        return { outcome: 'updated' as const, membership };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  updateMemberWithManagerInvariant(
    familyId: string,
    memberId: string,
    dto: UpdateFamilyMemberDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.familyMember.findFirst({
          where: { id: memberId, familyId },
          select: { id: true, role: true, status: true },
        });
        if (!target) return { outcome: 'not_found' as const };

        if (
          dto.role &&
          target.role === 'manager' &&
          dto.role !== 'manager' &&
          target.status === 'accepted'
        ) {
          const managerCount = await tx.familyMember.count({
            where: {
              familyId,
              role: 'manager',
              status: 'accepted',
            },
          });
          if (managerCount <= 1) return { outcome: 'last_manager' as const };
        }

        const member = await tx.familyMember.update({
          where: { id: memberId },
          data: {
            role: dto.role,
            familyLabel: dto.familyLabel,
            displayName: dto.displayName,
            locationSharingEnabled: dto.locationSharingEnabled,
            updatedAt: new Date(),
          },
          select: memberSelect,
        });
        return { outcome: 'updated' as const, member };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  removeMemberWithManagerInvariant(familyId: string, memberId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.familyMember.findFirst({
          where: { id: memberId, familyId },
          select: { id: true, role: true, status: true },
        });
        if (!target) return { outcome: 'not_found' as const };

        if (target.role === 'manager' && target.status === 'accepted') {
          const managerCount = await tx.familyMember.count({
            where: {
              familyId,
              role: 'manager',
              status: 'accepted',
            },
          });
          if (managerCount <= 1) return { outcome: 'last_manager' as const };
        }

        await tx.familyMember.update({
          where: { id: memberId },
          data: {
            status: 'removed',
            removedAt: new Date(),
            updatedAt: new Date(),
          },
          select: { id: true },
        });
        return { outcome: 'removed' as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
