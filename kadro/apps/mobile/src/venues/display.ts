import { type VenueFeature, type VenueFeatures, type VenueRating } from './contracts';
import { FEATURES } from './form';

/**
 * Fewest reviews for which an average rating is shown (ADR-0038: the aggregate rating is shown,
 * and emitted as JSON-LD on the web, only with at least 3 reviews). Every screen reads it here.
 */
export const RATING_MIN_REVIEWS = 3;

export type RatingView =
  | { readonly kind: 'none' }
  | { readonly kind: 'few'; readonly count: number }
  | { readonly kind: 'average'; readonly average: number; readonly count: number };

/** How a venue's rating is shown: no reviews, too few for an average, or the average. */
export function ratingView(rating: VenueRating): RatingView {
  if (rating.count === 0) {
    return { kind: 'none' };
  }
  if (rating.count < RATING_MIN_REVIEWS || rating.average === null) {
    return { kind: 'few', count: rating.count };
  }
  return { kind: 'average', average: rating.average, count: rating.count };
}

/** `4,3` / `4.3`: one decimal, in the reader's language. */
export function formatRating(average: number, language: string): string {
  return average.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const PHONE = /^\+?[0-9][0-9 ]{6,19}$/u;

/**
 * `tel:` link of a venue phone number, or `null` when the stored value is not a plain number
 * (then it is shown as text only). Only digits and a leading `+` reach the link.
 */
export function telHref(phone: string | null): string | null {
  if (phone === null) {
    return null;
  }
  const text = phone.trim();
  if (!PHONE.test(text)) {
    return null;
  }
  return `tel:${text.replaceAll(' ', '')}`;
}

/** Features in a fixed order, split into present, absent and unknown (key not set). */
export function featureList(features: VenueFeatures): {
  readonly present: VenueFeature[];
  readonly absent: VenueFeature[];
  readonly unknown: VenueFeature[];
} {
  // eslint-disable-next-line security/detect-object-injection -- feature is a typed VenueFeature
  const value = (feature: VenueFeature) => features[feature];
  return {
    present: FEATURES.filter((feature) => value(feature) === true),
    absent: FEATURES.filter((feature) => value(feature) === false),
    unknown: FEATURES.filter((feature) => value(feature) === undefined),
  };
}
