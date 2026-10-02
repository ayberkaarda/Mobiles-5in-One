import { ENDPOINT_LIST, type EndpointDefinition } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import { type RegisteredRoute, registeredRoute } from '../../lib/server/http';
import * as openCallsRoute from '../../app/api/v1/open-calls/route';
import * as applicationsRoute from '../../app/api/v1/open-calls/[id]/applications/route';
import * as applicationRoute from '../../app/api/v1/open-calls/[id]/applications/[appId]/route';
import * as matchOpenCallRoute from '../../app/api/v1/matches/[id]/open-call/route';
import * as venuesRoute from '../../app/api/v1/venues/route';
import * as venueRoute from '../../app/api/v1/venues/[slug]/route';
import * as reviewsRoute from '../../app/api/v1/venues/[slug]/reviews/route';
import * as ownReviewRoute from '../../app/api/v1/venues/[slug]/reviews/mine/route';

/**
 * The open-call, application, venue and review Route Handlers take their schemas and rate-limit
 * group from the endpoint registry of `@kadro/contracts` and restate path, method and auth
 * literally (the registry test of `packages/contracts` reads them from the source). This proves
 * that both agree object by object, that the group the wrapper charges is the registry's, and
 * that every `open-calls` and `venues` registry endpoint has exactly one handler.
 */

const MODULES = [
  openCallsRoute,
  applicationsRoute,
  applicationRoute,
  matchOpenCallRoute,
  venuesRoute,
  venueRoute,
  reviewsRoute,
  ownReviewRoute,
] as const;

const routes: RegisteredRoute[] = MODULES.flatMap((module) =>
  Object.values(module).flatMap((value) => {
    const spec = registeredRoute(value);
    return spec === undefined ? [] : [spec];
  }),
);

const owned: EndpointDefinition[] = ENDPOINT_LIST.filter(
  (endpoint) => endpoint.tag === 'open-calls' || endpoint.tag === 'venues',
);

function bodySchemas(endpoint: EndpointDefinition): unknown[] {
  if (endpoint.body === null) {
    return [];
  }
  return 'byClient' in endpoint.body ? Object.values(endpoint.body.byClient) : [endpoint.body];
}

describe('open-call and venue routes match the endpoint registry', () => {
  it('has one handler per registry endpoint and no extra handler', () => {
    expect(owned).toHaveLength(11);
    expect(routes.map((route) => `${route.method} ${route.path}`).sort()).toEqual(
      owned.map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort(),
    );
  });

  for (const endpoint of owned) {
    it(`${endpoint.id}: ${endpoint.method} ${endpoint.path}`, () => {
      const route = routes.find(
        (candidate) => candidate.method === endpoint.method && candidate.path === endpoint.path,
      );
      expect(route).toBeDefined();
      expect(route?.auth).toBe(endpoint.auth);
      expect(route?.client).toBe(endpoint.client);
      expect(route?.params).toBe(endpoint.params);
      expect(route?.query).toBe(endpoint.query);
      expect(route?.bodies).toEqual(bodySchemas(endpoint));
      expect(route?.limitGroup).toBe(endpoint.rateLimit);
    });
  }
});
