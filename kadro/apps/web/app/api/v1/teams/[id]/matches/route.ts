import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { createMatch, listMatches } from '../../../../../../lib/server/matches/matches';

export const dynamic = 'force-dynamic';

/** Matches of a team, members only (matrix §3.4 `match.list`). */
export const GET = route({
  path: '/api/v1/teams/[id]/matches',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.listMatches.params,
  query: ENDPOINTS.listMatches.query,
  body: ENDPOINTS.listMatches.body,
  limitGroup: ENDPOINTS.listMatches.rateLimit,
  handler: async ({ params, query, ctx, runtime }) =>
    json(await listMatches({ ctx, runtime }, params.id, query)),
});

/** Creates a match, captain or co-captain (matrix §3.4 `match.create`, footnote 10). */
export const POST = route({
  path: '/api/v1/teams/[id]/matches',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.createMatch.params,
  query: ENDPOINTS.createMatch.query,
  body: ENDPOINTS.createMatch.body,
  limitGroup: ENDPOINTS.createMatch.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await createMatch({ ctx, runtime }, params.id, body), { status: 201 }),
});
