import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  isEffectiveCareRecipient,
  isMinor,
  isSenior,
} from '../../common/utils/age.util';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ApproveJoinRequestDto,
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyPaginationDto,
  JoinFamilyDto,
  UpdateFamilyDto,
} from './dto/family.dto';
import {
  ACTIVE_FAMILY_STATUS,
  ARCHIVED_FAMILY_STATUS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  invitationCutoff,
  inviteCodeExpiry,
} from './families.constants';

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
  familyLabel: true,
  displayName: true,
  status: true,
  canManageCare: true,
  careGrantedBy: true,
  isCareRecipient: true,
  careRecipientSetBy: true,
  isHired: true,
  locationSharingEnabled: true,
  invitedAt: true,
  acceptedAt: true,
  removedAt: true,
  createdAt: true,
  updatedAt: true,
  family: {
    select: familySelect,
  },
  careScopes: {
    select: { targetMemberId: true },
    orderBy: { targetMemberId: 'asc' as const },
  },
  profile: {
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      gender: true,
      dateOfBirth: true,
    },
  },
} as const;

const inviterSelect = { select: { id: true, fullName: true, avatarUrl: true } };

export interface ResolvedInvitationData {
  familyLabel: CreateInvitationDto['familyLabel'];
  displayName?: string | null;
  canManageCare: boolean;
  careGrantedBy: string | null;
  isCareRecipient: boolean;
  careRecipientSetBy: string | null;
  isHired: boolean;
  careScopeMemberIds: string[];
}

export interface ResolvedMemberUpdateData {
  familyLabel?: CreateInvitationDto['familyLabel'];
  displayName?: string | null;
  canManageCare?: boolean;
  careGrantedBy?: string | null;
  isCareRecipient?: boolean;
  careRecipientSetBy?: string | null;
  isHired?: boolean;
  careScopeMemberIds?: string[];
  locationSharingEnabled?: boolean;
}

const INVITE_CODE_ATTEMPTS = 5;

function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class FamiliesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async areValidCareScopeTargets(
    tx: Prisma.TransactionClient,
    familyId: string,
    targetMemberIds: string[],
    excludeMemberId?: string,
  ): Promise<boolean> {
    if (targetMemberIds.length === 0) return false;
    const uniqueIds = [...new Set(targetMemberIds)];
    if (excludeMemberId && uniqueIds.includes(excludeMemberId)) {
      return false;
    }
    const targets = await tx.familyMember.findMany({
      where: {
        id: { in: uniqueIds },
        familyId,
        status: 'accepted',
        family: { status: ACTIVE_FAMILY_STATUS },
      },
      select: {
        id: true,
        isCareRecipient: true,
        profile: { select: { dateOfBirth: true } },
      },
    });
    if (targets.length !== uniqueIds.length) return false;
    return targets.every((target) => isEffectiveCareRecipient(target));
  }

  createFamilyWithOwner(actorUserId: string, dto: CreateFamilyDto) {
    return this.prisma.$transaction(async (tx) => {
      const actorProfile = await tx.profile.findUnique({
        where: { id: actorUserId },
        select: { id: true, dateOfBirth: true },
      });
      if (!actorProfile?.dateOfBirth) {
        return { outcome: 'dob_required' as const };
      }
      if (isMinor(actorProfile.dateOfBirth)) {
        return { outcome: 'minor_forbidden' as const };
      }

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
          familyLabel: dto.familyLabel,
          displayName: dto.displayName,
          status: 'accepted',
          canManageCare: true,
          careGrantedBy: actorUserId,
          isCareRecipient: false,
          isHired: dto.familyLabel === 'caregiver',
          locationSharingEnabled: true,
          acceptedAt: new Date(),
        },
        select: memberSelect,
      });

      return { outcome: 'created' as const, family, membership };
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
          userId: true,
          familyLabel: true,
          canManageCare: true,
          isCareRecipient: true,
          isHired: true,
          careScopes: {
            select: { targetMemberId: true },
            orderBy: { targetMemberId: 'asc' },
          },
          profile: { select: { dateOfBirth: true } },
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
        familyLabel: true,
        displayName: true,
        status: true,
        canManageCare: true,
        careGrantedBy: true,
        isCareRecipient: true,
        careRecipientSetBy: true,
        isHired: true,
        locationSharingEnabled: true,
        careScopes: {
          select: { targetMemberId: true },
          orderBy: { targetMemberId: 'asc' },
        },
        profile: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            dateOfBirth: true,
            gender: true,
          },
        },
        family: { select: familySelect },
      },
    });
  }

  findMemberForAccess(memberId: string) {
    return this.prisma.familyMember.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        userId: true,
        familyId: true,
        familyLabel: true,
        displayName: true,
        status: true,
        canManageCare: true,
        isCareRecipient: true,
        isHired: true,
        locationSharingEnabled: true,
        careScopes: {
          select: { targetMemberId: true },
          orderBy: { targetMemberId: 'asc' },
        },
        profile: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            dateOfBirth: true,
            gender: true,
          },
        },
        family: { select: familySelect },
      },
    });
  }

  findAcceptedCareManagersInFamily(familyId: string) {
    return this.prisma.familyMember.findMany({
      where: {
        familyId,
        status: 'accepted',
        canManageCare: true,
        family: { status: ACTIVE_FAMILY_STATUS },
      },
      select: {
        id: true,
        userId: true,
        familyId: true,
        familyLabel: true,
        displayName: true,
        status: true,
        canManageCare: true,
        isCareRecipient: true,
        isHired: true,
        careScopes: {
          select: { targetMemberId: true },
          orderBy: { targetMemberId: 'asc' },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  listAcceptedFamilyMemberUserIds(familyId: string) {
    return this.prisma.familyMember
      .findMany({
        where: {
          familyId,
          status: 'accepted',
          family: { status: ACTIVE_FAMILY_STATUS },
        },
        select: { userId: true },
      })
      .then((rows) => rows.map((row) => row.userId));
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
        orderBy: [{ canManageCare: 'desc' }, { createdAt: 'asc' }],
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
        dateOfBirth: true,
      },
    });
  }

  findMembershipForUser(familyId: string, userId: string) {
    return this.prisma.familyMember.findUnique({
      where: { familyId_userId: { familyId, userId } },
      select: memberSelect,
    });
  }

  validateCareScopeMembers(
    familyId: string,
    targetMemberIds: string[],
    excludeMemberId?: string,
  ) {
    return this.areValidCareScopeTargets(
      this.prisma,
      familyId,
      targetMemberIds,
      excludeMemberId,
    );
  }

  createInvitation(
    familyId: string,
    targetUserId: string,
    actorUserId: string,
    dto: ResolvedInvitationData,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.familyMember.create({
        data: {
          familyId,
          userId: targetUserId,
          invitedByUserId: actorUserId,
          familyLabel: dto.familyLabel,
          displayName: dto.displayName,
          status: 'pending',
          canManageCare: dto.canManageCare,
          careGrantedBy: dto.careGrantedBy,
          isCareRecipient: dto.isCareRecipient,
          careRecipientSetBy: dto.careRecipientSetBy,
          isHired: dto.isHired,
          invitedAt: new Date(),
          ...(dto.isHired && dto.careScopeMemberIds.length > 0
            ? {
                careScopes: {
                  create: dto.careScopeMemberIds.map((targetMemberId) => ({
                    targetMemberId,
                  })),
                },
              }
            : {}),
        },
        select: memberSelect,
      });
      return created;
    });
  }

  renewInvitation(
    membershipId: string,
    actorUserId: string,
    dto: ResolvedInvitationData,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.familyMemberCareScope.deleteMany({
        where: { memberId: membershipId },
      });
      const updated = await tx.familyMember.update({
        where: { id: membershipId },
        data: {
          invitedByUserId: actorUserId,
          familyLabel: dto.familyLabel,
          displayName: dto.displayName,
          status: 'pending',
          canManageCare: dto.canManageCare,
          careGrantedBy: dto.careGrantedBy,
          isCareRecipient: dto.isCareRecipient,
          careRecipientSetBy: dto.careRecipientSetBy,
          isHired: dto.isHired,
          invitedAt: new Date(),
          acceptedAt: null,
          removedAt: null,
          updatedAt: new Date(),
          ...(dto.isHired && dto.careScopeMemberIds.length > 0
            ? {
                careScopes: {
                  create: dto.careScopeMemberIds.map((targetMemberId) => ({
                    targetMemberId,
                  })),
                },
              }
            : {}),
        },
        select: memberSelect,
      });
      return updated;
    });
  }

  async listPendingInvitations(
    userId: string,
    pagination: FamilyPaginationDto,
  ) {
    const where = {
      userId,
      status: 'pending',
      invitedAt: { gte: invitationCutoff(new Date()) },
      family: { status: ACTIVE_FAMILY_STATUS },
    } satisfies Prisma.FamilyMemberWhereInput;
    const [invitations, total] = await Promise.all([
      this.prisma.familyMember.findMany({
        where,
        select: {
          id: true,
          familyId: true,
          userId: true,
          familyLabel: true,
          displayName: true,
          canManageCare: true,
          careGrantedBy: true,
          isCareRecipient: true,
          careRecipientSetBy: true,
          isHired: true,
          invitedAt: true,
          careScopes: {
            select: { targetMemberId: true },
            orderBy: { targetMemberId: 'asc' },
          },
          profile: {
            select: { dateOfBirth: true },
          },
          family: {
            select: {
              ...familySelect,
              members: {
                where: { status: 'accepted', canManageCare: true },
                select: {
                  id: true,
                  userId: true,
                  familyLabel: true,
                  displayName: true,
                  isHired: true,
                  profile: {
                    select: { id: true, fullName: true, avatarUrl: true },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
          inviter: inviterSelect,
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
            invitedAt: true,
            invitedByUserId: true,
            familyId: true,
            familyLabel: true,
            canManageCare: true,
            careGrantedBy: true,
            isCareRecipient: true,
            careRecipientSetBy: true,
            isHired: true,
            profile: { select: { dateOfBirth: true } },
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
        if (nextStatus === 'accepted') {
          if (
            !invitation.invitedAt ||
            invitation.invitedAt < invitationCutoff(new Date())
          ) {
            return { outcome: 'expired' as const };
          }
          if (!invitation.profile?.dateOfBirth) {
            return { outcome: 'dob_required' as const };
          }
          const minor = isMinor(invitation.profile.dateOfBirth);
          const senior = isSenior(invitation.profile.dateOfBirth);
          const isHired = !minor && Boolean(invitation.isHired);
          const canManageCare = minor
            ? false
            : isHired
              ? true
              : Boolean(invitation.canManageCare);
          const careGrantedBy = canManageCare
            ? (invitation.careGrantedBy ?? invitation.invitedByUserId)
            : null;
          const isCareRecipient = minor
            ? false
            : invitation.careRecipientSetBy === null
              ? senior
              : Boolean(invitation.isCareRecipient);
          const careRecipientSetBy = isCareRecipient
            ? (invitation.careRecipientSetBy ?? invitation.invitedByUserId)
            : null;

          if (!isHired) {
            await tx.familyMemberCareScope.deleteMany({
              where: { memberId: invitationId },
            });
          }

          const membership = await tx.familyMember.update({
            where: { id: invitationId },
            data: {
              status: 'accepted',
              canManageCare,
              careGrantedBy,
              isCareRecipient,
              careRecipientSetBy,
              isHired,
              locationSharingEnabled: true,
              acceptedAt: new Date(),
              updatedAt: new Date(),
            },
            select: memberSelect,
          });
          return { outcome: 'updated' as const, membership };
        }

        await tx.familyMemberCareScope.deleteMany({
          where: { memberId: invitationId },
        });
        const membership = await tx.familyMember.update({
          where: { id: invitationId },
          data: {
            status: 'rejected',
            canManageCare: false,
            careGrantedBy: null,
            isCareRecipient: false,
            careRecipientSetBy: null,
            acceptedAt: null,
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
    dto: ResolvedMemberUpdateData,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const target = await tx.familyMember.findFirst({
          where: { id: memberId, familyId },
          select: {
            id: true,
            canManageCare: true,
            status: true,
          },
        });
        if (!target) return { outcome: 'not_found' as const };

        if (
          dto.canManageCare === false &&
          target.canManageCare &&
          target.status === 'accepted'
        ) {
          const managerCount = await tx.familyMember.count({
            where: {
              familyId,
              canManageCare: true,
              status: 'accepted',
            },
          });
          if (managerCount <= 1) return { outcome: 'last_manager' as const };
        }

        if (dto.careScopeMemberIds !== undefined) {
          if (dto.careScopeMemberIds.length > 0) {
            const validScopes = await this.areValidCareScopeTargets(
              tx,
              familyId,
              dto.careScopeMemberIds,
              memberId,
            );
            if (!validScopes) {
              return { outcome: 'invalid_care_scope' as const };
            }
          }
          await tx.familyMemberCareScope.deleteMany({
            where: { memberId },
          });
          if (dto.careScopeMemberIds.length > 0) {
            await tx.familyMemberCareScope.createMany({
              data: dto.careScopeMemberIds.map((targetMemberId) => ({
                memberId,
                targetMemberId,
              })),
              skipDuplicates: true,
            });
          }
        }

        const member = await tx.familyMember.update({
          where: { id: memberId },
          data: {
            familyLabel: dto.familyLabel,
            displayName: dto.displayName,
            canManageCare: dto.canManageCare,
            careGrantedBy: dto.careGrantedBy,
            isCareRecipient: dto.isCareRecipient,
            careRecipientSetBy: dto.careRecipientSetBy,
            isHired: dto.isHired,
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
          select: { id: true, canManageCare: true, status: true },
        });
        if (!target) return { outcome: 'not_found' as const };

        if (target.canManageCare && target.status === 'accepted') {
          const managerCount = await tx.familyMember.count({
            where: {
              familyId,
              canManageCare: true,
              status: 'accepted',
            },
          });
          if (managerCount <= 1) return { outcome: 'last_manager' as const };
        }

        await tx.familyMemberCareScope.deleteMany({
          where: {
            OR: [{ memberId }, { targetMemberId: memberId }],
          },
        });

        await tx.familyMember.update({
          where: { id: memberId },
          data: {
            status: 'removed',
            canManageCare: false,
            careGrantedBy: null,
            isCareRecipient: false,
            careRecipientSetBy: null,
            isHired: false,
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

  async listSentInvitations(familyId: string, pagination: FamilyPaginationDto) {
    const where = {
      familyId,
      status: 'pending',
    } satisfies Prisma.FamilyMemberWhereInput;
    const [invitations, total] = await Promise.all([
      this.prisma.familyMember.findMany({
        where,
        select: { ...memberSelect, inviter: inviterSelect },
        orderBy: { invitedAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.familyMember.count({ where }),
    ]);
    return { invitations, total };
  }

  /** Only a `pending` invitation of this family can be cancelled. */
  cancelInvitation(familyId: string, invitationId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const invitation = await tx.familyMember.findFirst({
          where: { id: invitationId, familyId },
          select: { id: true, status: true },
        });
        if (!invitation) return { outcome: 'not_found' as const };
        if (invitation.status !== 'pending') {
          return { outcome: 'invalid_state' as const };
        }
        await tx.familyMemberCareScope.deleteMany({
          where: { memberId: invitationId },
        });
        await tx.familyMember.update({
          where: { id: invitationId },
          data: {
            status: 'removed',
            canManageCare: false,
            careGrantedBy: null,
            isCareRecipient: false,
            careRecipientSetBy: null,
            isHired: false,
            removedAt: new Date(),
            updatedAt: new Date(),
          },
          select: { id: true },
        });
        return { outcome: 'cancelled' as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Resending restarts the 7-day window by resetting `invitedAt`. */
  resendInvitation(
    familyId: string,
    invitationId: string,
    actorUserId: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const invitation = await tx.familyMember.findFirst({
          where: { id: invitationId, familyId },
          select: { id: true, status: true },
        });
        if (!invitation) return { outcome: 'not_found' as const };
        if (invitation.status !== 'pending') {
          return { outcome: 'invalid_state' as const };
        }
        const member = await tx.familyMember.update({
          where: { id: invitationId },
          data: {
            invitedAt: new Date(),
            invitedByUserId: actorUserId,
            updatedAt: new Date(),
          },
          select: memberSelect,
        });
        return { outcome: 'resent' as const, member };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Returns the live code, creating one only if there is none. The conditional
   * updateMany makes concurrent callers agree on a single code.
   */
  async getOrCreateInviteCode(familyId: string, now = new Date()) {
    const read = () =>
      this.prisma.family.findUnique({
        where: { id: familyId },
        select: { inviteCode: true, inviteCodeExpiresAt: true },
      });
    const live = (f: Awaited<ReturnType<typeof read>>) =>
      f?.inviteCode && f.inviteCodeExpiresAt && f.inviteCodeExpiresAt > now
        ? { code: f.inviteCode, expiresAt: f.inviteCodeExpiresAt }
        : null;

    const current = await read();
    const existing = live(current);
    if (existing) return existing;

    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const code = generateInviteCode();
      const expiresAt = inviteCodeExpiry(now);
      try {
        const { count } = await this.prisma.family.updateMany({
          where: {
            id: familyId,
            OR: [
              { inviteCode: null },
              { inviteCodeExpiresAt: null },
              { inviteCodeExpiresAt: { lte: now } },
            ],
          },
          data: { inviteCode: code, inviteCodeExpiresAt: expiresAt },
        });
        if (count === 1) return { code, expiresAt };
        const winner = live(await read());
        if (winner) return winner;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new Error('Không thể tạo mã mời duy nhất');
  }

  /** Always replaces the code; the old one stops working immediately. */
  async regenerateInviteCode(familyId: string, now = new Date()) {
    const current = await this.prisma.family.findUnique({
      where: { id: familyId },
      select: { inviteCode: true },
    });
    for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
      const code = generateInviteCode();
      if (code === current?.inviteCode) continue;
      const expiresAt = inviteCodeExpiry(now);
      try {
        await this.prisma.family.update({
          where: { id: familyId },
          data: { inviteCode: code, inviteCodeExpiresAt: expiresAt },
          select: { id: true },
        });
        return { code, expiresAt };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new Error('Không thể tạo mã mời duy nhất');
  }

  async findJoinPreviewByCode(code: string, now = new Date()) {
    const family = await this.prisma.family.findFirst({
      where: {
        inviteCode: code,
        inviteCodeExpiresAt: { gt: now },
        status: ACTIVE_FAMILY_STATUS,
      },
      select: {
        id: true,
        familyName: true,
        avatarUrl: true,
        ownerUserId: true,
        owner: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
          },
        },
        members: {
          where: { status: 'accepted' },
          select: {
            userId: true,
            displayName: true,
          },
        },
      },
    });
    if (!family) return null;

    const ownerMembership = family.members.find(
      (member) => member.userId === family.ownerUserId,
    );
    return {
      familyId: family.id,
      familyName: family.familyName,
      avatarUrl: family.avatarUrl,
      memberCount: family.members.length,
      owner: {
        userId: family.ownerUserId,
        fullName: family.owner.fullName,
        displayName: ownerMembership?.displayName ?? null,
        avatarUrl: family.owner.avatarUrl,
      },
    };
  }

  /**
   * Requests to join by a live invite code (`status = 'requested'`).
   * Idempotent if an unexpired join request already exists for `(family, user)`.
   */
  joinByInviteCode(userId: string, code: string, dto: JoinFamilyDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const actorProfile = await tx.profile.findUnique({
          where: { id: userId },
          select: { id: true, dateOfBirth: true },
        });
        if (!actorProfile?.dateOfBirth) {
          return { outcome: 'dob_required' as const };
        }

        const family = await tx.family.findFirst({
          where: {
            inviteCode: code,
            inviteCodeExpiresAt: { gt: now },
            status: ACTIVE_FAMILY_STATUS,
          },
          select: familySelect,
        });
        if (!family) return { outcome: 'invalid_code' as const };

        const existing = await tx.familyMember.findUnique({
          where: { familyId_userId: { familyId: family.id, userId } },
          select: memberSelect,
        });
        if (existing?.status === 'accepted') {
          return { outcome: 'already_member' as const };
        }
        if (
          existing?.status === 'requested' &&
          existing.invitedAt &&
          existing.invitedAt >= invitationCutoff(now)
        ) {
          return {
            outcome: 'already_requested' as const,
            family,
            membership: existing,
            adminUserIds: [] as string[],
          };
        }

        if (existing) {
          await tx.familyMemberCareScope.deleteMany({
            where: { memberId: existing.id },
          });
        }

        const data = {
          familyLabel: dto.familyLabel,
          displayName: dto.displayName ?? null,
          status: 'requested',
          invitedByUserId: null,
          invitedAt: now,
          acceptedAt: null,
          removedAt: null,
          canManageCare: false,
          careGrantedBy: null,
          isCareRecipient: false,
          careRecipientSetBy: null,
          isHired: dto.familyLabel === 'caregiver',
          locationSharingEnabled: true,
        };
        const membership = existing
          ? await tx.familyMember.update({
              where: { id: existing.id },
              data: { ...data, updatedAt: now },
              select: memberSelect,
            })
          : await tx.familyMember.create({
              data: { ...data, familyId: family.id, userId },
              select: memberSelect,
            });

        const admins = await tx.familyMember.findMany({
          where: {
            familyId: family.id,
            status: 'accepted',
            OR: [
              { userId: family.ownerUserId },
              { canManageCare: true, isHired: false },
            ],
          },
          select: { userId: true },
        });
        const adminUserIds = [
          ...new Set(admins.map((admin) => admin.userId)),
        ].filter((id) => id !== userId);

        return {
          outcome: 'requested' as const,
          family,
          membership,
          adminUserIds,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listJoinRequests(familyId: string, pagination: FamilyPaginationDto) {
    const where = {
      familyId,
      status: 'requested',
      invitedAt: { gte: invitationCutoff(new Date()) },
      family: { status: ACTIVE_FAMILY_STATUS },
    } satisfies Prisma.FamilyMemberWhereInput;
    const [requests, total] = await Promise.all([
      this.prisma.familyMember.findMany({
        where,
        select: memberSelect,
        orderBy: { invitedAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.familyMember.count({ where }),
    ]);
    return { requests, total };
  }

  async listOwnJoinRequests(userId: string, pagination: FamilyPaginationDto) {
    const where = {
      userId,
      status: 'requested',
      invitedAt: { gte: invitationCutoff(new Date()) },
      family: { status: ACTIVE_FAMILY_STATUS },
    } satisfies Prisma.FamilyMemberWhereInput;
    const [requests, total] = await Promise.all([
      this.prisma.familyMember.findMany({
        where,
        select: {
          ...memberSelect,
          family: {
            select: {
              ...familySelect,
              owner: {
                select: { id: true, fullName: true, avatarUrl: true },
              },
            },
          },
        },
        orderBy: { invitedAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.familyMember.count({ where }),
    ]);
    return { requests, total };
  }

  approveJoinRequest(
    familyId: string,
    memberId: string,
    actorUserId: string,
    dto: ApproveJoinRequestDto,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const target = await tx.familyMember.findFirst({
          where: { id: memberId, familyId },
          select: {
            id: true,
            userId: true,
            familyId: true,
            familyLabel: true,
            displayName: true,
            status: true,
            invitedAt: true,
            profile: { select: { dateOfBirth: true } },
            family: { select: { status: true } },
          },
        });
        if (!target) return { outcome: 'not_found' as const };
        if (
          target.status !== 'requested' ||
          target.family.status !== ACTIVE_FAMILY_STATUS
        ) {
          return { outcome: 'invalid_state' as const };
        }
        if (!target.invitedAt || target.invitedAt < invitationCutoff(now)) {
          return { outcome: 'expired' as const };
        }
        if (!target.profile?.dateOfBirth) {
          return { outcome: 'dob_required' as const };
        }

        const familyLabel = dto.familyLabel ?? target.familyLabel;
        const minor = isMinor(target.profile.dateOfBirth);
        const senior = isSenior(target.profile.dateOfBirth);

        if (familyLabel === 'caregiver') {
          if (minor) {
            return { outcome: 'minor_cannot_be_caregiver' as const };
          }
          if (
            !dto.careScopeMemberIds ||
            dto.careScopeMemberIds.length === 0 ||
            !(await this.areValidCareScopeTargets(
              tx,
              familyId,
              dto.careScopeMemberIds,
              memberId,
            ))
          ) {
            return { outcome: 'invalid_care_scope' as const };
          }
        } else if (
          dto.careScopeMemberIds &&
          dto.careScopeMemberIds.length > 0
        ) {
          return { outcome: 'invalid_care_scope' as const };
        }

        const isHired = !minor && familyLabel === 'caregiver';
        const canManageCare = minor
          ? false
          : isHired
            ? true
            : Boolean(dto.canManageCare);
        const careGrantedBy = canManageCare ? actorUserId : null;
        const isCareRecipient = minor
          ? false
          : dto.isCareRecipient !== undefined
            ? dto.isCareRecipient
            : senior;
        const careRecipientSetBy = isCareRecipient ? actorUserId : null;

        await tx.familyMemberCareScope.deleteMany({
          where: { memberId },
        });
        if (isHired && dto.careScopeMemberIds?.length) {
          await tx.familyMemberCareScope.createMany({
            data: dto.careScopeMemberIds.map((targetMemberId) => ({
              memberId,
              targetMemberId,
            })),
            skipDuplicates: true,
          });
        }

        const member = await tx.familyMember.update({
          where: { id: memberId },
          data: {
            status: 'accepted',
            invitedByUserId: actorUserId,
            familyLabel,
            displayName:
              dto.displayName !== undefined
                ? dto.displayName
                : target.displayName,
            canManageCare,
            careGrantedBy,
            isCareRecipient,
            careRecipientSetBy,
            isHired,
            locationSharingEnabled: true,
            acceptedAt: now,
            removedAt: null,
            updatedAt: now,
          },
          select: memberSelect,
        });

        return { outcome: 'approved' as const, member };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  rejectJoinRequest(familyId: string, memberId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const target = await tx.familyMember.findFirst({
          where: { id: memberId, familyId },
          select: {
            id: true,
            status: true,
            family: { select: { status: true } },
          },
        });
        if (!target) return { outcome: 'not_found' as const };
        if (
          target.status !== 'requested' ||
          target.family.status !== ACTIVE_FAMILY_STATUS
        ) {
          return { outcome: 'invalid_state' as const };
        }

        await tx.familyMemberCareScope.deleteMany({
          where: { memberId },
        });
        const member = await tx.familyMember.update({
          where: { id: memberId },
          data: {
            status: 'rejected',
            canManageCare: false,
            careGrantedBy: null,
            isCareRecipient: false,
            careRecipientSetBy: null,
            acceptedAt: null,
            updatedAt: now,
          },
          select: memberSelect,
        });
        return { outcome: 'rejected' as const, member };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  cancelJoinRequest(memberId: string, actorUserId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const target = await tx.familyMember.findUnique({
          where: { id: memberId },
          select: { id: true, userId: true, status: true },
        });
        if (!target) return { outcome: 'not_found' as const };
        if (target.userId !== actorUserId) {
          return { outcome: 'forbidden' as const };
        }
        if (target.status !== 'requested') {
          return { outcome: 'invalid_state' as const };
        }
        await tx.familyMemberCareScope.deleteMany({
          where: { memberId },
        });
        await tx.familyMember.update({
          where: { id: memberId },
          data: {
            status: 'removed',
            canManageCare: false,
            careGrantedBy: null,
            isCareRecipient: false,
            careRecipientSetBy: null,
            isHired: false,
            removedAt: now,
            updatedAt: now,
          },
          select: { id: true },
        });
        return { outcome: 'cancelled' as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Transfers family ownership to an accepted adult member.
   * Automatically sets `can_manage_care = true` and clears any hired care scope.
   */
  transferOwnership(
    familyId: string,
    currentOwnerUserId: string,
    targetMemberId: string,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const family = await tx.family.findUnique({
          where: { id: familyId },
          select: { ownerUserId: true, status: true },
        });
        if (
          !family ||
          family.status !== ACTIVE_FAMILY_STATUS ||
          family.ownerUserId !== currentOwnerUserId
        ) {
          return { outcome: 'not_owner' as const };
        }
        const target = await tx.familyMember.findFirst({
          where: { id: targetMemberId, familyId },
          select: {
            id: true,
            userId: true,
            status: true,
            profile: { select: { dateOfBirth: true } },
          },
        });
        if (
          !target ||
          target.status !== 'accepted' ||
          target.userId === currentOwnerUserId ||
          isMinor(target.profile?.dateOfBirth)
        ) {
          return { outcome: 'invalid_target' as const };
        }
        await tx.familyMemberCareScope.deleteMany({
          where: { memberId: target.id },
        });
        await tx.familyMember.update({
          where: { id: target.id },
          data: {
            canManageCare: true,
            careGrantedBy: currentOwnerUserId,
            updatedAt: new Date(),
          },
          select: { id: true },
        });
        const updated = await tx.family.update({
          where: { id: familyId },
          data: { ownerUserId: target.userId, updatedAt: new Date() },
          select: familySelect,
        });
        return { outcome: 'transferred' as const, family: updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
