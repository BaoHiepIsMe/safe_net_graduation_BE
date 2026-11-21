import {
  approveJoinRequestSchema,
  createInvitationSchema,
  familyIdParamSchema,
  joinFamilySchema,
  joinPreviewQuerySchema,
  transferOwnershipSchema,
  updateFamilyMemberSchema,
} from './family.dto';

describe('family request validation', () => {
  it('rejects malformed UUID params', () => {
    expect(
      familyIdParamSchema.safeParse({ familyId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects legacy role field and requires careScopeMemberIds when familyLabel is caregiver', () => {
    expect(
      createInvitationSchema.safeParse({
        email: 'user@example.com',
        familyLabel: 'other',
        role: 'manager',
      }).success,
    ).toBe(false);

    expect(
      createInvitationSchema.safeParse({
        email: 'user@example.com',
        familyLabel: 'caregiver',
      }).success,
    ).toBe(false);

    expect(
      createInvitationSchema.safeParse({
        email: 'user@example.com',
        familyLabel: 'caregiver',
        careScopeMemberIds: ['11111111-1111-4111-8111-111111111111'],
      }).success,
    ).toBe(true);

    expect(
      createInvitationSchema.safeParse({
        email: 'user@example.com',
        familyLabel: 'father',
        careScopeMemberIds: ['11111111-1111-4111-8111-111111111111'],
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

  it('rejects status transitions and unknown body fields on member update', () => {
    expect(
      updateFamilyMemberSchema.safeParse({
        status: 'accepted',
        ownerUserId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
    expect(
      updateFamilyMemberSchema.safeParse({
        role: 'manager',
      }).success,
    ).toBe(false);
  });

  it('leaves isCareRecipient undefined when omitted on invitation (3-state auto)', () => {
    const parsed = createInvitationSchema.parse({
      email: 'user@example.com',
      familyLabel: 'grandmother',
    });
    expect(parsed.isCareRecipient).toBeUndefined();
    expect(parsed.canManageCare).toBeUndefined();
  });

  it('supports new relationship labels', () => {
    for (const familyLabel of [
      'husband',
      'wife',
      'brother',
      'sister',
      'grandchild',
    ] as const) {
      expect(
        createInvitationSchema.safeParse({
          email: 'user@example.com',
          familyLabel,
        }).success,
      ).toBe(true);
    }
  });

  it('validates join preview, join, approve join request, and transfer bodies', () => {
    expect(
      joinPreviewQuerySchema.safeParse({ code: ' ABCD2345 ' }).success,
    ).toBe(true);
    expect(
      joinFamilySchema.safeParse({ code: ' abc ', familyLabel: 'son' }).success,
    ).toBe(true);
    expect(
      joinFamilySchema.safeParse({ code: '', familyLabel: 'son' }).success,
    ).toBe(false);
    expect(
      joinFamilySchema.safeParse({ code: 'ABC', familyLabel: 'boss' }).success,
    ).toBe(false);
    expect(
      approveJoinRequestSchema.safeParse({
        canManageCare: true,
        isCareRecipient: false,
      }).success,
    ).toBe(true);
    expect(transferOwnershipSchema.safeParse({ memberId: 'x' }).success).toBe(
      false,
    );
  });
});
