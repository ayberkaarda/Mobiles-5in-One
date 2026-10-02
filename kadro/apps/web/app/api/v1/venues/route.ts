import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../lib/server/http';
import { createVenue, listVenues } from '../../../../lib/server/venues/venues';

export const dynamic = 'force-dynamic';

/** Venue directory with district and folded-text search (matrix §3.6 `venue.list`, ADR-0039). */
export const GET = route({
  path: '/api/v1/venues',
  method: 'GET',
  auth: 'optional',
  params: ENDPOINTS.listVenues.params,
  query: ENDPOINTS.listVenues.query,
  body: ENDPOINTS.listVenues.body,
  limitGroup: ENDPOINTS.listVenues.rateLimit,
  handler: async ({ query, ctx, runtime }) => json(await listVenues({ ctx, runtime }, query)),
});

/** Suggests a venue, created unverified (matrix §3.6 `venue.create`, footnote 23, ADR-0038). */
export const POST = route({
  path: '/api/v1/venues',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.createVenue.params,
  query: ENDPOINTS.createVenue.query,
  body: ENDPOINTS.createVenue.body,
  limitGroup: ENDPOINTS.createVenue.rateLimit,
  handler: async ({ body, ctx, runtime }) =>
    json(await createVenue({ ctx, runtime }, body), { status: 201 }),
});
