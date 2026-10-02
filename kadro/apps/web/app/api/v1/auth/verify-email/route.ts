import { verifyEmailRequestSchema } from '@kadro/contracts';

import { verifyEmail } from '../../../../../lib/server/auth/account-flows';
import { flowContext } from '../../../../../lib/server/auth/context';
import { ApiError } from '../../../../../lib/server/errors';
import { route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/** Redeems a single-use verification token (24 h). Rate limit group A (IP). */
export const POST = route({
  path: '/api/v1/auth/verify-email',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: verifyEmailRequestSchema,
  rateLimit: { group: 'auth' },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.verifyEmail');
    try {
      await verifyEmail(flowContext(runtime, ctx), body.token);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'token_invalid') {
        await ctx.authAttempts?.recordFailure();
      }
      throw error;
    }
    return new Response(null, { status: 204 });
  },
});
