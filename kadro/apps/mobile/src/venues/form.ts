import { normalizeMessage } from '../calls/form';
import { MATCH_LIMITS, type MatchValidationKey, parseLira, searchIssue } from '../matches/form';
import {
  type CreateReviewRequest,
  type CreateVenueRequest,
  type GeoPoint,
  type VenueFeature,
  type VenueFeatures,
} from './contracts';

/**
 * Client-side checks of the venue forms. They mirror `packages/contracts`
 * (`createVenueRequestSchema`, `createReviewRequestSchema`, `venueParamsSchema` and `LIMITS`:
 * name 2..120, address up to 200, phone 7..20 digits / spaces / leading `+`, prices in kuruş up
 * to the match fee limit, review rating 1..5 and plain text up to 500 characters); tests compare
 * the two. The venue search uses the match form's rule (`searchIssue`, 2..60 characters), the
 * same `GET venues?q=` limit. The server stays the authority.
 */
export const VENUE_LIMITS = {
  nameMin: 2,
  nameMax: 120,
  addressMax: 200,
  phoneMin: 7,
  phoneMax: 20,
  priceMaxMinor: MATCH_LIMITS.feeMaxMinor,
  reviewTextMax: 500,
  ratingMin: 1,
  ratingMax: 5,
} as const;

export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

export const FEATURES: readonly VenueFeature[] = ['lighting', 'changingRoom', 'shower', 'parking'];

/** Keys of the `venues` namespace (`validation.*`). */
export type VenueValidationKey =
  | 'validation.nameTooShort'
  | 'validation.nameTooLong'
  | 'validation.textInvalid'
  | 'validation.districtRequired'
  | 'validation.locationInvalid'
  | 'validation.addressTooLong'
  | 'validation.phoneInvalid'
  | 'validation.indoorRequired'
  | 'validation.priceInvalid'
  | 'validation.priceTooHigh'
  | 'validation.priceOrder'
  | 'validation.ratingRequired'
  | 'validation.reviewTooLong'
  | 'validation.reviewInvalid';

const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const VISIBLE_LINE = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
const PHONE = /^\+?[0-9][0-9 ]+$/u;

/** A slug as the server assigns it (`slugSchema`): lower-case letters and digits joined by dashes. */
export function isVenueSlug(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 80 &&
    value.split('-').every((part) => /^[a-z0-9]+$/u.test(part))
  );
}

export type SearchValidationKey = Extract<MatchValidationKey, `validation.search${string}`>;

/** Why a `GET venues?q=` term cannot be sent (the match form's venue search rule), or `null`. */
export function venueSearchIssue(raw: string): SearchValidationKey | null {
  return searchIssue(raw) as SearchValidationKey | null;
}

export function nameIssue(raw: string): VenueValidationKey | null {
  const text = raw.trim();
  if (text.length < VENUE_LIMITS.nameMin) {
    return 'validation.nameTooShort';
  }
  if (text.length > VENUE_LIMITS.nameMax) {
    return 'validation.nameTooLong';
  }
  return HIDDEN_CHARACTERS.test(text) ? 'validation.textInvalid' : null;
}

export function addressIssue(raw: string): VenueValidationKey | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  if (text.length > VENUE_LIMITS.addressMax) {
    return 'validation.addressTooLong';
  }
  return HIDDEN_CHARACTERS.test(text) ? 'validation.textInvalid' : null;
}

export function phoneIssue(raw: string): VenueValidationKey | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  return text.length < VENUE_LIMITS.phoneMin ||
    text.length > VENUE_LIMITS.phoneMax ||
    !PHONE.test(text)
    ? 'validation.phoneInvalid'
    : null;
}

// eslint-disable-next-line security/detect-unsafe-regex -- anchored, one optional sign and decimal group
const COORDINATE = /^[-+]?\d{1,3}(\.\d{1,8})?$/u;

/**
 * "40.98765, 29.02345" (latitude, longitude in decimal degrees, as a map app copies them) as a
 * point; `null` when it is not two coordinates in range. A decimal comma is not accepted, the
 * comma separates the two numbers.
 */
export function parseLocation(raw: string): GeoPoint | null {
  const parts = raw.trim().split(/\s*[,;]\s*|\s+/u);
  if (parts.length !== 2) {
    return null;
  }
  const [latText = '', lngText = ''] = parts;
  if (!COORDINATE.test(latText) || !COORDINATE.test(lngText)) {
    return null;
  }
  const latitude = Number(latText);
  const longitude = Number(lngText);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }
  return { latitude, longitude };
}

/** Optional price in lira; `undefined` when empty. */
function parsePrice(raw: string): { minor?: number; issue: VenueValidationKey | null } {
  if (raw.trim() === '') {
    return { issue: null };
  }
  const minor = parseLira(raw);
  if (minor === null) {
    return { issue: 'validation.priceInvalid' };
  }
  return minor > VENUE_LIMITS.priceMaxMinor
    ? { issue: 'validation.priceTooHigh' }
    : { minor, issue: null };
}

/** What the add-venue form holds before checking. */
export interface VenueDraft {
  readonly name: string;
  readonly districtId: string | null;
  readonly location: string;
  readonly address: string;
  readonly phone: string;
  readonly indoor: boolean | null;
  /** `true` / `false` when known; a feature left unknown is not sent. */
  readonly features: Readonly<Partial<Record<VenueFeature, boolean>>>;
  readonly priceMin: string;
  readonly priceMax: string;
}

export const EMPTY_VENUE_DRAFT: VenueDraft = {
  name: '',
  districtId: null,
  location: '',
  address: '',
  phone: '',
  indoor: null,
  features: {},
  priceMin: '',
  priceMax: '',
};

export type VenueDraftField =
  'name' | 'districtId' | 'location' | 'address' | 'phone' | 'indoor' | 'priceMin' | 'priceMax';

export type VenueDraftResult =
  | { readonly ok: true; readonly body: CreateVenueRequest }
  | { readonly ok: false; readonly issues: Partial<Record<VenueDraftField, VenueValidationKey>> };

/** The `POST venues` body, or every field issue at once. Nothing is sent while one is open. */
export function venueBody(draft: VenueDraft): VenueDraftResult {
  const issues: Partial<Record<VenueDraftField, VenueValidationKey>> = {};
  const name = nameIssue(draft.name);
  if (name !== null) {
    issues.name = name;
  }
  if (draft.districtId === null) {
    issues.districtId = 'validation.districtRequired';
  }
  const location = parseLocation(draft.location);
  if (location === null) {
    issues.location = 'validation.locationInvalid';
  }
  const address = addressIssue(draft.address);
  if (address !== null) {
    issues.address = address;
  }
  const phone = phoneIssue(draft.phone);
  if (phone !== null) {
    issues.phone = phone;
  }
  if (draft.indoor === null) {
    issues.indoor = 'validation.indoorRequired';
  }
  const min = parsePrice(draft.priceMin);
  const max = parsePrice(draft.priceMax);
  if (min.issue !== null) {
    issues.priceMin = min.issue;
  }
  if (max.issue !== null) {
    issues.priceMax = max.issue;
  }
  if (min.minor !== undefined && max.minor !== undefined && min.minor > max.minor) {
    issues.priceMin = 'validation.priceOrder';
  }
  if (
    Object.keys(issues).length > 0 ||
    draft.districtId === null ||
    location === null ||
    draft.indoor === null
  ) {
    return { ok: false, issues };
  }
  const features: VenueFeatures = {};
  for (const feature of FEATURES) {
    // eslint-disable-next-line security/detect-object-injection -- feature is a typed VenueFeature
    const value = draft.features[feature];
    if (value !== undefined) {
      // eslint-disable-next-line security/detect-object-injection -- feature is a typed VenueFeature
      features[feature] = value;
    }
  }
  const address_ = draft.address.trim();
  const phone_ = draft.phone.trim();
  return {
    ok: true,
    body: {
      name: draft.name.trim(),
      districtId: draft.districtId,
      location,
      ...(address_ === '' ? {} : { address: address_ }),
      ...(phone_ === '' ? {} : { phone: phone_ }),
      indoor: draft.indoor,
      features,
      ...(min.minor === undefined ? {} : { priceMinMinor: min.minor }),
      ...(max.minor === undefined ? {} : { priceMaxMinor: max.minor }),
    },
  };
}

export function reviewTextIssue(raw: string): VenueValidationKey | null {
  const text = normalizeMessage(raw);
  if (text === undefined) {
    return null;
  }
  // UTF-16 length, as the server's schema counts it.
  if (text.length > VENUE_LIMITS.reviewTextMax) {
    return 'validation.reviewTooLong';
  }
  return text.split('\n').every((line) => VISIBLE_LINE.test(line))
    ? null
    : 'validation.reviewInvalid';
}

export type ReviewDraftResult =
  | { readonly ok: true; readonly body: CreateReviewRequest }
  | {
      readonly ok: false;
      readonly rating: VenueValidationKey | null;
      readonly text: VenueValidationKey | null;
    };

/** The `POST venues/:slug/reviews` body; an empty text sends no field. */
export function reviewBody(rating: Rating | null, rawText: string): ReviewDraftResult {
  const textIssue = reviewTextIssue(rawText);
  if (rating === null || textIssue !== null) {
    return {
      ok: false,
      rating: rating === null ? 'validation.ratingRequired' : null,
      text: textIssue,
    };
  }
  const text = normalizeMessage(rawText);
  return { ok: true, body: text === undefined ? { rating } : { rating, text } };
}
