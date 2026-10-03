import { ENDPOINTS } from '@kadro/contracts';

import { deleteAdminReview } from '../../../../../../lib/server/admin/moderation';
import { route } from '../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.deleteAdminReview;

/** Removes a venue review (staff + step-up; audited). */
export const DELETE = route({
  path: '/api/v1/admin/reviews/[id]',
  method: 'DELETE',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ params, ctx, runtime }) => {
    await deleteAdminReview({ ctx, runtime }, params.id);
    return new Response(null, { status: 204 });
  },
});
