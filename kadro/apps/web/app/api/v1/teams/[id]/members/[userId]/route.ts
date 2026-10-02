import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../../lib/server/http';
import { removeMember, updateMemberRole } from '../../../../../../../lib/server/teams/members';

export const dynamic = 'force-dynamic';

/** Role change or captaincy transfer, captain only (matrix §3.3 `member.updateRole`, footnote 8). */
export const PATCH = route({
  path: '/api/v1/teams/[id]/members/[userId]',
  method: 'PATCH',
  auth: 'required',
  params: ENDPOINTS.updateMemberRole.params,
  query: ENDPOINTS.updateMemberRole.query,
  body: ENDPOINTS.updateMemberRole.body,
  limitGroup: ENDPOINTS.updateMemberRole.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await updateMemberRole({ ctx, runtime }, params.id, params.userId, body)),
});

/** Removes a member or leaves the team (matrix §3.3 `member.remove`, footnote 9, ADR-0005). */
export const DELETE = route({
  path: '/api/v1/teams/[id]/members/[userId]',
  method: 'DELETE',
  auth: 'required',
  params: ENDPOINTS.removeMember.params,
  query: ENDPOINTS.removeMember.query,
  body: ENDPOINTS.removeMember.body,
  limitGroup: ENDPOINTS.removeMember.rateLimit,
  handler: async ({ params, ctx, runtime }) => {
    await removeMember({ ctx, runtime }, params.id, params.userId);
    return new Response(null, { status: 204 });
  },
});
