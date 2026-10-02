import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../lib/server/http';
import { deleteTeam, getTeam, updateTeam } from '../../../../../lib/server/teams/teams';

export const dynamic = 'force-dynamic';

/** Team with roster, members only (matrix §3.3 `team.read`). */
export const GET = route({
  path: '/api/v1/teams/[id]',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.getTeam.params,
  query: ENDPOINTS.getTeam.query,
  body: ENDPOINTS.getTeam.body,
  limitGroup: ENDPOINTS.getTeam.rateLimit,
  handler: async ({ params, ctx, runtime }) => json(await getTeam({ ctx, runtime }, params.id)),
});

/** Name, district or badge removal by captain or co-captain (matrix §3.3 `team.update`, §4.2). */
export const PATCH = route({
  path: '/api/v1/teams/[id]',
  method: 'PATCH',
  auth: 'required',
  params: ENDPOINTS.updateTeam.params,
  query: ENDPOINTS.updateTeam.query,
  body: ENDPOINTS.updateTeam.body,
  limitGroup: ENDPOINTS.updateTeam.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await updateTeam({ ctx, runtime }, params.id, body)),
});

/**
 * Deletes the team, captain only (matrix §3.3 `team.delete`); a team with played history and
 * other members answers 409 `team_has_history` (footnote 34).
 */
export const DELETE = route({
  path: '/api/v1/teams/[id]',
  method: 'DELETE',
  auth: 'required',
  params: ENDPOINTS.deleteTeam.params,
  query: ENDPOINTS.deleteTeam.query,
  body: ENDPOINTS.deleteTeam.body,
  limitGroup: ENDPOINTS.deleteTeam.rateLimit,
  handler: async ({ params, ctx, runtime }) => {
    await deleteTeam({ ctx, runtime }, params.id);
    return new Response(null, { status: 204 });
  },
});
