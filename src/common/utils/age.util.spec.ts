import {
  getAgeInVietnam,
  isEffectiveCareRecipient,
  isMinor,
  isSenior,
  isUnder13,
  minorBirthDateCutoff,
  resolveUiMode,
} from './age.util';

describe('age.util (Asia/Ho_Chi_Minh)', () => {
  // 2026-11-20 01:00:00 in Ho Chi Minh is 2026-11-19T18:00:00.000Z in UTC.
  const vnNov20EarlyMorning = new Date('2026-11-19T18:00:00.000Z');

  it('returns null age and false isMinor when dateOfBirth is missing', () => {
    expect(getAgeInVietnam(null, vnNov20EarlyMorning)).toBeNull();
    expect(getAgeInVietnam(undefined, vnNov20EarlyMorning)).toBeNull();
    expect(isMinor(null, vnNov20EarlyMorning)).toBe(false);
    expect(isMinor(undefined, vnNov20EarlyMorning)).toBe(false);
  });

  it('uses Asia/Ho_Chi_Minh calendar date rather than UTC date at 18th birthday boundary', () => {
    // Born on 2008-11-20: on 2026-11-20 (VN time, even when UTC is still Nov 19), age is 18.
    expect(
      getAgeInVietnam(
        new Date('2008-11-20T00:00:00.000Z'),
        vnNov20EarlyMorning,
      ),
    ).toBe(18);
    expect(isMinor('2008-11-20', vnNov20EarlyMorning)).toBe(false);

    // Born on 2008-11-21: still 17 on 2026-11-20 in VN.
    expect(
      getAgeInVietnam(
        new Date('2008-11-21T00:00:00.000Z'),
        vnNov20EarlyMorning,
      ),
    ).toBe(17);
    expect(isMinor('2008-11-21', vnNov20EarlyMorning)).toBe(true);
  });

  it('computes a minor birth-date cutoff consistent with isMinor', () => {
    const cutoff = minorBirthDateCutoff(vnNov20EarlyMorning);
    expect(cutoff.toISOString().slice(0, 10)).toBe('2008-11-20');
    // Leap day: 2028-02-29 clamps to 2010-02-28.
    const leap = minorBirthDateCutoff(new Date('2028-02-29T05:00:00.000Z'));
    expect(leap.toISOString().slice(0, 10)).toBe('2010-02-28');
    expect(isMinor('2010-02-28', new Date('2028-02-29T05:00:00.000Z'))).toBe(
      false,
    );
    expect(isMinor('2010-03-01', new Date('2028-02-29T05:00:00.000Z'))).toBe(
      true,
    );
  });

  it('classifies under-13, minor (<18), and senior (>=60) accurately', () => {
    expect(isUnder13('2013-11-21', vnNov20EarlyMorning)).toBe(true);
    expect(isUnder13('2013-11-20', vnNov20EarlyMorning)).toBe(false);

    expect(isSenior('1966-11-20', vnNov20EarlyMorning)).toBe(true);
    expect(isSenior('1966-11-21', vnNov20EarlyMorning)).toBe(false);
  });

  it('computes effective care recipient as isMinor OR isCareRecipient flag', () => {
    expect(
      isEffectiveCareRecipient(
        { isCareRecipient: false, dateOfBirth: '2010-05-01' },
        vnNov20EarlyMorning,
      ),
    ).toBe(true);
    expect(
      isEffectiveCareRecipient(
        { isCareRecipient: true, dateOfBirth: '1980-05-01' },
        vnNov20EarlyMorning,
      ),
    ).toBe(true);
    expect(
      isEffectiveCareRecipient(
        { isCareRecipient: false, dateOfBirth: '1980-05-01' },
        vnNov20EarlyMorning,
      ),
    ).toBe(false);
    expect(
      isEffectiveCareRecipient(
        { isCareRecipient: false, dateOfBirth: null },
        vnNov20EarlyMorning,
      ),
    ).toBe(false);
  });

  it('resolves uiMode according to age rules', () => {
    expect(resolveUiMode('2015-01-01', 'adult', vnNov20EarlyMorning)).toBe(
      'kid',
    );
    expect(resolveUiMode('1960-01-01', undefined, vnNov20EarlyMorning)).toBe(
      'assisted',
    );
    expect(resolveUiMode('1960-01-01', 'adult', vnNov20EarlyMorning)).toBe(
      'adult',
    );
    expect(resolveUiMode('1995-01-01', undefined, vnNov20EarlyMorning)).toBe(
      'adult',
    );
    expect(resolveUiMode('1995-01-01', 'assisted', vnNov20EarlyMorning)).toBe(
      'assisted',
    );
  });
});
