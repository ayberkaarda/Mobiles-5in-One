import { type AcceptedResponse, forgotPasswordRequestSchema } from '@kadro/contracts';

import { forgotPassword } from '../../../../../lib/server/auth/account-flows';
import { flowContext } from '../../../../../lib/server/auth/context';
import { json, route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

const ACCEPTED: AcceptedResponse = { status: 'accepted' };

/**
 * Password reset request (ADR-0015, ADR-0029): always 202 with the same body; one `email.send`
 * job is enqueued whatever the account state. Rate limit group A (IP and email).
 */
export const POST = route({
  path: '/api/v1/auth/forgot',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: forgotPasswordRequestSchema,
  rateLimit: { group: 'auth', email: (body) => body.email },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.forgot');
    await forgotPassword(flowContext(runtime, ctx), body.email);
    return json(ACCEPTED, { status: 202 });
  },
});
