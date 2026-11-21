import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { ForbiddenError } from '../../common/errors/app.error';
import { isEffectiveCareRecipient } from '../../common/utils/age.util';
import { isWithinHiredScope } from './care-scope.util';
import { ACTIVE_FAMILY_STATUS } from './families.constants';
import { FamiliesRepository } from './families.repository';

@Injectable()
export class FamilyAccessService {
  constructor(private readonly familiesRepository: FamiliesRepository) {}

  async requireAcceptedMember(userId: string, familyId: string) {
    const membership = await this.familiesRepository.findAccessMembership(
      userId,
      familyId,
    );
    if (
      !membership ||
      membership.status !== 'accepted' ||
      membership.family.status !== ACTIVE_FAMILY_STATUS
    ) {
      throw new ForbiddenError(
        'Bạn không có quyền truy cập gia đình này',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return membership;
  }

  /**
   * Requires `can_manage_care = true` (including hired caregivers).
   */
  async requireCareManager(userId: string, familyId: string) {
    const membership = await this.requireAcceptedMember(userId, familyId);
    if (!membership.canManageCare) {
      throw new ForbiddenError(
        'Chỉ quản lý gia đình được thực hiện thao tác này',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return membership;
  }

  /**
   * Requires a full family manager (`can_manage_care = true` and not hired)
   * OR the family owner (even if the owner has label `caregiver` / `is_hired`).
   */
  async requireFamilyAdmin(userId: string, familyId: string) {
    const membership = await this.requireAcceptedMember(userId, familyId);
    const isOwner = membership.family.ownerUserId === userId;
    const isFullManager =
      Boolean(membership.canManageCare) && !membership.isHired;
    if (!isOwner && !isFullManager) {
      throw new ForbiddenError(
        'Chỉ chủ nhóm hoặc quản lý chính thức được thực hiện thao tác này',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return membership;
  }

  async requireOwner(userId: string, familyId: string) {
    const membership = await this.requireAcceptedMember(userId, familyId);
    if (membership.family?.ownerUserId !== userId) {
      throw new ForbiddenError(
        'Chỉ chủ nhóm được thực hiện thao tác này',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return membership;
  }

  async evaluateCanManage(
    actorUserId: string,
    targetMemberId: string,
    expectedFamilyId?: string,
  ) {
    const target =
      await this.familiesRepository.findMemberForAccess(targetMemberId);
    if (
      !target ||
      target.status !== 'accepted' ||
      target.family?.status !== ACTIVE_FAMILY_STATUS ||
      (expectedFamilyId !== undefined && target.familyId !== expectedFamilyId)
    ) {
      return null;
    }

    const actor = await this.familiesRepository.findAccessMembership(
      actorUserId,
      target.familyId,
    );
    if (
      !actor ||
      actor.status !== 'accepted' ||
      actor.family.status !== ACTIVE_FAMILY_STATUS ||
      actor.familyId !== target.familyId
    ) {
      return null;
    }

    if (!actor.canManageCare) return null;
    if (actor.userId === target.userId) return null;
    if (!isEffectiveCareRecipient(target)) return null;
    if (!isWithinHiredScope(actor, target.id)) return null;

    return { actor, target };
  }

  async canManage(
    actorUserId: string,
    targetMemberId: string,
    expectedFamilyId?: string,
  ): Promise<boolean> {
    const context = await this.evaluateCanManage(
      actorUserId,
      targetMemberId,
      expectedFamilyId,
    );
    return context !== null;
  }

  async requireCanManage(
    actorUserId: string,
    targetMemberId: string,
    expectedFamilyId?: string,
  ) {
    const context = await this.evaluateCanManage(
      actorUserId,
      targetMemberId,
      expectedFamilyId,
    );
    if (!context) {
      throw new ForbiddenError(
        'Bạn không có quyền quản lý thành viên này',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return context;
  }

  /**
   * Lists all accepted managers in the target member's active family who
   * satisfy `canManage(manager, target)`. Used for geofence and missed-reminder alerts.
   */
  async listManagersFor(targetMemberId: string) {
    const target =
      await this.familiesRepository.findMemberForAccess(targetMemberId);
    if (
      !target ||
      target.status !== 'accepted' ||
      target.family?.status !== ACTIVE_FAMILY_STATUS ||
      !isEffectiveCareRecipient(target)
    ) {
      return [];
    }

    const candidates =
      await this.familiesRepository.findAcceptedCareManagersInFamily(
        target.familyId,
      );
    return candidates.filter(
      (actor) =>
        actor.userId !== target.userId &&
        isWithinHiredScope({ ...actor, family: target.family }, target.id),
    );
  }
}
