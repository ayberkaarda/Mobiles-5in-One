import { ENDPOINTS } from '@kadro/contracts';

import { listAdminUsers } from '../../../../../lib/server/admin/users';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.listAdminUsers;

/** Accounts with masked email, newest first (staff + step-up). */
export const GET = route({
  path: '/api/v1/admin/users',
  method: 'GET',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ query, ctx, runtime }) => json(await listAdminUsers({ ctx, runtime }, query)),
});
