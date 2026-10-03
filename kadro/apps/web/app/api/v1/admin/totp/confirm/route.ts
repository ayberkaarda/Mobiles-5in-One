import { ENDPOINTS } from '@kadro/contracts';

import { confirmTotpEnrollment } from '../../../../../../lib/server/admin/step-up';
import { route } from '../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.adminTotpConfirm;

/** Activates the pending staff TOTP secret with a code from it (ADR-0064). */
export const POST = route({
  path: '/api/v1/admin/totp/confirm',
  method: 'POST',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ body, ctx, runtime }) => {
    await confirmTotpEnrollment({ ctx, runtime }, body.totpCode);
    return new Response(null, { status: 204 });
  },
});
