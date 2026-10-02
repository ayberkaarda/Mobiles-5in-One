import { resetPasswordRequestSchema } from '@kadro/contracts';

import { resetPassword } from '../../../../../lib/server/auth/account-flows';
import { flowContext } from '../../../../../lib/server/auth/context';
import { ApiError } from '../../../../../lib/server/errors';
import { route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/**
 * Sets a new password with a single-use reset token (1 h) and revokes every session of the
 * account. Rate limit group A (IP).
 */
export const POST = route({
  path: '/api/v1/auth/reset',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: resetPasswordRequestSchema,
  rateLimit: { group: 'auth' },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.reset');
    try {
      await resetPassword(flowContext(runtime, ctx), body);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'token_invalid') {
        await ctx.authAttempts?.recordFailure();
      }
      throw error;
    }
    return new Response(null, { status: 204 });
  },
});
