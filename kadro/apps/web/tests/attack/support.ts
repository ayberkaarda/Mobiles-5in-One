import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type RegisteredRoute, registeredRoute, type RouteHandler } from '../../lib/server/http';
import { MOBILE } from '../support/http';

/**
 * Shared loader for the Phase 6 attack suite. It walks `app/api/v1`, collects every handler built
 * by `route()` with its recorded spec, and offers helpers to drive a handler the way the adversary
 * scripts below do: fabricated path ids, no credentials, hostile headers and bodies. The suites
 * assert the server's observable answer (status, problem code, side effects), never its internals.
 */

export interface LoadedRoute {
  readonly key: string;
  readonly spec: RegisteredRoute;
  readonly handler: RouteHandler;
}

const API_ROOT = fileURLToPath(new URL('../../app/api/v1/', import.meta.url));

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

/** Every Route Handler under `app/api/v1`, with its `route()` spec, keyed by `METHOD path`. */
export async function loadRoutes(): Promise<LoadedRoute[]> {
  const routes: LoadedRoute[] = [];
  for (const file of routeFiles(API_ROOT)) {
    const routeModule = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(routeModule)) {
      const spec = registeredRoute(value);
      if (spec !== undefined) {
        routes.push({ key: `${spec.method} ${spec.path}`, spec, handler: value as RouteHandler });
      }
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

/** Names of the dynamic segments in a Next.js route pattern, e.g. `['id', 'userId']`. */
export function dynamicSegments(pattern: string): string[] {
  return [...pattern.matchAll(/\[([^\]]+)]/g)].map((match) => match[1] as string);
}

/**
 * A plausible but attacker-chosen value for a path segment. Ids and `appId` get a random UUID (the
 * schemas accept UUIDs; authorization never relies on their unguessability, matrix §5), `code` and
 * `slug` get an opaque token. The point is that the value addresses a resource the caller has no
 * right to; the server must answer from the actor, not from the id.
 */
export function fabricatedSegment(name: string): string {
  if (name === 'code') {
    return 'zzzz'.repeat(8);
  }
  if (name === 'slug') {
    return 'no-such-venue';
  }
  return randomUUID();
}

/** Path params object for a route pattern, every dynamic segment filled with a fabricated value. */
export function fabricatedParams(pattern: string): Record<string, string> {
  return Object.fromEntries(dynamicSegments(pattern).map((name) => [name, fabricatedSegment(name)]));
}

/** The registered pattern with its dynamic segments substituted, usable as a request URL path. */
export function concretePath(pattern: string, params: Record<string, string>): string {
  const byName = new Map(Object.entries(params));
  return pattern.replace(/\[([^\]]+)]/g, (_match, name: string) => byName.get(name) ?? 'x');
}

/** Mobile client header with no credentials: an anonymous caller that the API must reject. */
export function anonMobile(extra: Record<string, string> = {}): Record<string, string> {
  return { ...MOBILE, ...extra };
}
