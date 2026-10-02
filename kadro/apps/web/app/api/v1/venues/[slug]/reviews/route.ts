import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { createReview } from '../../../../../../lib/server/venues/reviews';

export const dynamic = 'force-dynamic';

/** Reviews a venue after playing there (matrix §3.6 `review.create`, footnote 24, ADR-0038). */
export const POST = route({
  path: '/api/v1/venues/[slug]/reviews',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.createReview.params,
  query: ENDPOINTS.createReview.query,
  body: ENDPOINTS.createReview.body,
  limitGroup: ENDPOINTS.createReview.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await createReview({ ctx, runtime }, params.slug, body), { status: 201 }),
});
