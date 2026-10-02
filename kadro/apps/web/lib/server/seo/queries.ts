import { type OpenCallPublic, type VenueDetail } from '@kadro/contracts';
import { districts, matches, openCalls, teams, venues } from '@kadro/db';
import { and, asc, desc, eq, gt, or, type SQL, sql } from 'drizzle-orm';

import { type DbReader } from '../domain/relations';
import { loadVenueDetail } from '../venues/projections';

/**
 * Public reads of the programmatic SEO pages (`/saha/[slug]`, `/eksik-var/[il]/[ilce]`, sitemap;
 * ADR-0057). Every query here is anonymous and user-independent, so its result may be shared
 * between visitors through the data cache of `./data.ts` (ADR-0055 decision 2). The visibility
 * rules are the ones of the public API for a caller without credentials: verified and sample
 * venues (`GET venues/:slug`), open, unexpired calls on open future matches (`GET open-calls`).
 * Results contain strings, numbers and booleans only, because the data cache stores JSON.
 */

/** Characters of `districts.il_slug`, `districts.slug` and server-made venue slugs. */
const SLUG_CHARS = /^[a-z0-9-]+$/;
const SLUG_MAX = 80;

/**
 * A path segment that can name a district or a venue (`a-z`, `0-9`, single inner hyphens);
 * anything else is a 404 without a query.
 */
export function isSlug(value: string): boolean {
  return (
    value.length <= SLUG_MAX &&
    SLUG_CHARS.test(value) &&
    !value.startsWith('-') &&
    !value.endsWith('-') &&
    !value.includes('--')
  );
}

/** Calls listed on one district page, soonest match first. */
export const DISTRICT_CALL_LIMIT = 50;
/** Venues linked from one district page. */
export const DISTRICT_VENUE_LIMIT = 24;
/** Upper bound of sitemap rows per kind (one sitemap file holds at most 50 000 URLs). */
export const SITEMAP_ROW_LIMIT = 20_000;

export interface PublicDistrict {
  readonly id: string;
  readonly il: string;
  readonly ilce: string;
  readonly ilSlug: string;
  readonly slug: string;
}

export interface PublicVenue extends VenueDetail {
  readonly district: PublicDistrict;
  /** ISO time of the last change, for the sitemap and `dateModified`. */
  readonly updatedAt: string;
}

export interface VenueLink {
  readonly name: string;
  readonly slug: string;
  readonly isSample: boolean;
}

/** A district page: the district, its live calls and its public venues. */
export interface DistrictListing {
  readonly district: PublicDistrict;
  readonly calls: readonly OpenCallPublic[];
  readonly venues: readonly VenueLink[];
}

export interface SitemapVenue {
  readonly slug: string;
  readonly updatedAt: string;
}

export interface SitemapDistrict {
  readonly ilSlug: string;
  readonly slug: string;
  /** Latest expiry among the district's live calls; the page is listed until then. */
  readonly listedUntil: string;
}

const DISTRICT_COLUMNS = {
  id: districts.id,
  il: districts.il,
  ilce: districts.ilce,
  ilSlug: districts.ilSlug,
  slug: districts.slug,
};

/** Venues anyone may read (authorization matrix §3.6 for an anonymous caller). */
function publicVenue(): SQL | undefined {
  return or(eq(venues.verified, true), eq(venues.isSample, true));
}

/** Calls `GET open-calls` lists at `now` (footnote 18): the same four conditions. */
function liveCall(now: Date): SQL | undefined {
  return and(
    eq(openCalls.status, 'open'),
    gt(openCalls.expiresAt, now),
    eq(matches.status, 'open'),
    gt(matches.startsAt, now),
  );
}

/** The public venue page data, or `null` for an unknown or unverified venue. */
export async function findPublicVenue(db: DbReader, slug: string): Promise<PublicVenue | null> {
  if (!isSlug(slug)) {
    return null;
  }
  const [row] = await db
    .select({ venueId: venues.id, updatedAt: venues.updatedAt, ...DISTRICT_COLUMNS })
    .from(venues)
    .innerJoin(districts, eq(districts.id, venues.districtId))
    .where(and(eq(venues.slug, slug), publicVenue()))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const detail = await loadVenueDetail(db, row.venueId, { isCreator: false, actorId: null });
  return {
    ...detail,
    district: {
      id: row.id,
      il: row.il,
      ilce: row.ilce,
      ilSlug: row.ilSlug,
      slug: row.slug,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The district page data at `now`, or `null` for an unknown district. Calls carry the same public
 * projection as `GET open-calls`: the team name and, for verified directory venues only, the
 * venue; never a person, the RSVP list, the fee or a free-text venue address.
 */
export async function findDistrictListing(
  db: DbReader,
  ilSlug: string,
  slug: string,
  now: Date,
): Promise<DistrictListing | null> {
  if (!isSlug(ilSlug) || !isSlug(slug)) {
    return null;
  }
  const [district] = await db
    .select(DISTRICT_COLUMNS)
    .from(districts)
    .where(and(eq(districts.ilSlug, ilSlug), eq(districts.slug, slug)))
    .limit(1);
  if (district === undefined) {
    return null;
  }
  const callRows = await db
    .select({
      id: openCalls.id,
      districtId: openCalls.districtId,
      startsAt: matches.startsAt,
      format: matches.format,
      missingCount: openCalls.missingCount,
      position: openCalls.position,
      level: openCalls.level,
      venueName: venues.name,
      venueSlug: venues.slug,
      teamName: teams.name,
      expiresAt: openCalls.expiresAt,
    })
    .from(openCalls)
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(venues, and(eq(venues.id, matches.venueId), eq(venues.verified, true)))
    .where(and(eq(openCalls.districtId, district.id), liveCall(now)))
    .orderBy(asc(matches.startsAt), asc(openCalls.id))
    .limit(DISTRICT_CALL_LIMIT);
  const venueRows = await db
    .select({ name: venues.name, slug: venues.slug, isSample: venues.isSample })
    .from(venues)
    .where(and(eq(venues.districtId, district.id), publicVenue()))
    .orderBy(desc(venues.verified), asc(venues.searchName), asc(venues.id))
    .limit(DISTRICT_VENUE_LIMIT);
  return {
    district,
    calls: callRows.map((row) => ({
      id: row.id,
      districtId: row.districtId,
      startsAt: row.startsAt.toISOString(),
      format: row.format,
      missingCount: row.missingCount,
      position: row.position,
      level: row.level,
      venue:
        row.venueName === null || row.venueSlug === null
          ? null
          : { name: row.venueName, slug: row.venueSlug },
      teamName: row.teamName,
      expiresAt: row.expiresAt.toISOString(),
    })),
    venues: venueRows,
  };
}

/**
 * Indexable venue pages: verified venues only. Sample rows are demonstration data and their pages
 * carry `noindex`, so the sitemap does not list them.
 */
export async function listSitemapVenues(db: DbReader): Promise<SitemapVenue[]> {
  const rows = await db
    .select({ slug: venues.slug, updatedAt: venues.updatedAt })
    .from(venues)
    .where(and(eq(venues.verified, true), eq(venues.isSample, false)))
    .orderBy(asc(venues.slug))
    .limit(SITEMAP_ROW_LIMIT);
  return rows.map((row) => ({ slug: row.slug, updatedAt: row.updatedAt.toISOString() }));
}

/** Indexable district pages at `now`: districts with at least one live call. */
export async function listSitemapDistricts(db: DbReader, now: Date): Promise<SitemapDistrict[]> {
  // A call is listed until its expiry or its match start, whichever comes first.
  const listedUntil =
    sql<number>`(extract(epoch from max(least(${openCalls.expiresAt}, ${matches.startsAt}))) * 1000)::float8`.mapWith(
      Number,
    );
  const rows = await db
    .select({ ilSlug: districts.ilSlug, slug: districts.slug, listedUntil })
    .from(openCalls)
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .innerJoin(districts, eq(districts.id, openCalls.districtId))
    .where(liveCall(now))
    .groupBy(districts.ilSlug, districts.slug)
    .orderBy(asc(districts.ilSlug), asc(districts.slug))
    .limit(SITEMAP_ROW_LIMIT);
  return rows.map((row) => ({
    ilSlug: row.ilSlug,
    slug: row.slug,
    listedUntil: new Date(row.listedUntil).toISOString(),
  }));
}
