import { ENDPOINTS } from '@kadro/contracts';

import { listDistricts } from '../../../../lib/server/districts/districts';
import { json, route } from '../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/**
 * Provinces and districts for pickers and maps. Public reference data: `x-kadro-client` is still
 * required, there is no principal and no policy action (matrix §3.7). Like every `/api` response
 * it is `no-store`; the registry only allows, not requires, a shared cache.
 */
export const GET = route({
  path: '/api/v1/districts',
  method: 'GET',
  auth: 'none',
  params: ENDPOINTS.listDistricts.params,
  query: ENDPOINTS.listDistricts.query,
  body: ENDPOINTS.listDistricts.body,
  limitGroup: ENDPOINTS.listDistricts.rateLimit,
  handler: async ({ query, runtime }) => json(await listDistricts(runtime, query)),
});
