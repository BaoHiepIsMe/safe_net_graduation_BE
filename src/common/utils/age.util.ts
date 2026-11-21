export const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
export const KID_UI_MAX_AGE = 13;
export const MINOR_MAX_AGE = 18;
export const SENIOR_MIN_AGE = 60;

export type UiMode = 'kid' | 'adult' | 'assisted';

const vietnamDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: VIETNAM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parseBirthCalendarDate(
  dateOfBirth: Date | string | null | undefined,
): { year: number; month: number; day: number } | null {
  if (!dateOfBirth) return null;

  if (typeof dateOfBirth === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth.trim());
    if (match) {
      return {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      };
    }
    const parsed = new Date(dateOfBirth);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
      year: parsed.getUTCFullYear(),
      month: parsed.getUTCMonth() + 1,
      day: parsed.getUTCDate(),
    };
  }

  if (Number.isNaN(dateOfBirth.getTime())) return null;
  return {
    year: dateOfBirth.getUTCFullYear(),
    month: dateOfBirth.getUTCMonth() + 1,
    day: dateOfBirth.getUTCDate(),
  };
}

function getVietnamCalendarDate(now: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = vietnamDateFormatter.formatToParts(now);
  let year = 0;
  let month = 0;
  let day = 0;
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
  }
  return { year, month, day };
}

/**
 * Computes completed calendar years of age using the calendar date in
 * `Asia/Ho_Chi_Minh`. Returns `null` when `dateOfBirth` is missing or invalid.
 */
export function getAgeInVietnam(
  dateOfBirth: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const birth = parseBirthCalendarDate(dateOfBirth);
  if (!birth) return null;

  const today = getVietnamCalendarDate(now);
  let age = today.year - birth.year;
  if (
    today.month < birth.month ||
    (today.month === birth.month && today.day < birth.day)
  ) {
    age -= 1;
  }
  return age;
}

/**
 * Returns `true` if the person is under 18 in `Asia/Ho_Chi_Minh`.
 * Missing `dateOfBirth` is treated as NOT a minor.
 */
export function isMinor(
  dateOfBirth: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const age = getAgeInVietnam(dateOfBirth, now);
  return age !== null && age < MINOR_MAX_AGE;
}

/**
 * Birth-date cutoff for SQL filters: a person is a minor (< 18 in
 * `Asia/Ho_Chi_Minh`) exactly when `date_of_birth > cutoff`. Returns the
 * cutoff as a UTC-midnight Date (Feb 29 clamps to Feb 28).
 */
export function minorBirthDateCutoff(now: Date = new Date()): Date {
  const today = getVietnamCalendarDate(now);
  const year = today.year - MINOR_MAX_AGE;
  const lastDayOfMonth = new Date(Date.UTC(year, today.month, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, today.month - 1, Math.min(today.day, lastDayOfMonth)),
  );
}

export function isUnder13(
  dateOfBirth: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const age = getAgeInVietnam(dateOfBirth, now);
  return age !== null && age < KID_UI_MAX_AGE;
}

export function isSenior(
  dateOfBirth: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const age = getAgeInVietnam(dateOfBirth, now);
  return age !== null && age >= SENIOR_MIN_AGE;
}

export function isEffectiveCareRecipient(
  target: {
    isCareRecipient?: boolean | null;
    dateOfBirth?: Date | string | null;
    profile?: { dateOfBirth?: Date | string | null } | null;
  },
  now: Date = new Date(),
): boolean {
  const dob =
    target.dateOfBirth !== undefined
      ? target.dateOfBirth
      : target.profile?.dateOfBirth;
  return isMinor(dob, now) || Boolean(target.isCareRecipient);
}

export function resolveUiMode(
  dateOfBirth: Date | string | null | undefined,
  requestedUiMode?: 'adult' | 'assisted' | null,
  now: Date = new Date(),
): UiMode {
  if (isUnder13(dateOfBirth, now)) return 'kid';
  if (requestedUiMode === 'adult' || requestedUiMode === 'assisted') {
    return requestedUiMode;
  }
  if (isSenior(dateOfBirth, now)) return 'assisted';
  return 'adult';
}
