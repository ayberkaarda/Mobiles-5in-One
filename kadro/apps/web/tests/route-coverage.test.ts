import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ENDPOINT_LIST, ENDPOINTS } from '@kadro/contracts';

import { HTTP_METHODS, json, registeredRoute, route } from '../lib/server/http';
import { isStrictObjectSchema, noParams, noQuery } from '../lib/server/validate';

/**
 * Threat model §6.1, "Every route registered through the wrapper": enumerates every Route Handler
 * under `app/api/v1` and fails when an exported HTTP method was not built by `route()`, or when its
 * spec lacks a strict params, query or body schema. A new endpoint therefore cannot ship without
 * client-type, authentication, validation, error and logging handling.
 */

const API_ROOT = fileURLToPath(new URL('../app/api/v1/', import.meta.url));

/** Methods Next.js dispatches to Route Handlers. HEAD is derived from GET, OPTIONS is the proxy's. */
const NEXT_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const;

/**
 * Endpoints that may run without a required principal, with the `auth` modes they may use
 * (authorization matrix §3.1 `anon` = Y, health, webhook). Every other route must declare
 * `auth: 'required'`; adding a public endpoint means adding it here in the same change.
 */
const PUBLIC_AUTH: ReadonlyMap<string, readonly string[]> = new Map([
  ['/api/v1/health', ['none']],
  ['/api/v1/webhooks/revenuecat', ['none']],
  ['/api/v1/auth/register', ['none']],
  ['/api/v1/auth/login', ['none']],
  ['/api/v1/auth/refresh', ['none']],
  ['/api/v1/auth/verify-email', ['none']],
  ['/api/v1/auth/forgot', ['none']],
  ['/api/v1/auth/reset', ['none']],
  ['/api/v1/auth/apple', ['none']],
  ['/api/v1/auth/google', ['none']],
  // Invite preview: anonymous callers allowed (matrix §3.3 footnote 28, ADR-0034).
  ['/api/v1/invites/[code]', ['optional']],
  // Public reads with creator visibility (matrix §3.5 footnote 18, §3.6, ADR-0038). `POST venues`
  // on the same path stays `required`.
  ['/api/v1/open-calls', ['optional']],
  ['/api/v1/venues', ['optional']],
  ['/api/v1/venues/[slug]', ['optional']],
]);

/** Endpoints without a user principal that may omit `x-kadro-client` (ADR-0014). */
const CLIENT_EXEMPT = new Set(['/api/v1/health', '/api/v1/webhooks/revenuecat']);

function routeFiles(directory: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks the repository's own app/api tree
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(full);
    }
    return /^route\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

/** `app/api/v1/teams/[id]/route.ts` → `/api/v1/teams/[id]`; route groups `(x)` are dropped. */
function routePattern(file: string): string {
  const relative = path.relative(API_ROOT, path.dirname(file));
  const segments = relative
    .split(path.sep)
    .filter((segment) => segment !== '' && !/^\(.+\)$/.test(segment));
  return ['/api/v1', ...segments].join('/').replace(/\/$/, '');
}

/** Every reason the module's handlers fail the coverage rules; empty when compliant. */
function coverageProblems(pattern: string, routeModule: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const exported = NEXT_METHODS.filter((method) => Object.hasOwn(routeModule, method));
  if (exported.length === 0) {
    problems.push(`${pattern} exports no HTTP method`);
  }
  for (const method of exported) {
    if (!(HTTP_METHODS as readonly string[]).includes(method)) {
      problems.push(`${pattern} exports ${method}; HEAD follows GET and OPTIONS is the proxy's`);
      continue;
    }
    const spec = registeredRoute(routeModule[method]);
    if (spec === undefined) {
      problems.push(`${method} ${pattern} is not wrapped with route()`);
      continue;
    }
    if (spec.method !== method || spec.path !== pattern) {
      problems.push(`${method} ${pattern} is registered as ${spec.method} ${spec.path}`);
    }
    if (!isStrictObjectSchema(spec.params) || !isStrictObjectSchema(spec.query)) {
      problems.push(`${method} ${pattern} params and query must be strict objects`);
    }
    if (!spec.bodies.every(isStrictObjectSchema)) {
      problems.push(`${method} ${pattern} body must be a strict object`);
    }
    if (['POST', 'PUT', 'PATCH'].includes(method) && spec.bodies.length === 0) {
      problems.push(`${method} ${pattern} needs a body schema`);
    }
    const publicModes = PUBLIC_AUTH.get(pattern);
    if (publicModes === undefined) {
      if (spec.auth !== 'required') {
        problems.push(`${method} ${pattern} must use auth 'required' (found '${spec.auth}')`);
      }
    } else if (spec.auth !== 'required' && !publicModes.includes(spec.auth)) {
      problems.push(`${method} ${pattern} may not use auth '${spec.auth}'`);
    }
    if (spec.client === 'exempt' && !CLIENT_EXEMPT.has(pattern)) {
      problems.push(`${method} ${pattern} may not skip x-kadro-client`);
    }
  }
  return problems;
}

const files = routeFiles(API_ROOT);

describe('route coverage (threat model §6.1)', () => {
  it('finds the API route handlers', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const pattern = routePattern(file);
    it(`${pattern}: every exported method goes through route()`, async () => {
      const routeModule = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      expect(coverageProblems(pattern, routeModule)).toEqual([]);
    });
  }
});

describe('route coverage rules', () => {
  const wrapped = route({
    path: '/api/v1/sample',
    method: 'POST',
    auth: 'required',
    params: noParams,
    query: noQuery,
    body: z.strictObject({ name: z.string() }),
    handler: () => json({}),
  });

  it('accepts a wrapped handler registered under its own path and method', () => {
    expect(coverageProblems('/api/v1/sample', { POST: wrapped, dynamic: 'force-dynamic' })).toEqual(
      [],
    );
  });

  it('flags a plain function exported as a handler', () => {
    const plain = () => Promise.resolve(new Response('{}'));
    expect(coverageProblems('/api/v1/sample', { GET: plain })).toEqual([
      'GET /api/v1/sample is not wrapped with route()',
    ]);
  });

  it('flags a wrapped handler exported under another method or path', () => {
    expect(coverageProblems('/api/v1/sample', { PUT: wrapped })).toHaveLength(1);
    expect(coverageProblems('/api/v1/other', { POST: wrapped })).toHaveLength(1);
  });

  it('flags OPTIONS and HEAD exports and modules without handlers', () => {
    expect(coverageProblems('/api/v1/sample', { OPTIONS: wrapped })).toHaveLength(1);
    expect(coverageProblems('/api/v1/sample', { HEAD: wrapped })).toHaveLength(1);
    expect(coverageProblems('/api/v1/sample', { dynamic: 'force-dynamic' })).toHaveLength(1);
  });

  it('flags a protected route that does not require authentication', () => {
    for (const auth of ['none', 'optional'] as const) {
      const me = route({
        path: '/api/v1/me',
        method: 'GET',
        auth,
        params: noParams,
        query: noQuery,
        body: null,
        handler: () => json({}),
      });
      expect(coverageProblems('/api/v1/me', { GET: me })).toEqual([
        `GET /api/v1/me must use auth 'required' (found '${auth}')`,
      ]);
    }
  });

  it('accepts unauthenticated access only on allow-listed public endpoints', () => {
    const login = route({
      path: '/api/v1/auth/login',
      method: 'POST',
      auth: 'none',
      params: noParams,
      query: noQuery,
      body: z.strictObject({}),
      handler: () => json({}),
    });
    expect(coverageProblems('/api/v1/auth/login', { POST: login })).toEqual([]);
    const logout = route({
      path: '/api/v1/auth/logout',
      method: 'POST',
      auth: 'none',
      params: noParams,
      query: noQuery,
      body: z.strictObject({}),
      handler: () => json({}),
    });
    expect(coverageProblems('/api/v1/auth/logout', { POST: logout })).toHaveLength(1);
  });

  it('flags a client-header exemption outside the allow-list', () => {
    const exempt = route({
      path: '/api/v1/sample',
      method: 'GET',
      client: 'exempt',
      auth: 'required',
      params: noParams,
      query: noQuery,
      body: null,
      handler: () => json({}),
    });
    expect(coverageProblems('/api/v1/sample', { GET: exempt })).toEqual([
      'GET /api/v1/sample may not skip x-kadro-client',
    ]);
  });
});

// Match, RSVP, lineup, payment and MVP routes (matrix §3.4, §8): the group `route()` charges is
// the registry's `rateLimit`, so the limiter, the registry and the matrix cannot drift apart.
describe('match routes charge the registry rate-limit group', () => {
  const matchFiles = files.filter((file) => {
    const pattern = routePattern(file);
    return ENDPOINT_LIST.some(
      (endpoint) => endpoint.tag === 'matches' && endpoint.path === pattern,
    );
  });

  it('finds every match route file', () => {
    expect(matchFiles).toHaveLength(6);
  });

  for (const file of matchFiles) {
    const pattern = routePattern(file);
    it(`${pattern}: limitGroup equals ENDPOINTS.rateLimit`, async () => {
      const routeModule = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(routeModule)) {
        const spec = registeredRoute(value);
        if (spec === undefined) {
          continue;
        }
        const endpoint = ENDPOINT_LIST.find(
          (candidate) => candidate.path === spec.path && candidate.method === spec.method,
        );
        expect(endpoint, `${spec.method} ${spec.path}`).toBeDefined();
        expect(spec.limitGroup, `${spec.method} ${spec.path}`).toBe(endpoint?.rateLimit);
      }
    });
  }
});

// Team, invite and member routes (matrix §3.3, §8): groups G and I are charged by `route()` from
// the registry, not by the services.
describe('team routes charge the registry rate-limit group', () => {
  const teamFiles = files.filter((file) => {
    const pattern = routePattern(file);
    return ENDPOINT_LIST.some((endpoint) => endpoint.tag === 'teams' && endpoint.path === pattern);
  });

  it('finds every team, invite and member route file', () => {
    expect(teamFiles).toHaveLength(7);
  });

  for (const file of teamFiles) {
    const pattern = routePattern(file);
    it(`${pattern}: limitGroup equals ENDPOINTS.rateLimit`, async () => {
      const routeModule = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      for (const value of Object.values(routeModule)) {
        const spec = registeredRoute(value);
        if (spec === undefined) {
          continue;
        }
        const endpoint = ENDPOINT_LIST.find(
          (candidate) => candidate.path === spec.path && candidate.method === spec.method,
        );
        expect(endpoint, `${spec.method} ${spec.path}`).toBeDefined();
        expect(spec.limitGroup, `${spec.method} ${spec.path}`).toBe(endpoint?.rateLimit);
      }
    });
  }
});

// Upload, push-token and account deletion routes (matrix §3.2, §3.7, §8): each handler is
// registered with the registry's path, method, schemas and rate-limit group.
describe('upload, push-token and deletion routes match their registry entries', () => {
  const ids = [
    'presignUpload',
    'completeUpload',
    'getUpload',
    'registerPushToken',
    'deleteMe',
  ] as const;

  for (const id of ids) {
    const endpoint = ENDPOINTS[id];
    it(`${endpoint.method} ${endpoint.path}: schemas and limitGroup come from ENDPOINTS.${id}`, async () => {
      const file = files.find((candidate) => routePattern(candidate) === endpoint.path);
      expect(file, endpoint.path).toBeDefined();
      const routeModule = (await import(pathToFileURL(file ?? '').href)) as Record<string, unknown>;
      const spec = registeredRoute(routeModule[endpoint.method]);
      expect(spec, `${endpoint.method} ${endpoint.path}`).toBeDefined();
      expect(spec?.path).toBe(endpoint.path);
      expect(spec?.method).toBe(endpoint.method);
      expect(spec?.auth).toBe(endpoint.auth);
      expect(spec?.params).toBe(endpoint.params);
      expect(spec?.query).toBe(endpoint.query);
      expect(spec?.bodies).toEqual(endpoint.body === null ? [] : [endpoint.body]);
      expect(spec?.limitGroup).toBe(endpoint.rateLimit);
    });
  }
});
