import { ENDPOINTS } from '@kadro/contracts';

import { closeMatchOpenCall, publishOpenCall } from '../../../../../../lib/server/calls/open-calls';
import { json, route } from '../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/** Publishes the match's open call (matrix §3.5 `opencall.publish`, footnote 19, ADR-0037). */
export const POST = route({
  path: '/api/v1/matches/[id]/open-call',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.publishOpenCall.params,
  query: ENDPOINTS.publishOpenCall.query,
  body: ENDPOINTS.publishOpenCall.body,
  limitGroup: ENDPOINTS.publishOpenCall.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await publishOpenCall({ ctx, runtime }, params.id, body), { status: 201 }),
});

/** Closes the match's open call (matrix §3.5 `opencall.close`, footnote 30). */
export const PATCH = route({
  path: '/api/v1/matches/[id]/open-call',
  method: 'PATCH',
  auth: 'required',
  params: ENDPOINTS.closeOpenCall.params,
  query: ENDPOINTS.closeOpenCall.query,
  body: ENDPOINTS.closeOpenCall.body,
  limitGroup: ENDPOINTS.closeOpenCall.rateLimit,
  handler: async ({ params, ctx, runtime }) =>
    json(await closeMatchOpenCall({ ctx, runtime }, params.id)),
});
