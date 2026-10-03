import {
  LIMITS,
  type VenueDetail,
  type VenueFeatures,
  type VenueReview,
  type VenueSummary,
} from '@kadro/contracts';
import { type GeoPoint, users, venueReviews, venues } from '@kadro/db';
import { and, desc, eq, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type DbReader } from '../domain/relations';

/**
 * Read projections of the venue directory (authorization matrix §6, footnote 23, ADR-0038). Phone
 * and address of an unverified venue are shown to its creator only; reviews name their author by
 * display name only.
 */

/** Reviews needed before an average is shown (ADR-0038 "Aggregate rating ... at least 3"). */
export const MIN_REVIEWS_FOR_AVERAGE = 3;

const ratedReview = alias(venueReviews, 'rated_review');

function reviewCountOf(db: DbReader): SQL<number> {
  return sql<number>`(${db
    .select({ reviews: sql`count(*)` })
    .from(ratedReview)
    .where(eq(ratedReview.venueId, venues.id))})`.mapWith(Number);
}

function reviewAverageOf(db: DbReader): SQL<string | null> {
  return sql<string | null>`(${db
    .select({ average: sql`round(avg(${ratedReview.rating})::numeric, 1)::text` })
    .from(ratedReview)
    .where(eq(ratedReview.venueId, venues.id))})`;
}

/** Column set of a venue summary with its rating aggregate. */
export function venueSummaryColumns(db: DbReader) {
  return {
    id: venues.id,
    name: venues.name,
    slug: venues.slug,
    districtId: venues.districtId,
    point: venues.point,
    indoor: venues.indoor,
    priceMinMinor: venues.priceMinMinor,
    priceMaxMinor: venues.priceMaxMinor,
    verified: venues.verified,
    isSample: venues.isSample,
    reviewCount: reviewCountOf(db),
    reviewAverage: reviewAverageOf(db),
  };
}

export interface VenueSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly districtId: string;
  readonly point: GeoPoint;
  readonly indoor: boolean;
  readonly priceMinMinor: number | null;
  readonly priceMaxMinor: number | null;
  readonly verified: boolean;
  readonly isSample: boolean;
  readonly reviewCount: number;
  readonly reviewAverage: string | null;
}

export function toVenueSummary(row: VenueSummaryRow): VenueSummary {
  const average =
    row.reviewCount >= MIN_REVIEWS_FOR_AVERAGE && row.reviewAverage !== null
      ? Number(row.reviewAverage)
      : null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    districtId: row.districtId,
    location: { latitude: row.point.lat, longitude: row.point.lng },
    indoor: row.indoor,
    priceMinMinor: row.priceMinMinor,
    priceMaxMinor: row.priceMaxMinor,
    verified: row.verified,
    isSample: row.isSample,
    rating: { average, count: row.reviewCount },
  };
}

/** Only the closed key set of `venueFeaturesSchema` with boolean values leaves the server. */
export function toFeatures(stored: Readonly<Record<string, unknown>>): VenueFeatures {
  const features: VenueFeatures = {};
  for (const key of ['lighting', 'changingRoom', 'shower', 'parking'] as const) {
    // eslint-disable-next-line security/detect-object-injection -- key iterates a literal tuple
    const value = stored[key];
    if (typeof value === 'boolean') {
      // eslint-disable-next-line security/detect-object-injection -- key iterates a literal tuple
      features[key] = value;
    }
  }
  return features;
}

export interface ReviewRow {
  readonly id: string;
  readonly authorDisplayName: string;
  readonly rating: number;
  readonly text: string | null;
  readonly createdAt: Date;
}

export function toVenueReview(row: ReviewRow): VenueReview {
  return {
    id: row.id,
    authorDisplayName: row.authorDisplayName,
    rating: row.rating,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  };
}

export const REVIEW_COLUMNS = {
  id: venueReviews.id,
  authorDisplayName: users.displayName,
  rating: venueReviews.rating,
  text: venueReviews.text,
  createdAt: venueReviews.createdAt,
};

/** The review `actorId` wrote for the venue; `null` for anonymous callers and without one. */
async function loadOwnReview(
  db: DbReader,
  venueId: string,
  actorId: string | null,
): Promise<VenueReview | null> {
  if (actorId === null) {
    return null;
  }
  const [row] = await db
    .select(REVIEW_COLUMNS)
    .from(venueReviews)
    .innerJoin(users, eq(users.id, venueReviews.userId))
    .where(and(eq(venueReviews.venueId, venueId), eq(venueReviews.userId, actorId)))
    .limit(1);
  return row === undefined ? null : toVenueReview(row);
}

/**
 * The venue with its newest reviews (at most one page) and the caller's own review. Phone and
 * address are shown for verified venues, and to the creator always (footnote 23); a sample or
 * unverified venue shows neither to anyone else.
 */
export async function loadVenueDetail(
  db: DbReader,
  venueId: string,
  options: { readonly isCreator: boolean; readonly actorId: string | null },
): Promise<VenueDetail> {
  const [row] = await db
    .select({
      ...venueSummaryColumns(db),
      address: venues.address,
      phone: venues.phone,
      features: venues.features,
    })
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  if (row === undefined) {
    throw new Error('venue is not visible after authorization');
  }
  const reviews = await db
    .select(REVIEW_COLUMNS)
    .from(venueReviews)
    .innerJoin(users, eq(users.id, venueReviews.userId))
    .where(and(eq(venueReviews.venueId, venueId), eq(users.isTombstone, false)))
    .orderBy(desc(venueReviews.createdAt), desc(venueReviews.id))
    .limit(LIMITS.pageSize.default);
  const showContact = options.isCreator || row.verified;
  return {
    ...toVenueSummary(row),
    address: showContact ? row.address : null,
    phone: showContact ? row.phone : null,
    features: toFeatures(row.features),
    recentReviews: reviews.map(toVenueReview),
    myReview: await loadOwnReview(db, venueId, options.actorId),
  };
}
