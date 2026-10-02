import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
} from '@tanstack/react-query';

import { QUERY_ROOTS, queryKeys } from '../query/keys';
import { type Paginated, type VenueDetail, type VenueSummary } from './contracts';
import { type VenueFilters, type VenuesApi } from './venues-api';

/**
 * Root of the venue data that stays in memory only. It is not in `PERSISTED_QUERY_ROOTS`
 * (`src/query/persistence.ts`), so it is never written to the device: the full venue detail
 * carries other users' review texts (untrusted free text, often with names or phone numbers)
 * and the viewer's own review. Like every query, it is dropped at sign-out.
 */
export const VENUE_PRIVATE_ROOT = 'venue-private';

/** The venue detail without any review: what may be kept on the device for offline reading. */
export type VenueFacts = Omit<VenueDetail, 'recentReviews' | 'myReview'>;

/**
 * Query keys of the venue directory.
 * Persisted (`venues` root, shown offline, cleared at sign-out):
 * - `list(filters)`: one filtered list; `lists()` covers every filter combination.
 * - `facts(slug)`: the detail without reviews, written whenever the detail is read.
 * Memory only (`VENUE_PRIVATE_ROOT`):
 * - `detail(slug)`: the full `GET venues/:slug` answer with the recent reviews and `myReview`.
 */
export const venueKeys = {
  lists: () => queryKeys.venues(),
  list: (filters: VenueFilters) =>
    [...queryKeys.venues(), { district: filters.district, q: filters.q }] as const,
  allFacts: () => [QUERY_ROOTS.venues, 'facts'] as const,
  facts: (slug: string) => [QUERY_ROOTS.venues, 'facts', slug] as const,
  details: () => [VENUE_PRIVATE_ROOT, 'detail'] as const,
  detail: (slug: string) => [VENUE_PRIVATE_ROOT, 'detail', slug] as const,
};

/** Drops every review field, so the copy holds no other user's text. */
export function venueFacts(detail: VenueDetail): VenueFacts {
  // Listed field by field: a field added to the detail later is not persisted by accident.
  return {
    id: detail.id,
    name: detail.name,
    slug: detail.slug,
    districtId: detail.districtId,
    location: detail.location,
    indoor: detail.indoor,
    priceMinMinor: detail.priceMinMinor,
    priceMaxMinor: detail.priceMaxMinor,
    verified: detail.verified,
    isSample: detail.isSample,
    rating: detail.rating,
    address: detail.address,
    phone: detail.phone,
    features: detail.features,
  };
}

export function venueListQuery(venues: VenuesApi, filters: VenueFilters) {
  return infiniteQueryOptions({
    queryKey: venueKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Paginated<VenueSummary>) => page.nextCursor ?? undefined,
    queryFn: ({ pageParam, signal }) => venues.listVenues(filters, pageParam, signal),
  });
}

/** Stores the review-free copy of a detail answer for offline reading. */
export function keepVenueFacts(client: QueryClient, detail: VenueDetail): void {
  client.setQueryData<VenueFacts>(venueKeys.facts(detail.slug), venueFacts(detail));
}

/**
 * One venue with its recent reviews (memory only). Every successful read also refreshes the
 * persisted review-free copy (`facts`).
 */
export function venueDetailQuery(venues: VenuesApi, client: QueryClient, slug: string) {
  return queryOptions({
    queryKey: venueKeys.detail(slug),
    queryFn: async ({ signal }) => {
      const detail = await venues.getVenue(slug, signal);
      keepVenueFacts(client, detail);
      return detail;
    },
  });
}

/** The kept review-free copy of a venue; `null` when the app has none. Never requests. */
export function venueFactsQuery(client: QueryClient, slug: string) {
  return queryOptions({
    queryKey: venueKeys.facts(slug),
    queryFn: (): VenueFacts | null =>
      client.getQueryData<VenueFacts>(venueKeys.facts(slug)) ?? null,
    staleTime: Infinity,
  });
}

function isListData(value: unknown): value is InfiniteData<Paginated<VenueSummary>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { pages?: unknown }).pages)
  );
}

function isFacts(value: unknown): value is VenueFacts {
  return typeof value === 'object' && value !== null && 'id' in value && 'name' in value;
}

/**
 * Name of the venue with this id as the app last read it from the API (a kept detail or a cached
 * list), or `null`. Used to prefill a form with a venue chosen on another screen: the name comes
 * from the server's data, never from a route parameter.
 */
export function cachedVenueName(client: QueryClient, venueId: string): string | null {
  const cache = client.getQueryCache();
  for (const query of cache.findAll({ queryKey: venueKeys.allFacts() })) {
    const data: unknown = query.state.data;
    if (isFacts(data) && data.id === venueId) {
      return data.name;
    }
  }
  for (const query of cache.findAll({ queryKey: venueKeys.lists() })) {
    const data: unknown = query.state.data;
    if (!isListData(data)) {
      continue;
    }
    for (const page of data.pages) {
      const found = page.items.find((venue) => venue.id === venueId);
      if (found !== undefined) {
        return found.name;
      }
    }
  }
  return null;
}
