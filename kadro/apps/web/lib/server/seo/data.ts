import { createHash } from 'node:crypto';

import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { type ServerRuntime, serverRuntime } from '../runtime';
import {
  type DistrictListing,
  findDistrictListing,
  findPublicVenue,
  isSlug,
  listSitemapDistricts,
  listSitemapVenues,
  type PublicVenue,
  type SitemapDistrict,
  type SitemapVenue,
} from './queries';

/**
 * Data cache of the programmatic SEO pages (product spec §7 "ISR 5 min", ADR-0055 decision 2,
 * ADR-0057). The HTML of these pages renders per request with the CSP nonce; only the public,
 * user-independent query results of `./queries.ts` are cached, for {@link SEO_REVALIDATE_SECONDS}.
 *
 * - Keys: `unstable_cache` keys an entry by the callback source, the key parts below and every
 *   argument, so each venue slug and each district has its own entry. The first argument is a
 *   digest of the database URL ({@link dataSource}): the cache lives on disk next to the build and
 *   survives restarts, so an entry read from one database is never served for another. No
 *   argument is derived from the request beyond the path segments, and no query reads a session.
 * - Tags: {@link venueTag}, {@link districtTag} and {@link SITEMAP_TAG} allow targeted
 *   invalidation with `revalidateTag`.
 * - Freshness: an entry is stale-while-revalidate, so it can be older than five minutes after a
 *   quiet period (ADR-0055). Calls carry a hard bound instead: every read drops calls whose expiry
 *   or match start has passed, whatever the cached entry still holds ({@link liveCalls}).
 * - Within one request, `react` `cache` shares a result between `generateMetadata` and the page.
 */

export const SEO_REVALIDATE_SECONDS = 300;
export const SITEMAP_TAG = 'seo:sitemap';

export function venueTag(slug: string): string {
  return `seo:venue:${slug}`;
}

export function districtTag(ilSlug: string, slug: string): string {
  return `seo:district:${ilSlug}/${slug}`;
}

/** The calls still listed at `now`: expiry and match start both in the future. */
export function liveCalls(listing: DistrictListing, now: Date): DistrictListing {
  const at = now.getTime();
  return {
    ...listing,
    calls: listing.calls.filter(
      (call) => Date.parse(call.expiresAt) > at && Date.parse(call.startsAt) > at,
    ),
  };
}

/** The sitemap districts still listed at `now`. */
export function liveDistricts(rows: readonly SitemapDistrict[], now: Date): SitemapDistrict[] {
  const at = now.getTime();
  return rows.filter((row) => Date.parse(row.listedUntil) > at);
}

/**
 * Cache key part naming the database the entries were read from: a truncated SHA-256 of the
 * configured URL, never the URL itself (it holds credentials).
 */
export function dataSource(runtime: Pick<ServerRuntime, 'env'>): string {
  return createHash('sha256').update(runtime.env.DATABASE_URL).digest('hex').slice(0, 16);
}

// The cached callbacks take the data source only as part of the cache key.

async function readVenue(_source: string, slug: string): Promise<PublicVenue | null> {
  const runtime = await serverRuntime();
  return findPublicVenue(runtime.db, slug);
}

async function readDistrict(
  _source: string,
  ilSlug: string,
  slug: string,
): Promise<DistrictListing | null> {
  const runtime = await serverRuntime();
  return findDistrictListing(runtime.db, ilSlug, slug, runtime.now());
}

async function readSitemapVenues(_source: string): Promise<SitemapVenue[]> {
  const runtime = await serverRuntime();
  return listSitemapVenues(runtime.db);
}

async function readSitemapDistricts(_source: string): Promise<SitemapDistrict[]> {
  const runtime = await serverRuntime();
  return listSitemapDistricts(runtime.db, runtime.now());
}

/** The public venue of `slug`, from the data cache; `null` for an unknown or private venue. */
export const publicVenue = cache(async (slug: string): Promise<PublicVenue | null> => {
  if (!isSlug(slug)) {
    return null;
  }
  const runtime = await serverRuntime();
  return unstable_cache(readVenue, ['seo-venue'], {
    revalidate: SEO_REVALIDATE_SECONDS,
    tags: [venueTag(slug)],
  })(dataSource(runtime), slug);
});

/** The district page data with only the calls live now; `null` for an unknown district. */
export const districtListing = cache(
  async (ilSlug: string, slug: string): Promise<DistrictListing | null> => {
    if (!isSlug(ilSlug) || !isSlug(slug)) {
      return null;
    }
    const runtime = await serverRuntime();
    const listing = await unstable_cache(readDistrict, ['seo-district'], {
      revalidate: SEO_REVALIDATE_SECONDS,
      tags: [districtTag(ilSlug, slug)],
    })(dataSource(runtime), ilSlug, slug);
    return listing === null ? null : liveCalls(listing, runtime.now());
  },
);

/** Indexable venue and district pages for the sitemap. */
export async function sitemapRows(): Promise<{
  readonly venues: readonly SitemapVenue[];
  readonly districts: readonly SitemapDistrict[];
}> {
  const runtime = await serverRuntime();
  const source = dataSource(runtime);
  const options = { revalidate: SEO_REVALIDATE_SECONDS, tags: [SITEMAP_TAG] };
  const [venues, districts] = await Promise.all([
    unstable_cache(readSitemapVenues, ['seo-sitemap-venues'], options)(source),
    unstable_cache(readSitemapDistricts, ['seo-sitemap-districts'], options)(source),
  ]);
  return { venues, districts: liveDistricts(districts, runtime.now()) };
}
