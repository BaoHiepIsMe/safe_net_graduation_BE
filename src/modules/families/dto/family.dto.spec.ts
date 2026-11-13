import {
  createInvitationSchema,
  familyIdParamSchema,
  joinFamilySchema,
  transferOwnershipSchema,
  updateFamilyMemberSchema,
} from './family.dto';

describe('family request validation', () => {
  it('rejects malformed UUID params', () => {
    expect(
      familyIdParamSchema.safeParse({ familyId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects invalid invitation roles', () => {
    expect(
      createInvitationSchema.safeParse({
        email: 'user@example.com',
        familyLabel: 'caregiver',
        role: 'manager',
      }).success,
    ).toBe(false);
  });

  it('requires exactly one invitation lookup field', () => {
    expect(
      createInvitationSchema.safeParse({
        email: 'user@example.com',
        phoneNumber: '+84123456789',
        familyLabel: 'other',
      }).success,
    ).toBe(false);
  });

  it('rejects status transitions and unknown body fields', () => {
    expect(
      updateFamilyMemberSchema.safeParse({
        status: 'accepted',
        ownerUserId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });

  it('does not default the invitation role (the service derives it)', () => {
    const parsed = createInvitationSchema.parse({
      email: 'user@example.com',
      familyLabel: 'grandmother',
    });
    expect(parsed.role).toBeUndefined();
  });

  it('rejects role=manager on invitations with a 400-able error', () => {
    expect(
      createInvitationSchema.safeParse({
        email: 'user@example.com',
        familyLabel: 'other',
        role: 'manager',
      }).success,
    ).toBe(false);
  });

  it('validates join and transfer bodies', () => {
    expect(
      joinFamilySchema.safeParse({ code: ' abc ', familyLabel: 'son' }).success,
    ).toBe(true);
    expect(
      joinFamilySchema.safeParse({ code: '', familyLabel: 'son' }).success,
    ).toBe(false);
    expect(
      joinFamilySchema.safeParse({ code: 'ABC', familyLabel: 'boss' }).success,
    ).toBe(false);
    expect(transferOwnershipSchema.safeParse({ memberId: 'x' }).success).toBe(
      false,
    );
  });
});
