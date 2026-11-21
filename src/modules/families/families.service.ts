import { Injectable, Logger, Optional } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/app.error';
import {
  isEffectiveCareRecipient,
  isMinor,
  isSenior,
} from '../../common/utils/age.util';
import { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ApproveJoinRequestDto,
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyPaginationDto,
  JoinFamilyDto,
  TransferOwnershipDto,
  UpdateFamilyDto,
  UpdateFamilyMemberDto,
} from './dto/family.dto';
import { invitationCutoff, invitationExpiresAt } from './families.constants';
import {
  FamiliesRepository,
  ResolvedInvitationData,
  ResolvedMemberUpdateData,
} from './families.repository';
import { FamilyAccessService } from './family-access.service';

@Injectable()
export class FamiliesService {
  private readonly logger = new Logger(FamiliesService.name);

  constructor(
    private readonly familiesRepository: FamiliesRepository,
    private readonly familyAccess: FamilyAccessService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  async createFamily(actorUserId: string, dto: CreateFamilyDto) {
    const result = await this.familiesRepository.createFamilyWithOwner(
      actorUserId,
      dto,
    );
    if (result.outcome === 'dob_required') {
      throw new BusinessRuleError(
        ErrorCode.PROFILE_DATE_OF_BIRTH_REQUIRED,
        'Vui lòng cập nhật ngày sinh trước khi tạo nhóm gia đình',
      );
    }
    if (result.outcome === 'minor_forbidden') {
      throw new ForbiddenError(
        'Tài khoản dưới 18 tuổi không thể tạo nhóm gia đình',
        ErrorCode.MINOR_CANNOT_CREATE_FAMILY,
      );
    }
    return {
      ...this.mapFamily(result.family),
      membership: this.mapMember(result.membership, result.family.ownerUserId),
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
        ...this.mapCallerMembershipSummary(membership),
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
      ...this.mapCallerMembershipSummary(membership),
    };
  }

  async updateFamily(userId: string, familyId: string, dto: UpdateFamilyDto) {
    await this.familyAccess.requireFamilyAdmin(userId, familyId);
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
    const actor = await this.familyAccess.requireAcceptedMember(
      userId,
      familyId,
    );
    const { members, total } = await this.familiesRepository.listMembers(
      familyId,
      pagination,
    );
    return {
      data: members.map((member) =>
        this.mapMember(member, actor.family?.ownerUserId),
      ),
      pagination: this.page(pagination, total),
    };
  }

  async getMember(userId: string, familyId: string, memberId: string) {
    const actor = await this.familyAccess.requireAcceptedMember(
      userId,
      familyId,
    );
    const member = await this.familiesRepository.findMember(familyId, memberId);
    if (!member || member.status !== 'accepted') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }
    return this.mapMember(member, actor.family?.ownerUserId);
  }

  async updateMember(
    actorUserId: string,
    familyId: string,
    memberId: string,
    dto: UpdateFamilyMemberDto,
  ) {
    // Any accepted member may edit their own name, sharing and resign as
    // manager; changes to other members are gated in resolveMemberUpdate.
    const actor = await this.familyAccess.requireAcceptedMember(
      actorUserId,
      familyId,
    );
    const target = await this.familiesRepository.findMember(familyId, memberId);
    if (!target || target.status !== 'accepted') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }

    const ownerUserId = actor.family.ownerUserId;
    const resolved = this.resolveMemberUpdate(actor, target, ownerUserId, dto);
    const result =
      await this.familiesRepository.updateMemberWithManagerInvariant(
        familyId,
        memberId,
        resolved.data,
      );
    if (result.outcome === 'last_manager') {
      throw new BusinessRuleError(
        ErrorCode.CANNOT_REMOVE_LAST_MANAGER,
        'Gia đình phải có ít nhất một quản lý',
      );
    }
    if (result.outcome === 'invalid_care_scope') {
      throw new BusinessRuleError(
        ErrorCode.CARE_SCOPE_INVALID,
        'Phạm vi chăm sóc phải gồm các thành viên đang được chăm sóc trong gia đình',
      );
    }
    if (result.outcome !== 'updated') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }

    if (resolved.permissionsChanged) {
      await this.notifyAllFamilyMembers(familyId, actorUserId, {
        type: 'family_role_changed',
        title: 'Thay đổi quyền trong gia đình',
        message:
          'Quyền hoặc phạm vi chăm sóc trong gia đình vừa được cập nhật.',
        metadata: {
          memberId: result.member.id,
          action: 'member_permissions_updated',
        },
      });
    }

    return this.mapMember(result.member, ownerUserId);
  }

  async removeMember(
    actorUserId: string,
    familyId: string,
    memberId: string,
  ): Promise<void> {
    const actor = await this.familyAccess.requireFamilyAdmin(
      actorUserId,
      familyId,
    );
    const target = await this.familiesRepository.findMember(familyId, memberId);
    if (!target || target.status !== 'accepted') {
      throw new NotFoundError(
        'Không tìm thấy thành viên gia đình',
        ErrorCode.FAMILY_MEMBER_NOT_FOUND,
      );
    }

    const ownerUserId = actor.family?.ownerUserId ?? target.family?.ownerUserId;
    this.assertMemberRemovalAllowed(actor, target, ownerUserId);
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
    const actor = await this.familyAccess.requireFamilyAdmin(
      actorUserId,
      familyId,
    );
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
    if (
      (existing?.status === 'pending' || existing?.status === 'requested') &&
      !this.isExpired(existing.invitedAt)
    ) {
      throw new ConflictError(
        'Lời mời hoặc yêu cầu đang chờ xử lý đã tồn tại',
        ErrorCode.FAMILY_INVITATION_ALREADY_EXISTS,
      );
    }

    const targetIsMinor = isMinor(target.dateOfBirth);
    if (dto.familyLabel === 'caregiver') {
      if (targetIsMinor) {
        throw new BusinessRuleError(
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
          'Người dưới 18 tuổi không thể làm người chăm sóc thuê',
        );
      }
      const careScopeIds = dto.careScopeMemberIds ?? [];
      if (
        careScopeIds.length === 0 ||
        !(await this.familiesRepository.validateCareScopeMembers(
          familyId,
          careScopeIds,
          existing?.id,
        ))
      ) {
        throw new BusinessRuleError(
          ErrorCode.CARE_SCOPE_INVALID,
          'Phạm vi chăm sóc phải gồm các thành viên đang được chăm sóc trong gia đình',
        );
      }
    }

    const isHired = !targetIsMinor && dto.familyLabel === 'caregiver';
    const canManageCare = targetIsMinor
      ? false
      : isHired
        ? true
        : Boolean(dto.canManageCare);
    const isCareRecipient = targetIsMinor
      ? false
      : Boolean(dto.isCareRecipient);
    const careRecipientSetBy = targetIsMinor
      ? null
      : dto.isCareRecipient !== undefined
        ? actorUserId
        : null;

    const data: ResolvedInvitationData = {
      familyLabel: dto.familyLabel,
      displayName: dto.displayName,
      canManageCare,
      careGrantedBy: canManageCare ? actorUserId : null,
      isCareRecipient,
      careRecipientSetBy,
      isHired,
      careScopeMemberIds: isHired ? (dto.careScopeMemberIds ?? []) : [],
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
      return this.mapInvitation(invitation, actor.family?.ownerUserId);
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
      data: invitations.map((invitation) => {
        const dob = invitation.profile?.dateOfBirth;
        const minor = isMinor(dob);
        const senior = isSenior(dob);
        const isHired = !minor && Boolean(invitation.isHired);
        const canManageCare = minor
          ? false
          : isHired
            ? true
            : Boolean(invitation.canManageCare);
        const effectiveCareRecipient =
          minor ||
          (invitation.careRecipientSetBy === null
            ? senior
            : Boolean(invitation.isCareRecipient));
        const careManagers = invitation.family.members.map((manager) => ({
          id: manager.id,
          userId: manager.userId,
          familyLabel: manager.familyLabel,
          displayName: manager.displayName,
          isHired: Boolean(manager.isHired),
          fullName: manager.profile?.fullName ?? null,
          avatarUrl: manager.profile?.avatarUrl ?? null,
        }));
        return {
          id: invitation.id,
          familyLabel: invitation.familyLabel,
          displayName: invitation.displayName,
          canManageCare,
          isCareRecipient: effectiveCareRecipient,
          isMinor: minor,
          isHired,
          careScopeMemberIds: isHired
            ? (invitation.careScopes ?? []).map(
                (scope: { targetMemberId: string }) => scope.targetMemberId,
              )
            : [],
          careManagers,
          invitedAt: invitation.invitedAt,
          expiresAt: this.expiresAt(invitation.invitedAt),
          family: this.mapFamily(invitation.family),
          invitedBy: invitation.inviter,
        };
      }),
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
    if (result.outcome === 'dob_required') {
      throw new BusinessRuleError(
        ErrorCode.PROFILE_DATE_OF_BIRTH_REQUIRED,
        'Vui lòng cập nhật ngày sinh trước khi nhận lời mời',
      );
    }
    return this.mapMember(result.membership);
  }

  async listSentInvitations(
    userId: string,
    familyId: string,
    pagination: FamilyPaginationDto,
  ) {
    const actor = await this.familyAccess.requireFamilyAdmin(userId, familyId);
    const { invitations, total } =
      await this.familiesRepository.listSentInvitations(familyId, pagination);
    return {
      data: invitations.map((invitation) => ({
        ...this.mapInvitation(invitation, actor.family?.ownerUserId),
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
    await this.familyAccess.requireFamilyAdmin(userId, familyId);
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
    const actor = await this.familyAccess.requireFamilyAdmin(userId, familyId);
    const result = await this.familiesRepository.resendInvitation(
      familyId,
      invitationId,
      userId,
    );
    if (result.outcome === 'resent') {
      return this.mapInvitation(result.member, actor.family?.ownerUserId);
    }
    return this.throwInvitationOutcome(result.outcome);
  }

  async getInviteCode(userId: string, familyId: string) {
    await this.familyAccess.requireFamilyAdmin(userId, familyId);
    return this.familiesRepository.getOrCreateInviteCode(familyId);
  }

  async regenerateInviteCode(userId: string, familyId: string) {
    await this.familyAccess.requireFamilyAdmin(userId, familyId);
    return this.familiesRepository.regenerateInviteCode(familyId);
  }

  async getJoinPreview(rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    const preview = await this.familiesRepository.findJoinPreviewByCode(code);
    if (!preview) {
      throw new NotFoundError(
        'Mã mời không hợp lệ hoặc đã hết hạn',
        ErrorCode.FAMILY_INVITE_CODE_INVALID,
      );
    }
    return preview;
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
    if (result.outcome === 'dob_required') {
      throw new BusinessRuleError(
        ErrorCode.PROFILE_DATE_OF_BIRTH_REQUIRED,
        'Vui lòng cập nhật ngày sinh trước khi xin vào nhóm',
      );
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

    if (
      result.outcome === 'requested' &&
      Array.isArray(result.adminUserIds) &&
      result.adminUserIds.length > 0
    ) {
      const requesterName =
        result.membership.displayName ??
        result.membership.profile?.fullName ??
        'Một người dùng';
      await this.safeNotifyFamilyEvent({
        familyId: result.family.id,
        senderUserId: userId,
        recipientUserIds: result.adminUserIds,
        type: 'family_join_request',
        title: 'Yêu cầu tham gia gia đình',
        message: `${requesterName} đã gửi yêu cầu tham gia ${result.family.familyName}.`,
        metadata: {
          memberId: result.membership.id,
        },
      });
    }

    return {
      ...this.mapFamily(result.family),
      membership: this.mapMember(result.membership, result.family.ownerUserId),
      requestedAt: result.membership.invitedAt,
      expiresAt: this.expiresAt(result.membership.invitedAt),
    };
  }

  async listJoinRequests(
    userId: string,
    familyId: string,
    pagination: FamilyPaginationDto,
  ) {
    await this.familyAccess.requireFamilyAdmin(userId, familyId);
    const { requests, total } = await this.familiesRepository.listJoinRequests(
      familyId,
      pagination,
    );
    return {
      data: requests.map((row) => ({
        id: row.id,
        familyId: row.familyId,
        userId: row.userId,
        familyLabel: row.familyLabel,
        displayName: row.displayName,
        status: row.status,
        isMinor: isMinor(row.profile?.dateOfBirth),
        isSenior: isSenior(row.profile?.dateOfBirth),
        requestedAt: row.invitedAt,
        expiresAt: this.expiresAt(row.invitedAt),
        profile: {
          id: row.profile.id,
          fullName: row.profile.fullName,
          avatarUrl: row.profile.avatarUrl,
          gender: row.profile.gender ?? null,
        },
      })),
      pagination: this.page(pagination, total),
    };
  }

  async listOwnJoinRequests(userId: string, pagination: FamilyPaginationDto) {
    const { requests, total } =
      await this.familiesRepository.listOwnJoinRequests(userId, pagination);
    return {
      data: requests.map((row) => ({
        id: row.id,
        familyId: row.familyId,
        userId: row.userId,
        familyLabel: row.familyLabel,
        displayName: row.displayName,
        status: row.status,
        requestedAt: row.invitedAt,
        expiresAt: this.expiresAt(row.invitedAt),
        family: {
          ...this.mapFamily(row.family),
          owner: row.family.owner
            ? {
                userId: row.family.owner.id,
                fullName: row.family.owner.fullName,
                avatarUrl: row.family.owner.avatarUrl,
              }
            : null,
        },
      })),
      pagination: this.page(pagination, total),
    };
  }

  async approveJoinRequest(
    actorUserId: string,
    familyId: string,
    memberId: string,
    dto: ApproveJoinRequestDto,
  ) {
    const actor = await this.familyAccess.requireFamilyAdmin(
      actorUserId,
      familyId,
    );
    const result = await this.familiesRepository.approveJoinRequest(
      familyId,
      memberId,
      actorUserId,
      dto,
    );
    if (result.outcome === 'not_found') {
      throw new NotFoundError(
        'Không tìm thấy yêu cầu tham gia',
        ErrorCode.FAMILY_JOIN_REQUEST_NOT_FOUND,
      );
    }
    if (result.outcome === 'invalid_state') {
      throw new BusinessRuleError(
        ErrorCode.FAMILY_JOIN_REQUEST_INVALID_STATE,
        'Yêu cầu tham gia không còn ở trạng thái chờ duyệt',
      );
    }
    if (result.outcome === 'expired') {
      throw new BusinessRuleError(
        ErrorCode.FAMILY_JOIN_REQUEST_EXPIRED,
        'Yêu cầu tham gia đã hết hạn',
      );
    }
    if (result.outcome === 'dob_required') {
      throw new BusinessRuleError(
        ErrorCode.PROFILE_DATE_OF_BIRTH_REQUIRED,
        'Người xin vào chưa cập nhật ngày sinh',
      );
    }
    if (result.outcome === 'minor_cannot_be_caregiver') {
      throw new BusinessRuleError(
        ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
        'Người dưới 18 tuổi không thể làm người chăm sóc thuê',
      );
    }
    if (result.outcome === 'invalid_care_scope') {
      throw new BusinessRuleError(
        ErrorCode.CARE_SCOPE_INVALID,
        'Phạm vi chăm sóc phải gồm các thành viên đang được chăm sóc trong gia đình',
      );
    }

    await this.safeNotifyFamilyEvent({
      familyId,
      senderUserId: actorUserId,
      recipientUserIds: [result.member.userId],
      type: 'family_join_request_processed',
      title: 'Yêu cầu tham gia đã được duyệt',
      message: `Bạn đã được chấp nhận vào ${actor.family?.familyName ?? 'nhóm gia đình'}.`,
      metadata: {
        memberId: result.member.id,
        decision: 'approved',
      },
    });

    return this.mapMember(result.member, actor.family?.ownerUserId);
  }

  async rejectJoinRequest(
    actorUserId: string,
    familyId: string,
    memberId: string,
  ) {
    const actor = await this.familyAccess.requireFamilyAdmin(
      actorUserId,
      familyId,
    );
    const result = await this.familiesRepository.rejectJoinRequest(
      familyId,
      memberId,
    );
    if (result.outcome === 'not_found') {
      throw new NotFoundError(
        'Không tìm thấy yêu cầu tham gia',
        ErrorCode.FAMILY_JOIN_REQUEST_NOT_FOUND,
      );
    }
    if (result.outcome === 'invalid_state') {
      throw new BusinessRuleError(
        ErrorCode.FAMILY_JOIN_REQUEST_INVALID_STATE,
        'Yêu cầu tham gia không còn ở trạng thái chờ duyệt',
      );
    }

    await this.safeNotifyFamilyEvent({
      familyId,
      senderUserId: actorUserId,
      recipientUserIds: [result.member.userId],
      type: 'family_join_request_processed',
      title: 'Yêu cầu tham gia bị từ chối',
      message: `Yêu cầu tham gia ${actor.family?.familyName ?? 'nhóm gia đình'} đã bị từ chối.`,
      metadata: {
        memberId: result.member.id,
        decision: 'rejected',
      },
    });

    return this.mapMember(result.member, actor.family?.ownerUserId);
  }

  async cancelJoinRequest(userId: string, memberId: string): Promise<void> {
    const result = await this.familiesRepository.cancelJoinRequest(
      memberId,
      userId,
    );
    if (result.outcome === 'not_found') {
      throw new NotFoundError(
        'Không tìm thấy yêu cầu tham gia',
        ErrorCode.FAMILY_JOIN_REQUEST_NOT_FOUND,
      );
    }
    if (result.outcome === 'forbidden') {
      throw new ForbiddenError(
        'Bạn không có quyền hủy yêu cầu tham gia này',
        ErrorCode.FAMILY_JOIN_REQUEST_ACCESS_DENIED,
      );
    }
    if (result.outcome === 'invalid_state') {
      throw new BusinessRuleError(
        ErrorCode.FAMILY_JOIN_REQUEST_INVALID_STATE,
        'Yêu cầu tham gia không còn ở trạng thái chờ duyệt',
      );
    }
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
    if (isMinor(membership.profile?.dateOfBirth)) {
      throw new ForbiddenError(
        'Trẻ em không thể tự rời gia đình',
        ErrorCode.CHILD_CANNOT_LEAVE_FAMILY,
      );
    }

    // Resolved before removal: afterwards the member no longer counts.
    const wasCareRecipient = isEffectiveCareRecipient(membership);
    const managersToNotify = wasCareRecipient
      ? await this.familyAccess.listManagersFor(membership.id)
      : [];

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

    if (managersToNotify.length > 0) {
      const displayName =
        membership.displayName ??
        membership.profile?.fullName ??
        'Một thành viên được chăm sóc';
      const recipientIds = managersToNotify
        .map((m) => m.userId)
        .filter((id) => id !== userId);
      await this.safeNotifyFamilyEvent({
        familyId,
        senderUserId: userId,
        recipientUserIds: recipientIds,
        type: 'care_recipient_left',
        title: 'Người được chăm sóc đã rời nhóm',
        message: `${displayName} đã rời khỏi ${membership.family.familyName}.`,
        metadata: {
          memberId: membership.id,
          priority: 'high',
        },
      });
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
        'Chỉ chuyển quyền cho người lớn đã là thành viên trong nhóm',
      );
    }

    await this.notifyAllFamilyMembers(familyId, userId, {
      type: 'family_role_changed',
      title: 'Chuyển chủ nhóm gia đình',
      message: 'Chủ nhóm gia đình vừa được chuyển giao.',
      metadata: {
        memberId: dto.memberId,
        action: 'ownership_transferred',
      },
    });

    return this.mapFamily(result.family);
  }

  private resolveMemberUpdate(
    actor: {
      id: string;
      userId: string;
      canManageCare?: boolean;
      isHired?: boolean;
      family?: { ownerUserId: string };
    },
    target: {
      id: string;
      userId: string;
      familyLabel: string;
      displayName: string | null;
      canManageCare?: boolean;
      careGrantedBy?: string | null;
      isCareRecipient?: boolean;
      careRecipientSetBy?: string | null;
      isHired?: boolean;
      careScopes?: Array<{ targetMemberId: string }>;
      profile?: { dateOfBirth?: Date | null };
    },
    ownerUserId: string | undefined,
    dto: UpdateFamilyMemberDto,
  ): { data: ResolvedMemberUpdateData; permissionsChanged: boolean } {
    const actorIsOwner = ownerUserId === actor.userId;
    const actorIsAdmin =
      actorIsOwner || (Boolean(actor.canManageCare) && !actor.isHired);
    const isSelf = actor.id === target.id || actor.userId === target.userId;
    const targetIsOwner = ownerUserId === target.userId;
    const targetIsMinor = isMinor(target.profile?.dateOfBirth);

    const data: ResolvedMemberUpdateData = {};
    let permissionsChanged = false;

    const nextLabel = dto.familyLabel ?? target.familyLabel;
    const nextIsHired = !targetIsMinor && nextLabel === 'caregiver';

    if (dto.familyLabel !== undefined) {
      if (!actorIsAdmin && !isSelf) {
        throw new ForbiddenError(
          'Chỉ quản lý chính thức mới được đổi nhãn thành viên khác',
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
        );
      }
      if (targetIsOwner && !actorIsOwner) {
        throw new ForbiddenError(
          'Không thể thay đổi thông tin chủ nhóm',
          ErrorCode.FAMILY_OWNER_CANNOT_LEAVE,
        );
      }
      if (dto.familyLabel === 'caregiver' && targetIsMinor) {
        throw new BusinessRuleError(
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
          'Người dưới 18 tuổi không thể làm người chăm sóc thuê',
        );
      }
      data.familyLabel = dto.familyLabel;
      if (nextIsHired !== Boolean(target.isHired)) {
        // Hiring status carries permissions: only an admin may change it, and
        // never for themselves (unless owner), or a hired caregiver could relabel
        // themselves into a full manager.
        if (!actorIsAdmin || (isSelf && !actorIsOwner)) {
          throw new ForbiddenError(
            'Chỉ chủ nhóm hoặc quản lý chính thức mới được đổi nhãn Người chăm sóc thuê',
            ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
          );
        }
        data.isHired = nextIsHired;
        if (nextIsHired) {
          data.canManageCare = true;
          data.careGrantedBy = actor.userId;
        } else if (!targetIsOwner) {
          // A former hired caregiver does not keep management rights; an admin
          // can grant them explicitly with canManageCare = true.
          data.canManageCare = false;
          data.careGrantedBy = null;
        }
        permissionsChanged = true;
      }
    }

    if (dto.displayName !== undefined) {
      if (!actorIsAdmin && !isSelf) {
        throw new ForbiddenError(
          'Chỉ quản lý chính thức mới được đổi tên hiển thị của thành viên khác',
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
        );
      }
      if (targetIsOwner && !actorIsOwner) {
        throw new ForbiddenError(
          'Không thể thay đổi thông tin chủ nhóm',
          ErrorCode.FAMILY_OWNER_CANNOT_LEAVE,
        );
      }
      data.displayName = dto.displayName;
    }

    if (dto.canManageCare !== undefined) {
      const currentManage = data.canManageCare ?? Boolean(target.canManageCare);
      if (dto.canManageCare !== currentManage) {
        if (dto.canManageCare === true) {
          if (!actorIsAdmin) {
            throw new ForbiddenError(
              'Chỉ chủ nhóm hoặc quản lý chính thức mới được cấp quyền quản lý',
              ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
            );
          }
          if (targetIsMinor) {
            throw new BusinessRuleError(
              ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
              'Người dưới 18 tuổi không thể có quyền quản lý',
            );
          }
          data.canManageCare = true;
          data.careGrantedBy = actor.userId;
        } else {
          if (targetIsOwner) {
            throw new ForbiddenError(
              'Chủ nhóm luôn có quyền quản lý; cần chuyển chủ nhóm trước',
              ErrorCode.FAMILY_OWNER_CANNOT_LEAVE,
            );
          }
          if (!actorIsOwner && !isSelf) {
            throw new ForbiddenError(
              'Chỉ chủ nhóm mới được thu quyền quản lý của người khác',
              ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
            );
          }
          data.canManageCare = false;
          data.careGrantedBy = null;
        }
        permissionsChanged = true;
      }
    }

    if (dto.isCareRecipient !== undefined) {
      if (!actorIsAdmin) {
        throw new ForbiddenError(
          'Chỉ chủ nhóm hoặc quản lý chính thức mới được bật/tắt trạng thái cần được chăm sóc',
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
        );
      }
      if (isSelf) {
        throw new ForbiddenError(
          'Không thể tự bật hoặc tắt trạng thái cần được chăm sóc của chính mình',
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
        );
      }
      if (targetIsMinor) {
        throw new BusinessRuleError(
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
          'Người dưới 18 tuổi luôn ở trạng thái được chăm sóc theo tuổi',
        );
      }
      if (dto.isCareRecipient !== Boolean(target.isCareRecipient)) {
        data.isCareRecipient = dto.isCareRecipient;
        data.careRecipientSetBy = dto.isCareRecipient ? actor.userId : null;
        if (dto.isCareRecipient) {
          data.locationSharingEnabled = true;
        }
        permissionsChanged = true;
      }
    }

    if (dto.careScopeMemberIds !== undefined) {
      if (!actorIsAdmin) {
        throw new ForbiddenError(
          'Chỉ chủ nhóm hoặc quản lý chính thức mới được đổi phạm vi chăm sóc',
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
        );
      }
      if (!nextIsHired) {
        throw new BusinessRuleError(
          ErrorCode.CARE_SCOPE_INVALID,
          'Chỉ người chăm sóc thuê mới có phạm vi chăm sóc',
        );
      }
      data.careScopeMemberIds = dto.careScopeMemberIds;
      permissionsChanged = true;
    } else if (nextIsHired && !target.isHired && !targetIsOwner) {
      throw new BusinessRuleError(
        ErrorCode.CARE_SCOPE_INVALID,
        'Nhãn người chăm sóc thuê bắt buộc phải chọn ít nhất một người được chăm sóc',
      );
    } else if (!nextIsHired && target.isHired) {
      data.careScopeMemberIds = [];
      permissionsChanged = true;
    }

    if (dto.locationSharingEnabled !== undefined) {
      // Sharing is the member's own choice; care recipients are forced on by
      // the isCareRecipient branch above, not by toggling someone else's switch.
      if (!isSelf) {
        throw new ForbiddenError(
          'Chỉ chính thành viên mới được bật/tắt chia sẻ vị trí của mình',
          ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
        );
      }
      const effectiveCareRecipientAfterUpdate =
        targetIsMinor ||
        (data.isCareRecipient !== undefined
          ? data.isCareRecipient
          : Boolean(target.isCareRecipient));
      if (
        dto.locationSharingEnabled === false &&
        effectiveCareRecipientAfterUpdate
      ) {
        throw new ForbiddenError(
          'Người được chăm sóc không thể tắt chia sẻ vị trí',
          ErrorCode.CARE_RECIPIENT_CANNOT_DISABLE_LOCATION_SHARING,
        );
      }
      data.locationSharingEnabled = dto.locationSharingEnabled;
    }

    return { data, permissionsChanged };
  }

  private assertMemberRemovalAllowed(
    actor: {
      id: string;
      userId: string;
      isHired?: boolean;
      family?: { ownerUserId: string };
    },
    target: {
      id: string;
      userId: string;
      canManageCare?: boolean;
      isCareRecipient?: boolean;
      profile?: { dateOfBirth?: Date | null };
    },
    ownerUserId: string | undefined,
  ) {
    if (target.userId === ownerUserId) {
      throw new ForbiddenError(
        'Không thể xóa chủ sở hữu gia đình',
        ErrorCode.FAMILY_OWNER_CANNOT_LEAVE,
      );
    }
    const actorIsOwner = actor.userId === ownerUserId;
    if (Boolean(target.canManageCare) && !actorIsOwner) {
      throw new ForbiddenError(
        'Chỉ chủ nhóm mới được xóa một quản lý khác',
        ErrorCode.MEMBER_ROLE_CHANGE_DENIED,
      );
    }
    if (
      actorIsOwner &&
      Boolean(actor.isHired) &&
      isEffectiveCareRecipient(target)
    ) {
      throw new ForbiddenError(
        'Chủ nhóm là người chăm sóc thuê không được xóa người được chăm sóc',
        ErrorCode.HIRED_OWNER_CANNOT_REMOVE_CARE_RECIPIENT,
      );
    }
  }

  private async notifyAllFamilyMembers(
    familyId: string,
    senderUserId: string,
    payload: {
      type: 'family_role_changed';
      title: string;
      message: string;
      metadata: Record<string, unknown>;
    },
  ) {
    const recipientUserIds =
      await this.familiesRepository.listAcceptedFamilyMemberUserIds(familyId);
    await this.safeNotifyFamilyEvent({
      familyId,
      senderUserId,
      recipientUserIds,
      ...payload,
    });
  }

  private async safeNotifyFamilyEvent(
    input: Parameters<NotificationsService['notifyFamilyEvent']>[0],
  ) {
    if (!this.notificationsService?.notifyFamilyEvent) return;
    try {
      await this.notificationsService.notifyFamilyEvent(input);
    } catch {
      this.logger.warn('Family notification persistence or delivery failed');
    }
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

  private mapInvitation(
    member: Parameters<FamiliesService['mapMember']>[0],
    ownerUserId?: string,
  ) {
    return {
      ...this.mapMember(member, ownerUserId),
      expiresAt: this.expiresAt(member.invitedAt),
      isExpired: this.isExpired(member.invitedAt),
    };
  }

  private mapCallerMembershipSummary(membership: {
    userId: string;
    familyLabel: string;
    canManageCare?: boolean;
    isCareRecipient?: boolean;
    isHired?: boolean;
    careScopes?: Array<{ targetMemberId: string }>;
    profile?: { dateOfBirth?: Date | null };
    family: { ownerUserId: string };
  }) {
    const isHired = Boolean(membership.isHired);
    return {
      familyLabel: membership.familyLabel,
      isOwner: membership.family.ownerUserId === membership.userId,
      canManageCare: Boolean(membership.canManageCare),
      isCareRecipient: isEffectiveCareRecipient(membership),
      isMinor: isMinor(membership.profile?.dateOfBirth),
      isHired,
      careScopeMemberIds: isHired
        ? (membership.careScopes ?? []).map((scope) => scope.targetMemberId)
        : [],
    };
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

  private mapMember(
    member: {
      id: string;
      familyId: string;
      userId: string;
      familyLabel: string;
      displayName: string | null;
      status: string | null;
      canManageCare?: boolean;
      isCareRecipient?: boolean;
      isHired?: boolean;
      careScopes?: Array<{ targetMemberId: string }>;
      locationSharingEnabled: boolean | null;
      invitedAt: Date | null;
      acceptedAt: Date | null;
      removedAt?: Date | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      family?: { ownerUserId: string };
      profile: {
        id: string;
        fullName: string | null;
        avatarUrl: string | null;
        gender?: string | null;
        dateOfBirth?: Date | null;
      };
    },
    familyOwnerUserId?: string,
  ) {
    const accepted = member.status === 'accepted';
    const ownerUserId = familyOwnerUserId ?? member.family?.ownerUserId;
    const minor = isMinor(member.profile?.dateOfBirth);
    const effectiveCareRecipient = isEffectiveCareRecipient(member);
    const isHired = Boolean(member.isHired);
    return {
      id: member.id,
      familyId: member.familyId,
      userId: member.userId,
      familyLabel: member.familyLabel,
      displayName: member.displayName,
      status: member.status,
      isOwner: ownerUserId ? ownerUserId === member.userId : false,
      canManageCare: Boolean(member.canManageCare),
      isCareRecipient: effectiveCareRecipient,
      isMinor: minor,
      isHired,
      careScopeMemberIds: isHired
        ? (member.careScopes ?? []).map((scope) => scope.targetMemberId)
        : [],
      locationSharingEnabled: effectiveCareRecipient
        ? true
        : Boolean(member.locationSharingEnabled ?? true),
      invitedAt: member.invitedAt,
      acceptedAt: member.acceptedAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      profile: {
        id: member.profile.id,
        fullName: member.profile.fullName,
        avatarUrl: member.profile.avatarUrl,
        gender: accepted ? (member.profile.gender ?? null) : null,
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
