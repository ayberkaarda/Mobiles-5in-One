import { googleSignInRequestSchema } from '@kadro/contracts';

import { signInContext } from '../../../../../lib/server/auth/context';
import { providerSignIn } from '../../../../../lib/server/auth/provider-sign-in';
import { route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/** Sign in with Google: ID token checked against Google's keys and the allowed client ids. */
export const POST = route({
  path: '/api/v1/auth/google',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: googleSignInRequestSchema,
  rateLimit: { group: 'auth' },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.google');
    return providerSignIn(signInContext(runtime, ctx), 'google', {
      token: body.idToken,
      nonce: body.nonce,
      deviceLabel: body.deviceLabel,
    });
  },
});
