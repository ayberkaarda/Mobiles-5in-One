import { ENDPOINTS } from '@kadro/contracts';

import { getVenueImport } from '../../../../../../../lib/server/admin/imports';
import { json, route } from '../../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.getVenueImport;

/** State of a venue import (staff + step-up). */
export const GET = route({
  path: '/api/v1/admin/venues/import/[importId]',
  method: 'GET',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ params, ctx, runtime }) =>
    json(await getVenueImport({ ctx, runtime }, params.importId)),
});
