import { type HealthResponse, healthResponseSchema } from '@kadro/contracts';

import { json, route } from '../../../../lib/server/http';
import { noParams, noQuery } from '../../../../lib/server/validate';

export const dynamic = 'force-dynamic';

/**
 * Uptime probe. It has no user principal, so like the webhook it does not require
 * `x-kadro-client` (container health checks and uptime monitors do not send it).
 */
export const GET = route({
  path: '/api/v1/health',
  method: 'GET',
  client: 'exempt',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: null,
  handler: ({ runtime }) => {
    const body: HealthResponse = healthResponseSchema.parse({
      status: 'ok',
      service: 'kadro-web',
      environment: runtime.env.APP_ENV,
      buildSha: runtime.env.BUILD_SHA,
      time: runtime.now().toISOString(),
    });
    return json(body);
  },
});
