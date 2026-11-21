export const MEMBERSHIP_STATUSES = [
  'pending',
  'requested',
  'accepted',
  'rejected',
  'removed',
] as const;

export const FAMILY_LABELS = [
  'father',
  'mother',
  'son',
  'daughter',
  'grandfather',
  'grandmother',
  'caregiver',
  'other',
  'husband',
  'wife',
  'brother',
  'sister',
  'grandchild',
] as const;

export type FamilyLabelType = (typeof FAMILY_LABELS)[number];

export const ACTIVE_FAMILY_STATUS = 'active';
export const ARCHIVED_FAMILY_STATUS = 'archived';

export const INVITATION_TTL_DAYS = 7;
export const INVITE_CODE_TTL_DAYS = 7;
// No 0/O/1/I/L: codes are read aloud and typed by hand.
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Invitations and join requests expire INVITATION_TTL_DAYS after the last send (`invitedAt`). */
export function invitationExpiresAt(invitedAt: Date): Date {
  return new Date(invitedAt.getTime() + INVITATION_TTL_DAYS * DAY_MS);
}

/** Oldest `invitedAt` that is still valid at [now]. */
export function invitationCutoff(now: Date): Date {
  return new Date(now.getTime() - INVITATION_TTL_DAYS * DAY_MS);
}

export function inviteCodeExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITE_CODE_TTL_DAYS * DAY_MS);
}
