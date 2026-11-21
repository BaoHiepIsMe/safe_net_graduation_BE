import { minorBirthDateCutoff } from '../../common/utils/age.util';
import { Prisma } from '../../generated/prisma/client';

/**
 * Care-scope rule shared by every module: a hired caregiver who is not the
 * family owner only reaches the members listed in their care scope.
 * Everyone else (including a hired owner) is unrestricted by scope.
 */
export interface HiredScopeActor {
  userId: string;
  isHired?: boolean | null;
  careScopes?: ReadonlyArray<{ targetMemberId: string }> | null;
  family?: { ownerUserId: string } | null;
}

/** Member ids the actor is limited to, or `null` when the actor is not limited. */
export function hiredScopeMemberIds(
  actor: HiredScopeActor,
): Set<string> | null {
  if (!actor.isHired || actor.family?.ownerUserId === actor.userId) {
    return null;
  }
  return new Set((actor.careScopes ?? []).map((scope) => scope.targetMemberId));
}

export function isWithinHiredScope(
  actor: HiredScopeActor,
  targetMemberId: string,
): boolean {
  const scope = hiredScopeMemberIds(actor);
  return scope === null || scope.has(targetMemberId);
}

/**
 * Prisma filter for an effective care recipient: `is_care_recipient` or
 * under 18 in `Asia/Ho_Chi_Minh` (missing date of birth is not a minor).
 */
export function effectiveCareRecipientWhere(
  now: Date = new Date(),
): Prisma.FamilyMemberWhereInput {
  return {
    OR: [
      { isCareRecipient: true },
      { profile: { dateOfBirth: { gt: minorBirthDateCutoff(now) } } },
    ],
  };
}

/**
 * User ids of accepted care managers in [familyId] who may manage the target
 * member (not the target themselves, hired caregivers only within scope).
 * The caller must already know the target is an effective care recipient.
 */
export async function findCareManagerUserIds(
  db: Prisma.TransactionClient,
  familyId: string,
  target: { memberId: string; userId: string },
): Promise<string[]> {
  const managers = await db.familyMember.findMany({
    where: {
      familyId,
      status: 'accepted',
      canManageCare: true,
      userId: { not: target.userId },
      family: { status: 'active' },
    },
    select: {
      userId: true,
      isHired: true,
      careScopes: { select: { targetMemberId: true } },
      family: { select: { ownerUserId: true } },
    },
  });
  return [
    ...new Set(
      managers
        .filter((manager) => isWithinHiredScope(manager, target.memberId))
        .map((manager) => manager.userId),
    ),
  ];
}
