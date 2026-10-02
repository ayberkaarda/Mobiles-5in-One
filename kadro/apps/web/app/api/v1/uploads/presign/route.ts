import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../lib/server/http';
import { presignUpload } from '../../../../../lib/server/uploads/uploads';

export const dynamic = 'force-dynamic';

/**
 * Presigned PUT for an avatar or a team badge (matrix §3.7, ADR-0030); rate limit group U
 * (10 per user per rolling 24 h).
 */
export const POST = route({
  path: '/api/v1/uploads/presign',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.presignUpload.params,
  query: ENDPOINTS.presignUpload.query,
  body: ENDPOINTS.presignUpload.body,
  limitGroup: ENDPOINTS.presignUpload.rateLimit,
  handler: async ({ body, ctx, runtime }) =>
    json(await presignUpload({ ctx, runtime }, body), { status: 201 }),
});
