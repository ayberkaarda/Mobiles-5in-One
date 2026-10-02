import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../../lib/server/http';
import { completeUpload } from '../../../../../../lib/server/uploads/uploads';

export const dynamic = 'force-dynamic';

/**
 * Hands an uploaded image to the worker (`upload.process`); the uploader only, from `pending`,
 * within one hour of presigning (matrix §3.7 footnote 31, ADR-0030).
 */
export const POST = route({
  path: '/api/v1/uploads/[id]/complete',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.completeUpload.params,
  query: ENDPOINTS.completeUpload.query,
  body: ENDPOINTS.completeUpload.body,
  limitGroup: ENDPOINTS.completeUpload.rateLimit,
  handler: async ({ params, ctx, runtime }) =>
    json(await completeUpload({ ctx, runtime }, params.id), { status: 202 }),
});
