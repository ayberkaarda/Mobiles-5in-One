import { type MatchFormat } from './contracts';

/**
 * Client-side checks of the match form. They mirror `createMatchRequestSchema` and `LIMITS` in
 * `packages/contracts` (fee 0..1,000,000.00 TRY in kuruş, slots 2..30, free-text venue 2..200
 * visible characters, venue search 2..60); a test compares the two. The server stays the
 * authority (a start in the past, a venue it cannot read, frozen terms).
 */
export const MATCH_LIMITS = {
  feeMinMinor: 0,
  feeMaxMinor: 1_000_000_00,
  slotsMin: 2,
  slotsMax: 30,
  venueTextMin: 2,
  venueTextMax: 200,
  searchMin: 2,
  searchMax: 60,
} as const;

export const MATCH_FORMATS: readonly MatchFormat[] = ['5v5', '6v6', '7v7', '8v8'];

/** Slots suggested for a format: both sides full, no substitutes. */
export const DEFAULT_SLOTS: Readonly<Record<MatchFormat, number>> = {
  '5v5': 10,
  '6v6': 12,
  '7v7': 14,
  '8v8': 16,
};

/** Keys of the `matches` namespace (`validation.*`). */
export type MatchValidationKey =
  | 'validation.venueTextTooShort'
  | 'validation.venueTextTooLong'
  | 'validation.venueTextInvalid'
  | 'validation.venueRequired'
  | 'validation.dateInvalid'
  | 'validation.timeInvalid'
  | 'validation.startsInPast'
  | 'validation.slotsInvalid'
  | 'validation.feeInvalid'
  | 'validation.feeTooHigh'
  | 'validation.searchTooShort'
  | 'validation.searchTooLong'
  | 'validation.searchInvalid';

const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function venueTextIssue(raw: string): MatchValidationKey | null {
  const text = raw.trim();
  if (text.length < MATCH_LIMITS.venueTextMin) {
    return 'validation.venueTextTooShort';
  }
  if (text.length > MATCH_LIMITS.venueTextMax) {
    return 'validation.venueTextTooLong';
  }
  return HIDDEN_CHARACTERS.test(text) ? 'validation.venueTextInvalid' : null;
}

export function searchIssue(raw: string): MatchValidationKey | null {
  const text = raw.trim();
  if (text.length < MATCH_LIMITS.searchMin) {
    return 'validation.searchTooShort';
  }
  if (text.length > MATCH_LIMITS.searchMax) {
    return 'validation.searchTooLong';
  }
  return HIDDEN_CHARACTERS.test(text) ? 'validation.searchInvalid' : null;
}

// eslint-disable-next-line security/detect-unsafe-regex -- anchored, dot-delimited fixed-width groups
const GROUPED_LIRA = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- anchored, one optional decimal group
const PLAIN_LIRA = /^\d+([.,]\d{1,2})?$/u;

/**
 * Lira typed by the user, in kuruş. Accepts `1500`, `1.500` (thousands), `1500,50`,
 * `1.500,50` and `1500.50`; a currency sign and spaces are ignored. `null` when it is not an
 * amount with at most two decimals.
 */
export function parseLira(raw: string): number | null {
  const text = raw.replace(/[\s₺]/gu, '').replace(/TL$/iu, '');
  let whole: string;
  let fraction = '';
  if (GROUPED_LIRA.test(text)) {
    const [integerPart = '', decimals = ''] = text.split(',');
    whole = integerPart.replaceAll('.', '');
    fraction = decimals;
  } else if (PLAIN_LIRA.test(text)) {
    const [integerPart = '', decimals = ''] = text.split(/[.,]/u);
    whole = integerPart;
    fraction = decimals;
  } else {
    return null;
  }
  if (whole.length > 9) {
    return null;
  }
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function feeIssue(raw: string): MatchValidationKey | null {
  const minor = parseLira(raw);
  if (minor === null || minor < MATCH_LIMITS.feeMinMinor) {
    return 'validation.feeInvalid';
  }
  return minor > MATCH_LIMITS.feeMaxMinor ? 'validation.feeTooHigh' : null;
}

/** Kuruş as the form shows it for editing: `1500` or `1500,50`. */
export function liraInput(minor: number): string {
  const lira = Math.floor(minor / 100);
  const kurus = minor % 100;
  return kurus === 0 ? String(lira) : `${lira},${String(kurus).padStart(2, '0')}`;
}

export function parseSlots(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,2}$/u.test(text)) {
    return null;
  }
  const slots = Number(text);
  return slots >= MATCH_LIMITS.slotsMin && slots <= MATCH_LIMITS.slotsMax ? slots : null;
}

const DATE_INPUT = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/u;
const TIME_INPUT = /^(\d{1,2})[:.](\d{2})$/u;

/** `GG.AA.YYYY` and `SS:DD` in the device time zone; `null` for a day or time that does not exist. */
export function parseStartsAt(dateRaw: string, timeRaw: string): Date | null {
  const dateMatch = DATE_INPUT.exec(dateRaw.trim());
  const timeMatch = TIME_INPUT.exec(timeRaw.trim());
  if (dateMatch === null || timeMatch === null) {
    return null;
  }
  const [, day, month, year] = dateMatch.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  if (
    day === undefined ||
    month === undefined ||
    year === undefined ||
    hour === undefined ||
    minute === undefined ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function startsAtIssue(
  dateRaw: string,
  timeRaw: string,
  now: number = Date.now(),
): MatchValidationKey | null {
  if (!DATE_INPUT.test(dateRaw.trim())) {
    return 'validation.dateInvalid';
  }
  if (!TIME_INPUT.test(timeRaw.trim())) {
    return 'validation.timeInvalid';
  }
  const date = parseStartsAt(dateRaw, timeRaw);
  if (date === null) {
    return 'validation.dateInvalid';
  }
  return date.getTime() <= now ? 'validation.startsInPast' : null;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Date and time fields of an ISO instant in the device time zone. */
export function dateInput(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function timeInput(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
