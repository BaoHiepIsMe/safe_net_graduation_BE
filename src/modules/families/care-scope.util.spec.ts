import { hiredScopeMemberIds, isWithinHiredScope } from './care-scope.util';

describe('care-scope.util', () => {
  const family = { ownerUserId: 'owner' };

  it('does not limit non-hired members', () => {
    const actor = { userId: 'a', isHired: false, family };
    expect(hiredScopeMemberIds(actor)).toBeNull();
    expect(isWithinHiredScope(actor, 'any-member')).toBe(true);
  });

  it('does not limit a hired caregiver who owns the family', () => {
    const actor = { userId: 'owner', isHired: true, careScopes: [], family };
    expect(hiredScopeMemberIds(actor)).toBeNull();
    expect(isWithinHiredScope(actor, 'any-member')).toBe(true);
  });

  it('limits a hired non-owner caregiver to their scope', () => {
    const actor = {
      userId: 'nurse',
      isHired: true,
      careScopes: [{ targetMemberId: 'grandma' }],
      family,
    };
    expect(isWithinHiredScope(actor, 'grandma')).toBe(true);
    expect(isWithinHiredScope(actor, 'grandpa')).toBe(false);
  });
});
