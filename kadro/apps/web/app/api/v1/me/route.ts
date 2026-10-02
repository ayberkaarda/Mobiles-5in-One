import { ENDPOINTS, updateMeRequestSchema } from '@kadro/contracts';

import { requestAccountDeletion } from '../../../../lib/server/account/deletion';
import { readMe, updateMe } from '../../../../lib/server/auth/me';
import { ApiError } from '../../../../lib/server/errors';
import { json, route } from '../../../../lib/server/http';
import { noParams, noQuery } from '../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/** The caller's own profile (matrix §3.2). */
export const GET = route({
  path: '/api/v1/me',
  method: 'GET',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: null,
  handler: async ({ ctx, runtime }) => {
    await ctx.authorize('me.read');
    if (ctx.principal === null) {
      throw new ApiError('unauthenticated');
    }
    return json(await readMe(runtime, ctx.principal.userId));
  },
});

/** Updates the self-writable profile fields of matrix §4.1 (strict body). */
export const PATCH = route({
  path: '/api/v1/me',
  method: 'PATCH',
  auth: 'required',
  params: noParams,
  query: noQuery,
  body: updateMeRequestSchema,
  handler: async ({ body, ctx, runtime }) => {
    await ctx.authorize('me.update');
    if (ctx.principal === null) {
      throw new ApiError('unauthenticated');
    }
    return json(await updateMe(runtime, ctx.principal.userId, body));
  },
});

/**
 * Starts account deletion (matrix §3.2 footnotes 4 and 5, ADR-0032): re-authentication proof,
 * immediate deactivation, 7-day grace period; rate limit group D.
 */
export const DELETE = route({
  path: '/api/v1/me',
  method: 'DELETE',
  auth: 'required',
  params: ENDPOINTS.deleteMe.params,
  query: ENDPOINTS.deleteMe.query,
  body: ENDPOINTS.deleteMe.body,
  limitGroup: ENDPOINTS.deleteMe.rateLimit,
  handler: async ({ body, ctx, runtime }) =>
    json(await requestAccountDeletion({ ctx, runtime }, body), { status: 202 }),
});
