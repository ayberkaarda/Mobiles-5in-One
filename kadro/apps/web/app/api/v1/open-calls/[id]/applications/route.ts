import { ENDPOINTS } from '@kadro/contracts';

import {
  createApplication,
  listApplications,
} from '../../../../../../lib/server/calls/applications';
import { json, route } from '../../../../../../lib/server/http';

export const dynamic = 'force-dynamic';

/** Applications of a call: staff see all, an applicant their own row (matrix §3.5, ADR-0041). */
export const GET = route({
  path: '/api/v1/open-calls/[id]/applications',
  method: 'GET',
  auth: 'required',
  params: ENDPOINTS.listApplications.params,
  query: ENDPOINTS.listApplications.query,
  body: ENDPOINTS.listApplications.body,
  limitGroup: ENDPOINTS.listApplications.rateLimit,
  handler: async ({ params, query, ctx, runtime }) =>
    json(await listApplications({ ctx, runtime }, params.id, query)),
});

/** Applies to an open call (matrix §3.5 `application.create`, footnote 20, ADR-0003, ADR-0010). */
export const POST = route({
  path: '/api/v1/open-calls/[id]/applications',
  method: 'POST',
  auth: 'required',
  params: ENDPOINTS.createApplication.params,
  query: ENDPOINTS.createApplication.query,
  body: ENDPOINTS.createApplication.body,
  limitGroup: ENDPOINTS.createApplication.rateLimit,
  handler: async ({ params, body, ctx, runtime }) =>
    json(await createApplication({ ctx, runtime }, params.id, body), { status: 201 }),
});
