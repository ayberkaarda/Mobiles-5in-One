import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../../lib/server/http';
import { markPayment } from '../../../../../../../lib/server/matches/payments';

export const dynamic = 'force-dynamic';

/** Marks a share paid or unpaid, audited (matrix §3.4 `payment.mark`, footnote 16, ADR-0006). */
export const PATCH = route({
  path: '/api/v1/matches/[id]/payments/[userId]',
  method: 'PATCH',
  auth: 'required',
  params: ENDPOINTS.markPayment.params,
  query: ENDPOINTS.markPayment.query,
  body: ENDPOINTS.markPayment.body,
  limitGroup: ENDPOINTS.markPayment.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await markPayment({ ctx, runtime }, params.id, params.userId, body)),
});
