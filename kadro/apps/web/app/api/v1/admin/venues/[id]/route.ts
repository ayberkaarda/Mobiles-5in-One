import { ENDPOINTS } from '@kadro/contracts';

import { updateAdminVenue } from '../../../../../../lib/server/admin/venues';
import { json, route } from '../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.updateAdminVenue;

/** Verifies or corrects a venue (staff + step-up; audited). */
export const PATCH = route({
  path: '/api/v1/admin/venues/[id]',
  method: 'PATCH',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await updateAdminVenue({ ctx, runtime }, params.id, body)),
});
