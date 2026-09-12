import {
  createInvitationSchema,
  familyIdParamSchema,
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
});
