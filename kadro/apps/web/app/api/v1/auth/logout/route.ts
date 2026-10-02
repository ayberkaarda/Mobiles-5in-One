import { LOGOUT_REQUEST_SCHEMAS } from '@kadro/contracts';

import { logout } from '../../../../../lib/server/auth/logout';
import { ApiError } from '../../../../../lib/server/errors';
import { route } from '../../../../../lib/server/http';
import { noParams, noQuery } from '../../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/** Ends the caller's session (refresh family); web cookies are expired. */
export const POST = route({
  path: '/api/v1/auth/logout',
  method: 'POST',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: { byClient: LOGOUT_REQUEST_SCHEMAS },
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('auth.logout');
    if (ctx.principal === null) {
      throw new ApiError('unauthenticated');
    }
    return logout(runtime, ctx.principal, {
      refreshToken: 'refreshToken' in body ? body.refreshToken : undefined,
      ip: ctx.ip,
    });
  },
});
