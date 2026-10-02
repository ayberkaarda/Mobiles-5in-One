import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../lib/server/http';
import { getVenue } from '../../../../../lib/server/venues/venues';

export const dynamic = 'force-dynamic';

/** Venue detail; an unverified venue is 404 except for its creator (matrix §3.6 `venue.read`). */
export const GET = route({
  path: '/api/v1/venues/[slug]',
  method: 'GET',
  auth: 'optional',
  params: ENDPOINTS.getVenue.params,
  query: ENDPOINTS.getVenue.query,
  body: ENDPOINTS.getVenue.body,
  limitGroup: ENDPOINTS.getVenue.rateLimit,
  handler: async ({ params, ctx, runtime }) => json(await getVenue({ ctx, runtime }, params.slug)),
});
