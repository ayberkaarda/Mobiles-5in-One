import {
  type QueryClient,
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiError } from '../api/errors';
import {
  type CreateReviewRequest,
  type CreateVenueRequest,
  type VenueDetail,
  type VenueReview,
} from './contracts';
import { keepVenueFacts, venueKeys } from './queries';
import { type VenuesApi } from './venues-api';

/**
 * Writes of the venue directory. None is optimistic: a review is checked against matches the app
 * cannot see (eligibility, one per venue) and a new venue against every venue of the district, so
 * each waits for the answer. The answer is written into the cache; the venue and the lists
 * refetch in the background (never awaited), since the rating summary is computed by the server.
 *
 * Review writes on one venue share a mutation key; the screen disables the controls while one runs.
 */
export const reviewWriteKey = (slug: string) => ['venue-review-write', slug] as const;
export const venueCreateKey = ['venue-create'] as const;

export function useReviewBusy(slug: string): boolean {
  return useIsMutating({ mutationKey: reviewWriteKey(slug) }) > 0;
}

function refresh(client: QueryClient, slug: string): void {
  void client.invalidateQueries({ queryKey: venueKeys.detail(slug) });
  void client.invalidateQueries({ queryKey: venueKeys.lists() });
}

/** The kept detail with the viewer's own review set (or removed). */
function setOwnReview(client: QueryClient, slug: string, review: VenueReview | null): void {
  client.setQueryData<VenueDetail>(venueKeys.detail(slug), (detail) => {
    if (detail === undefined) {
      return detail;
    }
    const previousId = detail.myReview?.id ?? null;
    return {
      ...detail,
      myReview: review,
      // The removed review must not linger among the recent ones.
      recentReviews:
        review === null && previousId !== null
          ? detail.recentReviews.filter((row) => row.id !== previousId)
          : detail.recentReviews,
    };
  });
}

/** `POST venues` (verified email): the answer is the new, unverified venue. */
export function useCreateVenue(venues: VenuesApi) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: venueCreateKey,
    mutationFn: (body: CreateVenueRequest) => venues.createVenue(body),
    onSuccess: (detail) => {
      client.setQueryData<VenueDetail>(venueKeys.detail(detail.slug), detail);
      keepVenueFacts(client, detail);
      void client.invalidateQueries({ queryKey: venueKeys.lists() });
    },
  });
}

/** `POST venues/:slug/reviews`. `already_reviewed` means the kept detail is stale: re-read it. */
export function useCreateReview(venues: VenuesApi, slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: reviewWriteKey(slug),
    mutationFn: (body: CreateReviewRequest) => venues.createReview(slug, body),
    onSuccess: (review) => {
      setOwnReview(client, slug, review);
      refresh(client, slug);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: venueKeys.detail(slug) });
      }
    },
  });
}

/** `DELETE venues/:slug/reviews/mine`. A 404 means there is no review left: same end state. */
export function useDeleteReview(venues: VenuesApi, slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: reviewWriteKey(slug),
    mutationFn: async () => {
      try {
        await venues.deleteMyReview(slug);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      setOwnReview(client, slug, null);
      refresh(client, slug);
    },
  });
}

/**
 * Rewriting a review. The API has no edit (matrix §4.5), so this deletes the review and creates
 * the new one, in that order, as one write. When the delete went through but the create was
 * refused (rate limit, network), the old review is gone: the cache says so at once and the error
 * carries `deleted: true`, so the screen keeps the text and offers to send it as a new review.
 */
export class RewriteError extends Error {
  constructor(
    readonly deleted: boolean,
    override readonly cause: unknown,
  ) {
    super('review rewrite failed', { cause });
    this.name = 'RewriteError';
  }
}

export function useRewriteReview(venues: VenuesApi, slug: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: reviewWriteKey(slug),
    mutationFn: async (body: CreateReviewRequest): Promise<VenueReview> => {
      try {
        await venues.deleteMyReview(slug);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          throw new RewriteError(false, error);
        }
      }
      setOwnReview(client, slug, null);
      try {
        return await venues.createReview(slug, body);
      } catch (error) {
        throw new RewriteError(true, error);
      }
    },
    onSuccess: (review) => {
      setOwnReview(client, slug, review);
      refresh(client, slug);
    },
    onError: (error) => {
      if (error instanceof RewriteError && error.deleted) {
        refresh(client, slug);
      }
    },
  });
}
