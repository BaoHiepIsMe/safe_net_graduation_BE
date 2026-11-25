import {
  FAMILY_LABELS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  MEMBERSHIP_STATUSES,
  invitationCutoff,
  invitationExpiresAt,
} from './families.constants';

describe('families constants', () => {
  it('includes the new relationship labels and requested membership status', () => {
    for (const label of [
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
    ] as const) {
      expect(FAMILY_LABELS).toContain(label);
    }
    expect(MEMBERSHIP_STATUSES).toContain('requested');
  });

  it('invite alphabet has no look-alike characters', () => {
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[0O1IL]/);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(
      INVITE_CODE_ALPHABET.length,
    );
    expect(INVITE_CODE_LENGTH).toBe(8);
  });

  it('expires an invitation 7 days after it was sent', () => {
    const sent = new Date('2026-01-01T00:00:00Z');
    expect(invitationExpiresAt(sent).toISOString()).toBe(
      '2026-01-08T00:00:00.000Z',
    );
    expect(invitationCutoff(new Date('2026-01-08T00:00:00Z'))).toEqual(sent);
  });
});
