import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { randomInt } from 'node:crypto';
import {
  ACTIVE_FAMILY_STATUS,
  ARCHIVED_FAMILY_STATUS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  deriveRoleFromLabel,
  invitationCutoff,
  inviteCodeExpiry,
} from './families.constants';
import {
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyPaginationDto,
  JoinFamilyDto,
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
      // FE derives sibling/elder terms (anh/chị/em, bác/chú…) from these.
      gender: true,
      dateOfBirth: true,
    },
  },
} as const;

const inviterSelect = { select: { id: true, fullName: true, avatarUrl: true } };

/** An invitation whose role is already decided (given or derived from the label). */
export type InvitationData = Omit<CreateInvitationDto, 'role'> & {
  role: string;
};

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
    dto: InvitationData,
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
    dto: InvitationData,
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
      invitedAt: { gte: invitationCutoff(new Date()) },
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
            invitedAt: true,
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
        if (
          nextStatus === 'accepted' &&
          (!invitation.invitedAt ||
            invitation.invitedAt < invitationCutoff(new Date()))
        ) {
          return { outcome: 'expired' as const };
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
        await tx.familyMember.update({
          where: { id: invitationId },
          data: {
            status: 'removed',
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
        // Someone else created a code first: return theirs.
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

  /** Joins by a live code; upserts on (family, user) so old rows are reused. */
  joinByInviteCode(userId: string, code: string, dto: JoinFamilyDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
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
          select: { id: true, status: true },
        });
        if (existing?.status === 'accepted') {
          return { outcome: 'already_member' as const };
        }

        const data = {
          role: deriveRoleFromLabel(dto.familyLabel),
          familyLabel: dto.familyLabel,
          displayName: dto.displayName ?? null,
          status: 'accepted',
          invitedByUserId: null,
          acceptedAt: now,
          removedAt: null,
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
        return { outcome: 'joined' as const, family, membership };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** New owner becomes manager + owner in one transaction (deferred trigger checks at commit). */
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
          select: { id: true, userId: true, role: true, status: true },
        });
        if (
          !target ||
          target.status !== 'accepted' ||
          target.userId === currentOwnerUserId ||
          (target.role !== 'adult' && target.role !== 'manager')
        ) {
          return { outcome: 'invalid_target' as const };
        }
        await tx.familyMember.update({
          where: { id: target.id },
          data: { role: 'manager', updatedAt: new Date() },
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
