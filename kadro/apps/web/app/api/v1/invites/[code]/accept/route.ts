import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { acceptInvite } from '../../../../../../lib/server/teams/invites';

export const dynamic = 'force-dynamic';

/** Joins the team as `player` (matrix §3.3 `invite.accept`, footnote 7, ADR-0034). */
export const POST = route({
  path: '/api/v1/invites/[code]/accept',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.acceptInvite.params,
  query: ENDPOINTS.acceptInvite.query,
  body: ENDPOINTS.acceptInvite.body,
  limitGroup: ENDPOINTS.acceptInvite.rateLimit,
  handler: async ({ params, ctx, runtime }) =>
    json(await acceptInvite({ ctx, runtime }, params.code)),
});
