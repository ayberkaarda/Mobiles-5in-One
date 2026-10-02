import { appleSignInRequestSchema } from '@kadro/contracts';

import { signInContext } from '../../../../../lib/server/auth/context';
import { providerSignIn } from '../../../../../lib/server/auth/provider-sign-in';
import { route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/** Sign in with Apple: identity token checked against Apple's keys, audience and nonce. */
export const POST = route({
  path: '/api/v1/auth/apple',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: appleSignInRequestSchema,
  rateLimit: { group: 'auth' },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.apple');
    return providerSignIn(signInContext(runtime, ctx), 'apple', {
      token: body.identityToken,
      nonce: body.nonce,
      displayName: body.displayName,
      deviceLabel: body.deviceLabel,
    });
  },
});
