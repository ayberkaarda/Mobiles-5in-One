import { ENDPOINTS } from '@kadro/contracts';

import { route } from '../../../../../../../lib/server/http';
import { deleteOwnReview } from '../../../../../../../lib/server/venues/reviews';

export const dynamic = 'force-dynamic';

/** Deletes the caller's own review of the venue (matrix §3.6 `review.deleteOwn`, footnote 32). */
export const DELETE = route({
  path: '/api/v1/venues/[slug]/reviews/mine',
  method: 'DELETE',
  auth: 'required',
  params: ENDPOINTS.deleteOwnReview.params,
  query: ENDPOINTS.deleteOwnReview.query,
  body: ENDPOINTS.deleteOwnReview.body,
  limitGroup: ENDPOINTS.deleteOwnReview.rateLimit,
  handler: async ({ params, ctx, runtime }) => {
    await deleteOwnReview({ ctx, runtime }, params.slug);
    return new Response(null, { status: 204 });
  },
});
