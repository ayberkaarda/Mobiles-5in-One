import { z } from 'zod';

import {
  displayNameSchema,
  idSchema,
  isoDateTimeSchema,
  multilineTextSchema,
  visibleTextSchema,
} from './common.js';
import { geoPointSchema, slugSchema } from './districts.js';
import { LIMITS } from './limits.js';
import { paginationQuerySchema } from './pagination.js';

/**
 * Venue directory (Saha Rehberi) and reviews (spec §3 story 7, authorization matrix §3.6, §4.5,
 * footnotes 23–24). `slug`, `verified`, `is_sample` and `created_by` are server-only; a venue
 * created through the API is always unverified and visible only to its creator until a moderator
 * verifies it.
 */

/** `venues.features`: a closed key set (authorization matrix §4.5); absent key = unknown. */
export const venueFeaturesSchema = z.strictObject({
  lighting: z.boolean().optional(),
  changingRoom: z.boolean().optional(),
  shower: z.boolean().optional(),
  parking: z.boolean().optional(),
});
export type VenueFeatures = z.infer<typeof venueFeaturesSchema>;
export const VENUE_FEATURES = venueFeaturesSchema.keyof().options;
export type VenueFeature = (typeof VENUE_FEATURES)[number];

const priceMinorSchema = z.int().min(0).max(LIMITS.feeTotalMinor.max);

/** Turkish or international phone number: digits, spaces and an optional leading `+`. */
export const venuePhoneSchema = z
  .string()
  .trim()
  .min(LIMITS.venuePhone.min)
  .max(LIMITS.venuePhone.max)
  .regex(/^\+?[0-9][0-9 ]+$/, 'must be a phone number');

/**
 * Path parameters `venues/:slug`, `venues/:slug/reviews` and `venues/:slug/reviews/mine`. Next.js
 * allows one dynamic segment name per path level, so the review routes address the venue by its
 * slug as well (unique and server-generated).
 */
export const venueParamsSchema = z.strictObject({ slug: slugSchema });
export type VenueParams = z.infer<typeof venueParamsSchema>;

/**
 * `GET /api/v1/venues` filters plus cursor pagination (ADR-0039): `district` (id) or `province`
 * (il slug), not both; `q` is folded with `foldTr` and matched as a substring of the folded name.
 */
export const listVenuesQuerySchema = z
  .strictObject({
    ...paginationQuerySchema.shape,
    district: idSchema.optional(),
    province: slugSchema.optional(),
    q: visibleTextSchema(LIMITS.searchQuery.min, LIMITS.searchQuery.max).optional(),
  })
  .refine((query) => query.district === undefined || query.province === undefined, {
    message: 'district and province are mutually exclusive',
    path: ['province'],
  });
export type ListVenuesQuery = z.infer<typeof listVenuesQuerySchema>;

/**
 * `POST /api/v1/venues` (verified email, rate limit V). Prices are per-hour minor units
 * (kuruş); `priceMinMinor ≤ priceMaxMinor` when both are given.
 */
export const createVenueRequestSchema = z
  .strictObject({
    name: visibleTextSchema(LIMITS.venueName.min, LIMITS.venueName.max),
    districtId: idSchema,
    location: geoPointSchema,
    address: visibleTextSchema(1, LIMITS.venueAddress.max).optional(),
    phone: venuePhoneSchema.optional(),
    indoor: z.boolean(),
    features: venueFeaturesSchema,
    priceMinMinor: priceMinorSchema.optional(),
    priceMaxMinor: priceMinorSchema.optional(),
  })
  .refine(
    (body) =>
      body.priceMinMinor === undefined ||
      body.priceMaxMinor === undefined ||
      body.priceMinMinor <= body.priceMaxMinor,
    { message: 'priceMinMinor must not exceed priceMaxMinor', path: ['priceMinMinor'] },
  );
export type CreateVenueRequest = z.infer<typeof createVenueRequestSchema>;

export const venueRatingSchema = z.strictObject({
  /** Mean rating rounded to one decimal; `null` without reviews. */
  average: z.number().min(LIMITS.reviewRating.min).max(LIMITS.reviewRating.max).nullable(),
  count: z.int().min(0),
});
export type VenueRating = z.infer<typeof venueRatingSchema>;

/** List item of `GET /api/v1/venues`. */
export const venueSummarySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(LIMITS.venueName.max),
  slug: slugSchema,
  districtId: idSchema,
  location: geoPointSchema,
  indoor: z.boolean(),
  priceMinMinor: priceMinorSchema.nullable(),
  priceMaxMinor: priceMinorSchema.nullable(),
  verified: z.boolean(),
  /** Seeded demonstration row (`[ÖRNEK]` prefix), never a real pitch. */
  isSample: z.boolean(),
  rating: venueRatingSchema,
});
export type VenueSummary = z.infer<typeof venueSummarySchema>;

/**
 * A review as shown to readers: the author's display name only (authorization matrix §6).
 * `text` is plain text; web renders it through the sanitizer, mobile as text.
 */
export const venueReviewSchema = z.strictObject({
  id: idSchema,
  authorDisplayName: displayNameSchema,
  rating: z.int().min(LIMITS.reviewRating.min).max(LIMITS.reviewRating.max),
  text: z.string().max(LIMITS.reviewText.max).nullable(),
  createdAt: isoDateTimeSchema,
});
export type VenueReview = z.infer<typeof venueReviewSchema>;

/**
 * `GET /api/v1/venues/:slug` and the `POST venues` response. `address` and `phone` are `null`
 * for unverified venues except for their creator (footnote 23). `recentReviews` holds the newest
 * reviews, at most one page. `myReview` is the signed-in caller's own review of this venue, so a
 * client can offer edit or delete without paging; `null` for anonymous callers and callers who
 * have not reviewed the venue. It never carries another user's review.
 */
export const venueDetailSchema = z.strictObject({
  ...venueSummarySchema.shape,
  address: z.string().max(LIMITS.venueAddress.max).nullable(),
  phone: z.string().max(LIMITS.venuePhone.max).nullable(),
  features: venueFeaturesSchema,
  recentReviews: z.array(venueReviewSchema).max(LIMITS.pageSize.default),
  myReview: venueReviewSchema.nullable(),
});
export type VenueDetail = z.infer<typeof venueDetailSchema>;

/**
 * `POST /api/v1/venues/:slug/reviews` (verified email, rate limit W). Only after an `in` RSVP on a
 * `played` match at this venue (403 `review_not_eligible`); one per user and venue (409
 * `already_reviewed`, ADR-0038).
 */
export const createReviewRequestSchema = z.strictObject({
  rating: z.int().min(LIMITS.reviewRating.min).max(LIMITS.reviewRating.max),
  text: multilineTextSchema(LIMITS.reviewText.max).optional(),
});
export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;
