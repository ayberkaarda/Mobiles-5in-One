import { ENDPOINTS } from '@kadro/contracts';

import { registerPushToken } from '../../../../../lib/server/account/push-tokens';
import { route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/**
 * Registers the caller's Expo push token (matrix §3.2, ADR-0031). A token bound to another user
 * moves to the caller; rate limit group P.
 */
export const POST = route({
  path: '/api/v1/me/push-tokens',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.registerPushToken.params,
  query: ENDPOINTS.registerPushToken.query,
  body: ENDPOINTS.registerPushToken.body,
  limitGroup: ENDPOINTS.registerPushToken.rateLimit,
  handler: async ({ body, ctx, runtime }) => {
    await registerPushToken({ ctx, runtime }, body);
    return new Response(null, { status: 204 });
  },
});
