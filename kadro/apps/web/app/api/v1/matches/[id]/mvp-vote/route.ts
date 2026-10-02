import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { voteMvp } from '../../../../../../lib/server/matches/mvp';

export const dynamic = 'force-dynamic';

/** Final MVP vote within 24 hours of a played match (matrix §3.4 `mvp.vote`, footnote 17). */
export const POST = route({
  path: '/api/v1/matches/[id]/mvp-vote',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.voteMvp.params,
  query: ENDPOINTS.voteMvp.query,
  body: ENDPOINTS.voteMvp.body,
  limitGroup: ENDPOINTS.voteMvp.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await voteMvp({ ctx, runtime }, params.id, body), { status: 201 }),
});
