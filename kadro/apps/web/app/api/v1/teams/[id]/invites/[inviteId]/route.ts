import { ENDPOINTS } from '@kadro/contracts';

import { route } from '../../../../../../../lib/server/http';
import { revokeInvite } from '../../../../../../../lib/server/teams/invites';

export const dynamic = 'force-dynamic';

/** Ends an invite now, staff only; audited (matrix §3.3 `invite.revoke`, footnote 29). */
export const DELETE = route({
  path: '/api/v1/teams/[id]/invites/[inviteId]',
  method: 'DELETE',
  auth: 'required',
  params: ENDPOINTS.revokeInvite.params,
  query: ENDPOINTS.revokeInvite.query,
  body: ENDPOINTS.revokeInvite.body,
  limitGroup: ENDPOINTS.revokeInvite.rateLimit,
  handler: async ({ params, ctx, runtime }) => {
    await revokeInvite({ ctx, runtime }, params.id, params.inviteId);
    return new Response(null, { status: 204 });
  },
});
