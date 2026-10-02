import { ENDPOINTS } from '@kadro/contracts';

import { decideApplication } from '../../../../../../../lib/server/calls/applications';
import { json, route } from '../../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/**
 * Accept / reject (call staff, `application.decide`) or withdraw (applicant,
 * `application.withdraw`) one application (matrix §3.5 footnotes 21, 22; ADR-0003, ADR-0013).
 */
export const PATCH = route({
  path: '/api/v1/open-calls/[id]/applications/[appId]',
  method: 'PATCH',
  auth: 'required',
  params: ENDPOINTS.decideApplication.params,
  query: ENDPOINTS.decideApplication.query,
  body: ENDPOINTS.decideApplication.body,
  limitGroup: ENDPOINTS.decideApplication.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await decideApplication({ ctx, runtime }, params.id, params.appId, body)),
});
