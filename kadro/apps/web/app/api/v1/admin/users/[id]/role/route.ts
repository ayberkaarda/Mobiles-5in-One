import { ENDPOINTS } from '@kadro/contracts';

import { setUserRole } from '../../../../../../../lib/server/admin/users';
import { json, route } from '../../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

const endpoint = ENDPOINTS.setUserRole;

/** Changes a user's platform role (admin + step-up + fresh TOTP; audited). */
export const PATCH = route({
  path: '/api/v1/admin/users/[id]/role',
  method: 'PATCH',
  auth: 'required',
  params: endpoint.params,
  query: endpoint.query,
  body: endpoint.body,
  limitGroup: endpoint.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await setUserRole({ ctx, runtime }, params.id, body)),
});
