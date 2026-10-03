import { ENDPOINTS } from '@kadro/contracts';

import { establishStepUp } from '../../../../../lib/server/admin/step-up';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.adminStepUp;

/** Opens the 15-minute admin step-up window with a TOTP code (matrix §3.8 footnote 26). */
export const POST = route({
  path: '/api/v1/admin/step-up',
  method: 'POST',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ body, ctx, runtime }) =>
    json(await establishStepUp({ ctx, runtime }, body.totpCode)),
});
