export const FAMILY_ROLES = ['manager', 'adult', 'child', 'elder'] as const;

export const INVITABLE_FAMILY_ROLES = ['adult', 'child', 'elder'] as const;

export const MEMBERSHIP_STATUSES = [
  'pending',
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
] as const;

export const ACTIVE_FAMILY_STATUS = 'active';
export const ARCHIVED_FAMILY_STATUS = 'archived';
