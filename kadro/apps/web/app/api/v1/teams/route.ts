import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../lib/server/http';
import { createTeam, listTeams } from '../../../../lib/server/teams/teams';

export const dynamic = 'force-dynamic';

/** Teams the caller is a member of, cursor-paginated (matrix §3.3 `team.list`). */
export const GET = route({
  path: '/api/v1/teams',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.listTeams.params,
  query: ENDPOINTS.listTeams.query,
  body: ENDPOINTS.listTeams.body,
  limitGroup: ENDPOINTS.listTeams.rateLimit,
  handler: async ({ query, ctx, runtime }) => json(await listTeams({ ctx, runtime }, query)),
});

/** Creates a team; the caller becomes its captain (matrix §3.3 `team.create`, footnote 6). */
export const POST = route({
  path: '/api/v1/teams',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.createTeam.params,
  query: ENDPOINTS.createTeam.query,
  body: ENDPOINTS.createTeam.body,
  limitGroup: ENDPOINTS.createTeam.rateLimit,
  handler: async ({ body, ctx, runtime }) =>
    json(await createTeam({ ctx, runtime }, body), { status: 201 }),
});
