import { ENDPOINT_LIST, type EndpointDefinition } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import { type RegisteredRoute, registeredRoute } from '../../lib/server/http';
import * as teamMatchesRoute from '../../app/api/v1/teams/[id]/matches/route';
import * as matchRoute from '../../app/api/v1/matches/[id]/route';
import * as rsvpRoute from '../../app/api/v1/matches/[id]/rsvp/route';
import * as lineupRoute from '../../app/api/v1/matches/[id]/lineup/route';
import * as paymentRoute from '../../app/api/v1/matches/[id]/payments/[userId]/route';
import * as mvpRoute from '../../app/api/v1/matches/[id]/mvp-vote/route';

/**
 * The match Route Handlers take params, query, body and the rate-limit group from the endpoint
 * registry of `@kadro/contracts` and restate path, method and auth literally (the registry test of
 * `packages/contracts` reads them from the source). This proves both agree object by object and
 * that every `matches`-tagged endpoint has its handler with the registry's group.
 */

const MODULES = [
  teamMatchesRoute,
  matchRoute,
  rsvpRoute,
  lineupRoute,
  paymentRoute,
  mvpRoute,
] as const;

const routes: RegisteredRoute[] = MODULES.flatMap((module) =>
  Object.values(module).flatMap((value) => {
    const spec = registeredRoute(value);
    return spec === undefined ? [] : [spec];
  }),
);

const owned: EndpointDefinition[] = ENDPOINT_LIST.filter((endpoint) => endpoint.tag === 'matches');

function bodySchemas(endpoint: EndpointDefinition): unknown[] {
  if (endpoint.body === null) {
    return [];
  }
  return 'byClient' in endpoint.body ? Object.values(endpoint.body.byClient) : [endpoint.body];
}

describe('match routes match the endpoint registry', () => {
  it('has one handler per registry endpoint and no extra handler', () => {
    expect(owned).toHaveLength(9);
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
