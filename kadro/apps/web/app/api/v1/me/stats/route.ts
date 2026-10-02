import { ENDPOINTS } from '@kadro/contracts';

import { readMyStats } from '../../../../../lib/server/auth/stats';
import { ApiError } from '../../../../../lib/server/errors';
import { json, route } from '../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/**
 * The caller's profile statistics (matrix §3.2 and §7, ADR-0065): the basic tier for everyone,
 * the full tier with the advanced block only while the caller holds Pro.
 */
export const GET = route({
  path: '/api/v1/me/stats',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.getMyStats.params,
  query: ENDPOINTS.getMyStats.query,
  body: null,
  handler: async ({ ctx, runtime }) => {
    await ctx.authorize('me.read');
    if (ctx.principal === null) {
      throw new ApiError('unauthenticated');
    }
    return json(await readMyStats(runtime, ctx.principal.userId, ctx.principal.isPro));
  },
});
