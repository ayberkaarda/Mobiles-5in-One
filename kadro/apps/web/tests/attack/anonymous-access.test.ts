import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { call } from '../support/http';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { bootstrapJobQueues } from '../support/jobs';
import { installTestRuntime, type TestRuntime } from '../support/runtime';
import { anonMobile, concretePath, fabricatedParams, loadRoutes, type LoadedRoute } from './support';

/**
 * Anonymous BOLA / IDOR sweep (threat model §5, checklist item 4), derived from the endpoint
 * registry. Every id-bearing protected route is called by an anonymous caller — a valid
 * `x-kadro-client` header but no bearer token and no session cookie — with a fabricated id in each
 * path segment. The API must reject the request at authentication (401 `unauthenticated`) before it
 * ever loads the addressed resource, so an unauthenticated attacker learns nothing about whether
 * the id exists. Public routes (`auth: optional | none`) are probed with the same hostile ids to
 * prove they answer a client error, never a 5xx that would leak a stack trace (T-PLT-05).
 *
 * The cross-user ("as another user") half of the BOLA matrix is owned by
 * `tests/security/idor.test.ts`, whose route-coverage block already fails when a protected route
 * has no cross-tenant row; this suite adds the anonymous half over the whole registry.
 */

let database: TestDatabase;
let harness: TestRuntime;
let routes: LoadedRoute[];

beforeAll(async () => {
  database = await createMigratedDatabase('web_attack_anon');
  await bootstrapJobQueues(database.url);
  harness = await installTestRuntime({
    db: database.client.db,
    // A present (dummy) webhook secret makes the signature check answer 401, not 503, so the
    // webhook route is probed like the others instead of reporting a missing configuration. A
    // 43-char (256-bit) base64url-shaped value built from plain words: obviously fake, zero entropy.
    env: {
      DATABASE_URL: database.url,
      REVENUECAT_WEBHOOK_SECRET: 'not-a-real-webhook-secret'.padEnd(43, 'x'),
    },
  });
});

afterAll(async () => {
  await harness.runtime.jobClient.close();
  await database.dispose();
});

async function probe(route: LoadedRoute): Promise<{ status: number; body: string }> {
  const params = fabricatedParams(route.spec.path);
  const response = await call(route.handler, {
    method: route.spec.method,
    headers: anonMobile(),
    params,
    path: concretePath(route.spec.path, params),
  });
  return { status: response.status, body: await response.text() };
}

describe('anonymous access sweep over the endpoint registry', () => {
  it('finds the registered routes', async () => {
    routes = await loadRoutes();
    expect(routes.length).toBeGreaterThan(40);
  });

  it('rejects every protected route with 401 unauthenticated and leaks no resource', async () => {
    const offenders: string[] = [];
    for (const route of routes.filter((entry) => entry.spec.auth === 'required')) {
      const { status, body } = await probe(route);
      let code: unknown;
      try {
        code = (JSON.parse(body) as { code?: unknown }).code;
      } catch {
        code = '<non-json>';
      }
      if (status !== 401 || code !== 'unauthenticated') {
        offenders.push(`${route.key} -> ${status} ${String(code)}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('answers public routes with a client error, never a 5xx that leaks internals', async () => {
    const offenders: string[] = [];
    for (const route of routes.filter((entry) => entry.spec.auth !== 'required')) {
      const { status, body } = await probe(route);
      if (status >= 500) {
        offenders.push(`${route.key} -> ${status}`);
      }
      // A forced-500 body would carry a generic problem shape only; a stack trace must never appear.
      expect(body).not.toMatch(/\n\s+at\s+/);
      expect(body.toLowerCase()).not.toContain('postgres');
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
