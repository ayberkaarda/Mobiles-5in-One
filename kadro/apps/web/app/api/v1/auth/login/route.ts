import { loginRequestSchema } from '@kadro/contracts';

import { signInContext } from '../../../../../lib/server/auth/context';
import { loginWithPassword } from '../../../../../lib/server/auth/sign-in';
import { route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/**
 * Password sign-in. Mobile receives an access JWT and a refresh token; web receives the
 * `__Host-` session and CSRF cookies. Every failure is 401 `invalid_credentials`. Rate limit
 * group A (IP and email) with progressive delay after repeated failures.
 */
export const POST = route({
  path: '/api/v1/auth/login',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: loginRequestSchema,
  rateLimit: { group: 'auth', email: (body) => body.email },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.login');
    return loginWithPassword(signInContext(runtime, ctx), body);
  },
});
