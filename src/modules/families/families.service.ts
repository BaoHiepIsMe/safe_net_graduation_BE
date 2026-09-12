import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/app.error';
import { FamilyAccessService } from './family-access.service';
import { FamiliesRepository } from './families.repository';
import {
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyPaginationDto,
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
    if (existing?.status === 'pending') {
      throw new ConflictError(
        'Lời mời đang chờ xử lý đã tồn tại',
        ErrorCode.FAMILY_INVITATION_ALREADY_EXISTS,
      );
    }

    try {
      const invitation = existing
        ? await this.familiesRepository.renewInvitation(
            existing.id,
            actorUserId,
            dto,
          )
        : await this.familiesRepository.createInvitation(
            familyId,
            target.id,
            actorUserId,
            dto,
          );
      return this.mapMember(invitation);
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
    return this.mapMember(result.membership);
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
    profile: { id: string; fullName: string | null; avatarUrl: string | null };
  }) {
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
      profile: member.profile,
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
