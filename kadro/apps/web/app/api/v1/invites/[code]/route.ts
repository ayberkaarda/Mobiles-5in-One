import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../lib/server/http';
import { previewInvite } from '../../../../../lib/server/teams/invites';

export const dynamic = 'force-dynamic';

/**
 * What the invite landing page shows for a code; anonymous callers allowed, rate limit group I
 * (matrix §3.3 `invite.preview`, footnote 28). Every unusable code answers the same 404.
 */
export const GET = route({
  path: '/api/v1/invites/[code]',
  method: 'GET',
  auth: 'optional',
  params: ENDPOINTS.previewInvite.params,
  query: ENDPOINTS.previewInvite.query,
  body: ENDPOINTS.previewInvite.body,
  limitGroup: ENDPOINTS.previewInvite.rateLimit,
  handler: async ({ params, ctx, runtime }) =>
    json(await previewInvite({ ctx, runtime }, params.code)),
});
