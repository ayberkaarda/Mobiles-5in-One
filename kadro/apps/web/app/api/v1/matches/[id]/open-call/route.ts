import { ENDPOINTS } from '@kadro/contracts';

import { closeMatchOpenCall, publishOpenCall } from '../../../../../../lib/server/calls/open-calls';
import { json, route } from '../../../../../../lib/server/http';
import { revalidateCallPages } from '../../../../../../lib/server/seo/invalidate';

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
  handler: async ({ params, body, ctx, runtime }) => {
    const call = await publishOpenCall({ ctx, runtime }, params.id, body);
    await revalidateCallPages(runtime, { matchId: params.id });
    return json(call, { status: 201 });
  },
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
  handler: async ({ params, ctx, runtime }) => {
    const call = await closeMatchOpenCall({ ctx, runtime }, params.id);
    await revalidateCallPages(runtime, { matchId: params.id });
    return json(call);
  },
});
