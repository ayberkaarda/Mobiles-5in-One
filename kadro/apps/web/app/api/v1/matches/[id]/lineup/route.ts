import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { setLineup } from '../../../../../../lib/server/matches/lineup';

export const dynamic = 'force-dynamic';

/** Replaces the lineup sides, captain or co-captain (matrix §3.4 `lineup.set`, footnote 15). */
export const PUT = route({
  path: '/api/v1/matches/[id]/lineup',
  method: 'PUT',
  auth: 'required',
  params: ENDPOINTS.setLineup.params,
  query: ENDPOINTS.setLineup.query,
  body: ENDPOINTS.setLineup.body,
  limitGroup: ENDPOINTS.setLineup.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await setLineup({ ctx, runtime }, params.id, body)),
});
