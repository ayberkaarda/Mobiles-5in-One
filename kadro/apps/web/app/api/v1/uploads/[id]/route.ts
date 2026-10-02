import { ENDPOINTS } from '@kadro/contracts';

import { json, route } from '../../../../../lib/server/http';
import { getUpload } from '../../../../../lib/server/uploads/uploads';

export const dynamic = 'force-dynamic';

/** Status of an upload; the uploader only, everyone else 404 (matrix §3.7 footnote 31). */
export const GET = route({
  path: '/api/v1/uploads/[id]',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.getUpload.params,
  query: ENDPOINTS.getUpload.query,
  body: ENDPOINTS.getUpload.body,
  limitGroup: ENDPOINTS.getUpload.rateLimit,
  handler: async ({ params, ctx, runtime }) => json(await getUpload({ ctx, runtime }, params.id)),
});
