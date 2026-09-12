import { Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/constants/error-codes';
import { ForbiddenError } from '../../common/errors/app.error';
import { FamiliesRepository } from './families.repository';

@Injectable()
export class FamilyAccessService {
  constructor(private readonly familiesRepository: FamiliesRepository) {}

  async requireAcceptedMember(userId: string, familyId: string) {
    const membership = await this.familiesRepository.findAccessMembership(
      userId,
      familyId,
    );
    if (!membership) {
      throw new ForbiddenError(
        'Bạn không có quyền truy cập gia đình này',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return membership;
  }

  async requireManager(userId: string, familyId: string) {
    const membership = await this.requireAcceptedMember(userId, familyId);
    if (membership.role !== 'manager') {
      throw new ForbiddenError(
        'Chỉ quản lý gia đình được thực hiện thao tác này',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return membership;
  }

  async requireOwner(userId: string, familyId: string) {
    const membership = await this.requireManager(userId, familyId);
    if (membership.family.ownerUserId !== userId) {
      throw new ForbiddenError(
        'Chỉ chủ sở hữu được lưu trữ gia đình',
        ErrorCode.FAMILY_ACCESS_DENIED,
      );
    }
    return membership;
  }
}
