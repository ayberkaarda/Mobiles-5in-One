import { ENDPOINTS } from '@kadro/contracts';

import { listAuditLogs } from '../../../../../lib/server/admin/audit-logs';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.listAuditLogs;

/** Audit log, newest first (admin + step-up). */
export const GET = route({
  path: '/api/v1/admin/audit-logs',
  method: 'GET',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ query, ctx, runtime }) => json(await listAuditLogs({ ctx, runtime }, query)),
});
