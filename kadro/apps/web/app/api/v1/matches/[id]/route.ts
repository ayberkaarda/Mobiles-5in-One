import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../lib/server/http';
import { deleteMatch, getMatch, updateMatch } from '../../../../../lib/server/matches/matches';
import { revalidateCallPages } from '../../../../../lib/server/seo/invalidate';

export const dynamic = 'force-dynamic';

/** Member or guest view of a match (matrix §3.4 `match.read`, footnote 11). */
export const GET = route({
  path: '/api/v1/matches/[id]',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.getMatch.params,
  query: ENDPOINTS.getMatch.query,
  body: ENDPOINTS.getMatch.body,
  limitGroup: ENDPOINTS.getMatch.rateLimit,
  handler: async ({ params, ctx, runtime }) => json(await getMatch({ ctx, runtime }, params.id)),
});

/** Edits or moves a match through its states (matrix §3.4 `match.update`, footnote 12). */
export const PATCH = route({
  path: '/api/v1/matches/[id]',
  method: 'PATCH',
  auth: 'required',
  params: ENDPOINTS.updateMatch.params,
  query: ENDPOINTS.updateMatch.query,
  body: ENDPOINTS.updateMatch.body,
  limitGroup: ENDPOINTS.updateMatch.rateLimit,
  handler: async ({ params, body, ctx, runtime }) => {
    const match = await updateMatch({ ctx, runtime }, params.id, body);
    // A lock, cancel, reschedule or venue change ends or alters the match's listed call.
    await revalidateCallPages(runtime, { matchId: params.id });
    return json(match);
  },
});

/** Deletes a draft or cancels an open / locked match (matrix §3.4 `match.delete`, footnote 13). */
export const DELETE = route({
  path: '/api/v1/matches/[id]',
  method: 'DELETE',
  auth: 'required',
  params: ENDPOINTS.deleteMatch.params,
  query: ENDPOINTS.deleteMatch.query,
  body: ENDPOINTS.deleteMatch.body,
  limitGroup: ENDPOINTS.deleteMatch.rateLimit,
  handler: async ({ params, ctx, runtime }) => {
    const result = await deleteMatch({ ctx, runtime }, params.id);
    await revalidateCallPages(runtime, { matchId: params.id });
    return json(result);
  },
});
