import { ENDPOINTS } from '@kadro/contracts';

import { listOpenCalls } from '../../../../lib/server/calls/open-calls';
import { json, route } from '../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/** Public list of open, unexpired calls (matrix §3.5 `opencall.list`, footnote 18, ADR-0037). */
export const GET = route({
  path: '/api/v1/open-calls',
  method: 'GET',
  auth: 'optional',
  params: ENDPOINTS.listOpenCalls.params,
  query: ENDPOINTS.listOpenCalls.query,
  body: ENDPOINTS.listOpenCalls.body,
  limitGroup: ENDPOINTS.listOpenCalls.rateLimit,
  handler: async ({ query, ctx, runtime }) => json(await listOpenCalls({ ctx, runtime }, query)),
});
