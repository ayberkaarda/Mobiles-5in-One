import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { setRsvp } from '../../../../../../lib/server/matches/rsvp';

export const dynamic = 'force-dynamic';

/** Own RSVP with waitlist (matrix §3.4 `rsvp.set`, footnote 14, ADR-0035). */
export const PUT = route({
  path: '/api/v1/matches/[id]/rsvp',
  method: 'PUT',
  auth: 'required',
  params: ENDPOINTS.setRsvp.params,
  query: ENDPOINTS.setRsvp.query,
  body: ENDPOINTS.setRsvp.body,
  limitGroup: ENDPOINTS.setRsvp.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await setRsvp({ ctx, runtime }, params.id, body)),
});
