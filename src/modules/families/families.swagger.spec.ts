import {
  createFamilySuccessSchema,
  familyDataSchema,
  familyMemberDataSchema,
  paginatedSuccessSchema,
  inviteCodeSuccessSchema,
  joinFamilyBodySchema,
  pendingInvitationDataSchema,
  sentInvitationDataSchema,
  transferOwnershipBodySchema,
} from './families.swagger';

describe('Phase 2 Swagger schemas', () => {
  it('documents concrete family and initial membership fields', () => {
    expect(familyDataSchema.properties).toEqual(
      expect.objectContaining({
        id: expect.any(Object),
        familyName: expect.any(Object),
        ownerUserId: expect.any(Object),
      }),
    );
    expect(createFamilySuccessSchema.properties.data.properties).toHaveProperty(
      'membership',
    );
  });

  it('documents member, invitation and pagination payloads', () => {
    expect(familyMemberDataSchema.properties).toHaveProperty('profile');
    expect(pendingInvitationDataSchema.properties).toHaveProperty('family');
    expect(
      paginatedSuccessSchema(familyMemberDataSchema).properties,
    ).toHaveProperty('pagination');
  });

  it('documents invite codes, sent invitations, join and transfer', () => {
    expect(inviteCodeSuccessSchema.properties.data.properties).toHaveProperty(
      'expiresAt',
    );
    expect(sentInvitationDataSchema.properties).toHaveProperty('isExpired');
    expect(pendingInvitationDataSchema.properties).toHaveProperty('expiresAt');
    expect(joinFamilyBodySchema.required).toEqual(['code', 'familyLabel']);
    expect(transferOwnershipBodySchema.required).toEqual(['memberId']);
  });
});
