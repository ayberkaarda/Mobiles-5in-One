import { ENDPOINTS } from '@kadro/contracts';

import { startTotpEnrollment } from '../../../../../../lib/server/admin/step-up';
import { json, route } from '../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.adminTotpEnroll;

/** Starts staff TOTP enrollment after a re-authentication proof (ADR-0064). */
export const POST = route({
  path: '/api/v1/admin/totp/enroll',
  method: 'POST',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ body, ctx, runtime }) =>
    json(await startTotpEnrollment({ ctx, runtime }, body), { status: 201 }),
});
