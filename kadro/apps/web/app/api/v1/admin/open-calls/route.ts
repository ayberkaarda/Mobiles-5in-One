import { ENDPOINTS } from '@kadro/contracts';

import { listAdminOpenCalls } from '../../../../../lib/server/admin/moderation';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.listAdminOpenCalls;

/** Open calls for moderation, newest first (staff + step-up). */
export const GET = route({
  path: '/api/v1/admin/open-calls',
  method: 'GET',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ query, ctx, runtime }) =>
    json(await listAdminOpenCalls({ ctx, runtime }, query)),
});
