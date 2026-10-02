import { type AcceptedResponse, registerRequestSchema } from '@kadro/contracts';

import { register } from '../../../../../lib/server/auth/account-flows';
import { flowContext } from '../../../../../lib/server/auth/context';
import { json, route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

const ACCEPTED: AcceptedResponse = { status: 'accepted' };

/**
 * Registration (ADR-0015): 202 with the same body whether or not the email is taken; no session
 * is issued, the client signs in next. Rate limit group A (IP and email).
 */
export const POST = route({
  path: '/api/v1/auth/register',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: registerRequestSchema,
  rateLimit: { group: 'auth', email: (body) => body.email },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.register');
    await register(flowContext(runtime, ctx), body);
    return json(ACCEPTED, { status: 202 });
  },
});
