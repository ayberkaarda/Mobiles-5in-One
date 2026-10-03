import { ENDPOINTS } from '@kadro/contracts';

import { listAdminVenues } from '../../../../../lib/server/admin/venues';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.listAdminVenues;

/** Venues for verification and correction, newest first (staff + step-up). */
export const GET = route({
  path: '/api/v1/admin/venues',
  method: 'GET',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ query, ctx, runtime }) => json(await listAdminVenues({ ctx, runtime }, query)),
});
