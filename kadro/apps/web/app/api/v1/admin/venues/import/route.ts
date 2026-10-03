import { ENDPOINTS } from '@kadro/contracts';

import { requestVenueImport } from '../../../../../../lib/server/admin/imports';
import { json, route } from '../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.importVenues;

/** Stores a venue CSV and enqueues `venue.import` (admin + step-up; audited). */
export const POST = route({
  path: '/api/v1/admin/venues/import',
  method: 'POST',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ body, ctx, runtime }) =>
    json(await requestVenueImport({ ctx, runtime }, body), { status: 202 }),
});
