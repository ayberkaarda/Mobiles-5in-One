import { ENDPOINT_LIST, type EndpointDefinition } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import { type RegisteredRoute, registeredRoute } from '../../lib/server/http';
import * as teamsRoute from '../../app/api/v1/teams/route';
import * as teamRoute from '../../app/api/v1/teams/[id]/route';
import * as invitesRoute from '../../app/api/v1/teams/[id]/invites/route';
import * as inviteRoute from '../../app/api/v1/teams/[id]/invites/[inviteId]/route';
import * as memberRoute from '../../app/api/v1/teams/[id]/members/[userId]/route';
import * as previewRoute from '../../app/api/v1/invites/[code]/route';
import * as acceptRoute from '../../app/api/v1/invites/[code]/accept/route';

/**
 * The team, invite and member Route Handlers take their schemas from the endpoint registry of
 * `@kadro/contracts` and restate path, method and auth literally (the registry test of
 * `packages/contracts` reads them from the source). This proves that both agree, schema object by
 * schema object, and that every `teams`-tagged registry endpoint outside `matches` has a handler.
 */

const MODULES = [
  teamsRoute,
  teamRoute,
  invitesRoute,
  inviteRoute,
  memberRoute,
  previewRoute,
  acceptRoute,
] as const;

const routes: RegisteredRoute[] = MODULES.flatMap((module) =>
  Object.values(module).flatMap((value) => {
    const spec = registeredRoute(value);
    return spec === undefined ? [] : [spec];
  }),
);

const owned: EndpointDefinition[] = ENDPOINT_LIST.filter(
  (endpoint) => endpoint.tag === 'teams' && !endpoint.path.endsWith('/matches'),
);

function bodySchemas(endpoint: EndpointDefinition): unknown[] {
  if (endpoint.body === null) {
    return [];
  }
  return 'byClient' in endpoint.body ? Object.values(endpoint.body.byClient) : [endpoint.body];
}

describe('team routes match the endpoint registry', () => {
  it('has one handler per registry endpoint and no extra handler', () => {
    expect(owned).toHaveLength(12);
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
    });
  }
});
