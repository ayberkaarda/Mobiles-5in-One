import { ENDPOINTS } from '@kadro/contracts';

import { listAdminReviews } from '../../../../../lib/server/admin/moderation';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.listAdminReviews;

/** Venue reviews for moderation, newest first (staff + step-up). */
export const GET = route({
  path: '/api/v1/admin/reviews',
  method: 'GET',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ query, ctx, runtime }) => json(await listAdminReviews({ ctx, runtime }, query)),
});
