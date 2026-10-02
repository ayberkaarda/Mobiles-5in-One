import { earliestExpiry } from './permissions';
import { type DistrictPublic, type Level, type Position } from './contracts';

/**
 * Client-side checks of the open-call forms. They mirror `packages/contracts`
 * (`createApplicationRequestSchema`: plain text up to `LIMITS.applicationMessage.max` = 280
 * characters without control characters; `publishOpenCallRequestSchema` and ADR-0037:
 * `now + 15 min ≤ expiresAt ≤ starts_at`); a test compares the two. The server stays the
 * authority.
 */
export const APPLICATION_MESSAGE_MAX = 280;

export const LEVEL_OPTIONS: readonly Level[] = ['casual', 'regular', 'competitive'];
export const POSITION_OPTIONS: readonly Position[] = ['GK', 'DEF', 'MID', 'FWD'];

/** Keys of the `opencalls` namespace (`validation.*`). */
export type CallValidationKey =
  | 'validation.messageTooLong'
  | 'validation.messageInvalid'
  | 'validation.missingInvalid'
  | 'validation.expiryInvalid';

const VISIBLE_LINE = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;

/** The message as the server stores it: line breaks normalized, trimmed; `undefined` if empty. */
export function normalizeMessage(raw: string): string | undefined {
  const text = raw.replace(/\r\n?/gu, '\n').trim();
  return text === '' ? undefined : text;
}

export function messageIssue(raw: string): CallValidationKey | null {
  const text = normalizeMessage(raw);
  if (text === undefined) {
    return null;
  }
  // UTF-16 length, as the server's schema counts it.
  if (text.length > APPLICATION_MESSAGE_MAX) {
    return 'validation.messageTooLong';
  }
  return text.split('\n').every((line) => VISIBLE_LINE.test(line))
    ? null
    : 'validation.messageInvalid';
}

/** When a published call stops taking applications, relative to the match start. */
export const EXPIRY_CHOICES = ['kickoff', 'hour1', 'hours3', 'hours24'] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

const HOUR_MS = 60 * 60 * 1000;
const EXPIRY_BEFORE_START_MS: Readonly<Record<ExpiryChoice, number>> = {
  kickoff: 0,
  hour1: HOUR_MS,
  hours3: 3 * HOUR_MS,
  hours24: 24 * HOUR_MS,
};

export { EXPIRY_SLACK_MS } from './permissions';

export function expiryInstant(startsAt: string, choice: ExpiryChoice): number {
  // eslint-disable-next-line security/detect-object-injection -- choice is a typed ExpiryChoice
  return Date.parse(startsAt) - EXPIRY_BEFORE_START_MS[choice];
}

/** Choices whose instant lies in `[earliestExpiry(now), starts_at]`. */
export function availableExpiries(startsAt: string, now: number): ExpiryChoice[] {
  return EXPIRY_CHOICES.filter((choice) => expiryInstant(startsAt, choice) >= earliestExpiry(now));
}

/** One hour before the start when that is possible, else the latest possible: the start. */
export function defaultExpiry(startsAt: string, now: number): ExpiryChoice | null {
  const available = availableExpiries(startsAt, now);
  if (available.includes('hour1')) {
    return 'hour1';
  }
  return available[0] ?? null;
}

export function missingIssue(value: number | null, max: number): CallValidationKey | null {
  return value === null || !Number.isInteger(value) || value < 1 || value > max
    ? 'validation.missingInvalid'
    : null;
}

/** Turkish-aware, accent-insensitive comparison form ("Kadıköy" ~ "kadikoy"). */
export function searchForm(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replaceAll('ı', 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

export const DISTRICT_SEARCH_MIN = 2;
export const DISTRICT_SEARCH_RESULTS = 8;

/** Districts whose name or province starts a word with the search text, best matches first. */
export function searchDistricts(
  districts: readonly DistrictPublic[],
  raw: string,
): DistrictPublic[] {
  const needle = searchForm(raw);
  if (needle.length < DISTRICT_SEARCH_MIN) {
    return [];
  }
  const startsWord = (text: string): boolean =>
    searchForm(text)
      .split(/[\s-]+/u)
      .some((word) => word.startsWith(needle));
  const byName = districts.filter((district) => startsWord(district.name));
  const byProvince = districts.filter(
    (district) => !byName.includes(district) && startsWord(district.province),
  );
  return [...byName, ...byProvince].slice(0, DISTRICT_SEARCH_RESULTS);
}

/** "Kadıköy, İstanbul"; `null` when the district is not in the list. */
export function districtLabel(
  districts: readonly DistrictPublic[] | undefined,
  districtId: string,
): string | null {
  const district = districts?.find((entry) => entry.id === districtId);
  return district === undefined ? null : `${district.name}, ${district.province}`;
}
