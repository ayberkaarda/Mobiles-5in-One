import { ENDPOINTS, type RevenueCatWebhookResponse } from '@kadro/contracts';

import {
  receiveRevenueCatDelivery,
  verifyRevenueCatRequest,
} from '../../../../../lib/server/billing/webhook';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.receiveRevenueCatWebhook;

/**
 * RevenueCat subscription event delivery (ADR-0063). No user principal and no `x-kadro-client`:
 * the `Authorization` header is checked against `REVENUECAT_WEBHOOK_SECRET` before the body is
 * read. The strict envelope is validated with the 1 MiB body limit; the answer is always 200 with
 * `accepted`, `duplicate` or `ignored`. No per-group rate limit (deliveries arrive in bursts).
 */
export const POST = route({
  path: '/api/v1/webhooks/revenuecat',
  method: 'POST',
  client: 'exempt',
  auth: 'none',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  verifyRequest: verifyRevenueCatRequest,
  handler: async ({ body, rawBody, ctx, runtime }) => {
    await ctx.authorize('webhook.revenuecat');
    const { outcome } = await receiveRevenueCatDelivery(runtime, body, rawBody, ctx.logger);
    const response: RevenueCatWebhookResponse = { status: outcome };
    return json(response);
  },
});
