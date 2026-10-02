import { type ApiClient } from '../api/client';
import {
  type CreateReviewRequest,
  type CreateVenueRequest,
  type Paginated,
  type VenueDetail,
  type VenueReview,
  type VenueSummary,
} from './contracts';

/** Page size of the venue list (the API accepts 1..100). */
export const VENUE_PAGE_SIZE = 20;

/** Filters of `GET venues`; `null` means "any". `q` is sent trimmed. */
export interface VenueFilters {
  readonly district: string | null;
  readonly q: string | null;
}

export const NO_VENUE_FILTERS: VenueFilters = { district: null, q: null };

/**
 * Calls of the venue directory (`packages/contracts` endpoints `listVenues`, `getVenue`,
 * `createVenue`, `createReview`, `deleteOwnReview`). Reads are public and send the bearer token
 * when one is held (`auth: 'optional'`), so a creator also sees their own unverified venues.
 * The venue is addressed by the slug the server assigned; the reviewer is always the session's
 * user, never a body field. There is no review edit endpoint (authorization matrix §4.5).
 */
export interface VenuesApi {
  listVenues(
    filters: VenueFilters,
    cursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<Paginated<VenueSummary>>;
  getVenue(slug: string, signal?: AbortSignal): Promise<VenueDetail>;
  createVenue(body: CreateVenueRequest): Promise<VenueDetail>;
  createReview(slug: string, body: CreateReviewRequest): Promise<VenueReview>;
  /** `DELETE venues/:slug/reviews/mine`: 204, or 404 when the caller has no review there. */
  deleteMyReview(slug: string): Promise<void>;
}

function venuePath(slug: string): string {
  return `/api/v1/venues/${encodeURIComponent(slug)}`;
}

export function createVenuesApi(api: ApiClient): VenuesApi {
  return {
    listVenues: (filters, cursor, signal) =>
      api.request<Paginated<VenueSummary>>('/api/v1/venues', {
        auth: 'optional',
        query: {
          cursor,
          limit: VENUE_PAGE_SIZE,
          district: filters.district ?? undefined,
          q: filters.q ?? undefined,
        },
        signal,
      }),
    getVenue: (slug, signal) =>
      api.request<VenueDetail>(venuePath(slug), { auth: 'optional', signal }),
    createVenue: (body) => api.request<VenueDetail>('/api/v1/venues', { method: 'POST', body }),
    createReview: (slug, body) =>
      api.request<VenueReview>(`${venuePath(slug)}/reviews`, { method: 'POST', body }),
    async deleteMyReview(slug) {
      await api.request<unknown>(`${venuePath(slug)}/reviews/mine`, { method: 'DELETE' });
    },
  };
}
