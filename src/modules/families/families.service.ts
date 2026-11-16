import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/app.error';
import {
  deriveRoleFromLabel,
  invitationCutoff,
  invitationExpiresAt,
} from './families.constants';
import { FamilyAccessService } from './family-access.service';
import { FamiliesRepository } from './families.repository';
import {
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyPaginationDto,
  JoinFamilyDto,
  TransferOwnershipDto,
  UpdateFamilyDto,
  UpdateFamilyMemberDto,
} from './dto/family.dto';

@Injectable()
export class FamiliesService {
  constructor(
    private readonly familiesRepository: FamiliesRepository,
    private readonly familyAccess: FamilyAccessService,
  ) {}

  async createFamily(actorUserId: string, dto: CreateFamilyDto) {
    const result = await this.familiesRepository.createFamilyWithOwner(
      actorUserId,
      dto,
    );
    return {
      ...this.mapFamily(result.family),
      membership: this.mapMember(result.membership),
    };
  }

  async listFamilies(userId: string, pagination: FamilyPaginationDto) {
    const { memberships, total } = await this.familiesRepository.listFamilies(
      userId,
      pagination,
    );
    return {
      data: memberships.map((membership) => ({
        ...this.mapFamily(membership.family),
        role: membership.role,
        familyLabel: membership.familyLabel,
      })),
      pagination: this.page(pagination, total),
    };
  }

  async getFamily(userId: string, familyId: string) {
    const membership = await this.familyAccess.requireAcceptedMember(
      userId,
      familyId,
    );
    return {
      ...this.mapFamily(membership.family),
      role: membership.role,
      familyLabel: membership.familyLabel,
    };
  }

  async updateFamily(userId: string, familyId: string, dto: UpdateFamilyDto) {
    await this.familyAccess.requireManager(userId, familyId);
    return this.mapFamily(
      await this.familiesRepository.updateFamily(familyId, dto),
    );
  }

  async archiveFamily(userId: string, familyId: string): Promise<void> {
    await this.familyAccess.requireOwner(userId, familyId);
    await this.familiesRepository.archiveFamily(familyId);
  }

  async listMembers(
    userId: string,
    familyId: string,
    pagination: FamilyPaginationDto,
  ) {
    await this.familyAccess.requireAcceptedMember(userId, familyId);
    const { members, total } = await this.familiesRepository.listMembers(
      familyId,
      pagination,
    );
    return {
      data: members.map((member) => this.mapMember(member)),
      pagination: this.page(pagination, total),
    };
  }

  async getMember(userId: string, familyId: string, memberId: string) {
    await this.familyAccess.requireAcceptedMember(userId, familyId);
    const member = await this.familiesRepository.findMember(familyId, memberId);
    if (!member || member.status !== 'accepted') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }
    return this.mapMember(member);
  }

  async updateMember(
    actorUserId: string,
    familyId: string,
    memberId: string,
    dto: UpdateFamilyMemberDto,
  ) {
    const actor = await this.familyAccess.requireManager(actorUserId, familyId);
    const target = await this.familiesRepository.findMember(familyId, memberId);
    if (!target || target.status !== 'accepted') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }

    this.assertMemberManagementAllowed(actor, target, dto.role);
    const result =
      await this.familiesRepository.updateMemberWithManagerInvariant(
        familyId,
        memberId,
        dto,
      );
    if (result.outcome === 'last_manager') {
      throw new BusinessRuleError(
        ErrorCode.CANNOT_REMOVE_LAST_MANAGER,
        'Gia đình phải có ít nhất một quản lý',
      );
    }
    if (result.outcome !== 'updated') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }
    return this.mapMember(result.member);
  }

  async removeMember(
    actorUserId: string,
    familyId: string,
    memberId: string,
  ): Promise<void> {
    const actor = await this.familyAccess.requireManager(actorUserId, familyId);
    const target = await this.familiesRepository.findMember(familyId, memberId);
    if (!target || target.status !== 'accepted') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }

    this.assertMemberManagementAllowed(actor, target);
    const result =
      await this.familiesRepository.removeMemberWithManagerInvariant(
        familyId,
        memberId,
      );
    if (result.outcome === 'last_manager') {
      throw new BusinessRuleError(
        ErrorCode.CANNOT_REMOVE_LAST_MANAGER,
        'Gia đình phải có ít nhất một quản lý',
      );
    }
    if (result.outcome !== 'removed') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }
  }

  async createInvitation(
    actorUserId: string,
    familyId: string,
    dto: CreateInvitationDto,
  ) {
    await this.familyAccess.requireManager(actorUserId, familyId);
    const target =
      await this.familiesRepository.findProfileByInvitationTarget(dto);
    if (!target || target.accountStatus !== 'active') {
      throw new NotFoundError(
        'Không thể gửi lời mời tới người dùng này',
        ErrorCode.FAMILY_INVITATION_NOT_FOUND,
      );
    }
    if (target.id === actorUserId) {
      throw new BusinessRuleError(
        ErrorCode.CANNOT_INVITE_SELF,
        'Không thể tự mời chính mình',
      );
    }

    const existing = await this.familiesRepository.findMembershipForUser(
      familyId,
      target.id,
    );
    if (existing?.status === 'accepted') {
      throw new ConflictError(
        'Người dùng đã là thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_ALREADY_EXISTS,
      );
    }
    if (existing?.status === 'pending' && !this.isExpired(existing.invitedAt)) {
      throw new ConflictError(
        'Lời mời đang chờ xử lý đã tồn tại',
        ErrorCode.FAMILY_INVITATION_ALREADY_EXISTS,
      );
    }

    // Without an explicit role it follows the relationship (D5).
    const data = {
      ...dto,
      role: dto.role ?? deriveRoleFromLabel(dto.familyLabel),
    };
    try {
      const invitation = existing
        ? await this.familiesRepository.renewInvitation(
            existing.id,
            actorUserId,
            data,
          )
        : await this.familiesRepository.createInvitation(
            familyId,
            target.id,
            actorUserId,
            data,
          );
      return this.mapInvitation(invitation);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'Thành viên hoặc lời mời đã tồn tại',
          ErrorCode.FAMILY_INVITATION_ALREADY_EXISTS,
        );
      }
      throw error;
    }
  }

  async listPendingInvitations(
    userId: string,
    pagination: FamilyPaginationDto,
  ) {
    const { invitations, total } =
      await this.familiesRepository.listPendingInvitations(userId, pagination);
    return {
      data: invitations.map((invitation) => ({
        id: invitation.id,
        role: invitation.role,
        familyLabel: invitation.familyLabel,
        displayName: invitation.displayName,
        invitedAt: invitation.invitedAt,
        expiresAt: this.expiresAt(invitation.invitedAt),
        family: this.mapFamily(invitation.family),
        invitedBy: invitation.inviter,
      })),
      pagination: this.page(pagination, total),
    };
  }

  acceptInvitation(userId: string, invitationId: string) {
    return this.processInvitation(userId, invitationId, 'accepted');
  }

  rejectInvitation(userId: string, invitationId: string) {
    return this.processInvitation(userId, invitationId, 'rejected');
  }

  private async processInvitation(
    userId: string,
    invitationId: string,
    status: 'accepted' | 'rejected',
  ) {
    const result = await this.familiesRepository.transitionInvitation(
      invitationId,
      userId,
      status,
    );
    if (result.outcome === 'not_found') {
      throw new NotFoundError(
        'Không tìm thấy lời mời',
        ErrorCode.FAMILY_INVITATION_NOT_FOUND,
      );
    }
    if (result.outcome === 'forbidden') {
      throw new ForbiddenError(
        'Bạn không có quyền xử lý lời mời này',
        ErrorCode.FAMILY_INVITATION_ACCESS_DENIED,
      );
    }
    if (result.outcome === 'invalid_state') {
      throw new BusinessRuleError(
        ErrorCode.FAMILY_INVITATION_INVALID_STATE,
        'Lời mời không còn ở trạng thái chờ xử lý',
      );
    }
    if (result.outcome === 'expired') {
      throw new BusinessRuleError(
        ErrorCode.FAMILY_INVITATION_EXPIRED,
        'Lời mời đã hết hạn',
      );
    }
    return this.mapMember(result.membership);
  }

  async listSentInvitations(
    userId: string,
    familyId: string,
    pagination: FamilyPaginationDto,
  ) {
    await this.familyAccess.requireManager(userId, familyId);
    const { invitations, total } =
      await this.familiesRepository.listSentInvitations(familyId, pagination);
    return {
      data: invitations.map((invitation) => ({
        ...this.mapInvitation(invitation),
        invitedBy: invitation.inviter,
      })),
      pagination: this.page(pagination, total),
    };
  }

  async cancelInvitation(
    userId: string,
    familyId: string,
    invitationId: string,
  ): Promise<void> {
    await this.familyAccess.requireManager(userId, familyId);
    const result = await this.familiesRepository.cancelInvitation(
      familyId,
      invitationId,
    );
    if (result.outcome === 'cancelled') return;
    this.throwInvitationOutcome(result.outcome);
  }

  async resendInvitation(
    userId: string,
    familyId: string,
    invitationId: string,
  ) {
    await this.familyAccess.requireManager(userId, familyId);
    const result = await this.familiesRepository.resendInvitation(
      familyId,
      invitationId,
      userId,
    );
    if (result.outcome === 'resent') return this.mapInvitation(result.member);
    return this.throwInvitationOutcome(result.outcome);
  }

  async getInviteCode(userId: string, familyId: string) {
    await this.familyAccess.requireManager(userId, familyId);
    return this.familiesRepository.getOrCreateInviteCode(familyId);
  }

  async regenerateInviteCode(userId: string, familyId: string) {
    await this.familyAccess.requireManager(userId, familyId);
    return this.familiesRepository.regenerateInviteCode(familyId);
  }

  async joinByCode(userId: string, dto: JoinFamilyDto) {
    const code = dto.code.trim().toUpperCase();
    let result;
    try {
      result = await this.familiesRepository.joinByInviteCode(
        userId,
        code,
        dto,
      );
    } catch (error) {
      // Two concurrent joins by the same user race on (family_id, user_id).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'Người dùng đã là thành viên gia đình',
          ErrorCode.FAMILY_MEMBER_ALREADY_EXISTS,
        );
      }
      throw error;
    }
    if (result.outcome === 'invalid_code') {
      throw new NotFoundError(
        'Mã mời không hợp lệ hoặc đã hết hạn',
        ErrorCode.FAMILY_INVITE_CODE_INVALID,
      );
    }
    if (result.outcome === 'already_member') {
      throw new ConflictError(
        'Bạn đã là thành viên của gia đình này',
        ErrorCode.FAMILY_MEMBER_ALREADY_EXISTS,
      );
    }
    return {
      ...this.mapFamily(result.family),
      membership: this.mapMember(result.membership),
    };
  }

  async leaveFamily(userId: string, familyId: string): Promise<void> {
    const membership = await this.familyAccess.requireAcceptedMember(
      userId,
      familyId,
    );
    if (membership.family.ownerUserId === userId) {
      throw new ForbiddenError(
        'Chủ sở hữu cần chuyển quyền hoặc xóa gia đình trước khi rời',
        ErrorCode.FAMILY_OWNER_CANNOT_LEAVE,
      );
    }
    if (membership.role === 'child') {
      throw new ForbiddenError(
        'Trẻ em không thể tự rời gia đình',
        ErrorCode.CHILD_CANNOT_LEAVE_FAMILY,
      );
    }
    const result =
      await this.familiesRepository.removeMemberWithManagerInvariant(
        familyId,
        membership.id,
      );
    if (result.outcome === 'last_manager') {
      throw new BusinessRuleError(
        ErrorCode.CANNOT_REMOVE_LAST_MANAGER,
        'Gia đình phải có ít nhất một quản lý',
      );
    }
    if (result.outcome !== 'removed') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }
  }

  async transferOwnership(
    userId: string,
    familyId: string,
    dto: TransferOwnershipDto,
  ) {
    await this.familyAccess.requireOwner(userId, familyId);
    const result = await this.familiesRepository.transferOwnership(
      familyId,
      userId,
      dto.memberId,
    );
    if (result.outcome === 'not_owner') {
      throw new ForbiddenError(
        'Chỉ chủ sở hữu được chuyển quyền',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    if (result.outcome === 'invalid_target') {
      throw new BusinessRuleError(
        ErrorCode.OWNERSHIP_TRANSFER_TARGET_INVALID,
        'Chỉ chuyển quyền cho người lớn hoặc quản lý khác đang hoạt động',
      );
    }
    return this.mapFamily(result.family);
  }

  private throwInvitationOutcome(
    outcome: 'not_found' | 'invalid_state',
  ): never {
    if (outcome === 'not_found') {
      throw new NotFoundError(
        'Không tìm thấy lời mời',
        ErrorCode.FAMILY_INVITATION_NOT_FOUND,
      );
    }
    throw new BusinessRuleError(
      ErrorCode.FAMILY_INVITATION_INVALID_STATE,
      'Lời mời không còn ở trạng thái chờ xử lý',
    );
  }

  private expiresAt(invitedAt: Date | null) {
    return invitedAt ? invitationExpiresAt(invitedAt) : null;
  }

  private isExpired(invitedAt: Date | null) {
    return !invitedAt || invitedAt < invitationCutoff(new Date());
  }

  private mapInvitation(member: Parameters<FamiliesService['mapMember']>[0]) {
    return {
      ...this.mapMember(member),
      expiresAt: this.expiresAt(member.invitedAt),
      isExpired: this.isExpired(member.invitedAt),
    };
  }

  private assertMemberManagementAllowed(
    actor: {
      id: string;
      userId: string;
      family: { ownerUserId: string };
    },
    target: { id: string; userId: string; role: string },
    nextRole?: string,
  ) {
    if (actor.id === target.id && nextRole && nextRole !== target.role) {
      throw new ForbiddenError(
        'Không thể tự thay đổi vai trò của chính mình',
        ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
      );
    }
    if (target.userId === actor.family.ownerUserId) {
      throw new ForbiddenError(
        'Không thể thay đổi hoặc xóa chủ sở hữu gia đình',
        ErrorCode.FAMILY_OWNER_CANNOT_LEAVE,
      );
    }
    const actorIsOwner = actor.userId === actor.family.ownerUserId;
    if (
      !actorIsOwner &&
      (target.role === 'manager' || nextRole === 'manager')
    ) {
      throw new ForbiddenError(
        'Chỉ chủ sở hữu được quản lý vai trò quản lý',
        ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
      );
    }
  }

  private mapFamily(family: {
    id: string;
    familyName: string;
    ownerUserId: string;
    avatarUrl: string | null;
    status: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  }) {
    return {
      id: family.id,
      familyName: family.familyName,
      ownerUserId: family.ownerUserId,
      avatarUrl: family.avatarUrl,
      status: family.status,
      createdAt: family.createdAt,
      updatedAt: family.updatedAt,
    };
  }

  private mapMember(member: {
    id: string;
    familyId: string;
    userId: string;
    role: string;
    familyLabel: string;
    displayName: string | null;
    status: string | null;
    locationSharingEnabled: boolean | null;
    invitedAt: Date | null;
    acceptedAt: Date | null;
    removedAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    profile: {
      id: string;
      fullName: string | null;
      avatarUrl: string | null;
      gender?: string | null;
      dateOfBirth?: Date | null;
    };
  }) {
    // Gender/date of birth are personal data: only share them once the person
    // has accepted, never for pending/rejected/removed invitees.
    const accepted = member.status === 'accepted';
    return {
      id: member.id,
      familyId: member.familyId,
      userId: member.userId,
      role: member.role,
      familyLabel: member.familyLabel,
      displayName: member.displayName,
      status: member.status,
      locationSharingEnabled: member.locationSharingEnabled,
      invitedAt: member.invitedAt,
      acceptedAt: member.acceptedAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      profile: {
        id: member.profile.id,
        fullName: member.profile.fullName,
        avatarUrl: member.profile.avatarUrl,
        gender: accepted ? (member.profile.gender ?? null) : null,
        dateOfBirth: accepted
          ? (member.profile.dateOfBirth?.toISOString().slice(0, 10) ?? null)
          : null,
      },
    };
  }

  private page(pagination: FamilyPaginationDto, total: number) {
    return {
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }
}
