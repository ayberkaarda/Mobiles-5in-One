import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { createInvite, listInvites } from '../../../../../../lib/server/teams/invites';

export const dynamic = 'force-dynamic';

/** Invites of the team without codes, staff only (matrix §3.3 `invite.list`, footnote 29). */
export const GET = route({
  path: '/api/v1/teams/[id]/invites',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.listInvites.params,
  query: ENDPOINTS.listInvites.query,
  body: ENDPOINTS.listInvites.body,
  limitGroup: ENDPOINTS.listInvites.rateLimit,
  handler: async ({ params, query, ctx, runtime }) =>
    json(await listInvites({ ctx, runtime }, params.id, query)),
});

/** New invite; the plaintext code is in this response only (ADR-0011, ADR-0034). */
export const POST = route({
  path: '/api/v1/teams/[id]/invites',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.createInvite.params,
  query: ENDPOINTS.createInvite.query,
  body: ENDPOINTS.createInvite.body,
  limitGroup: ENDPOINTS.createInvite.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await createInvite({ ctx, runtime }, params.id, body), { status: 201 }),
});
