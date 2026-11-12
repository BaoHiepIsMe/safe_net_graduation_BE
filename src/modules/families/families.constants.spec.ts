import {
  FAMILY_LABELS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  deriveRoleFromLabel,
  invitationCutoff,
  invitationExpiresAt,
} from './families.constants';

describe('families constants', () => {
  it.each([
    ['son', 'child'],
    ['daughter', 'child'],
    ['grandfather', 'elder'],
    ['grandmother', 'elder'],
    ['father', 'adult'],
    ['mother', 'adult'],
    ['caregiver', 'adult'],
    ['other', 'adult'],
  ] as const)('derives %s -> %s', (label, role) => {
    expect(deriveRoleFromLabel(label)).toBe(role);
  });

  it('covers every label and never derives manager', () => {
    for (const label of FAMILY_LABELS) {
      expect(['adult', 'child', 'elder']).toContain(deriveRoleFromLabel(label));
    }
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
