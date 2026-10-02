import { REFRESH_REQUEST_SCHEMAS } from '@kadro/contracts';

import { requestClient } from '../../../../../lib/server/auth/context';
import { presentedRefreshToken, refreshSession } from '../../../../../lib/server/auth/refresh';
import { route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/**
 * Rotates a mobile refresh token (body) or a web session cookie (CSRF required). Reuse of a
 * rotated token, or two concurrent uses of one token, revokes the whole family (ADR-0019).
 * Rate limit group R (per family).
 */
export const POST = route({
  path: '/api/v1/auth/refresh',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: { byClient: REFRESH_REQUEST_SCHEMAS },
  handler: async ({ body, ctx, runtime, request }) => {
    await ctx.authorize('auth.refresh');
    const client = requestClient(ctx);
    const token = presentedRefreshToken(runtime, client, request, body);
    return refreshSession({ runtime, client, request, ip: ctx.ip, logger: ctx.logger }, token);
  },
});
