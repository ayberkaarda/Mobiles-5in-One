/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import matrixSource from '../../../docs/security/authorization-matrix.md?raw';
import {
  ACTIONS,
  type Action,
  ENDPOINT_LIST,
  ENDPOINTS,
  type EndpointDefinition,
  endpointActions,
  endpointErrorCodes,
  ERROR_CODES,
  ERROR_STATUS,
  pathParamNames,
  RATE_LIMIT_GROUPS,
  type SchemaSpec,
  toOpenApiPath,
} from './index.js';

/**
 * Registry-side consistency checks. The registry is the source of truth for the web Route
 * Handlers and the OpenAPI document; these tests prove it agrees with the authorization matrix
 * and with the route files that already exist. They read other workspaces' files and never
 * change them.
 */

const routeSources = import.meta.glob<string>('../../../apps/web/app/api/v1/**/route.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function schemasOf(spec: SchemaSpec | null): z.ZodType[] {
  if (spec === null) {
    return [];
  }
  return 'byClient' in spec ? Object.values(spec.byClient) : [spec];
}

function isStrictObject(schema: z.ZodType): boolean {
  return schema instanceof z.ZodObject && schema.def.catchall instanceof z.ZodNever;
}

/** `/api/v1/teams/[id]` and `teams/:id?x=` → `teams/{}`, so both spellings compare equal. */
function normalizePath(path: string): string {
  return path
    .replace(/^\/api\/v1\//, '')
    .replace(/\?.*$/, '')
    .replace(/\[[A-Za-z0-9]+\]/g, '{}')
    .replace(/:[A-Za-z0-9]+/g, '{}');
}

interface MatrixRow {
  readonly method: string;
  readonly path: string;
  readonly action: string;
}

/** Endpoint rows of authorization matrix §3: first cell is `METHOD path`, second the action. */
function matrixRows(source: string): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = /^\|\s*`(GET|POST|PUT|PATCH|DELETE) ([^`]+)`[^|]*\|\s*`([A-Za-z.]+)`/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
      rows.push({ method: match[1], path: normalizePath(match[2]), action: match[3] });
    }
  }
  return rows;
}

/** Matrix areas that belong to Phase 5 (webhook, admin) and are not in the registry yet. */
function isLaterPhase(path: string): boolean {
  return path.startsWith('admin/') || path.startsWith('webhooks/');
}

const PHASE5_ACTIONS: readonly Action[] = [
  'webhook.revenuecat',
  'admin.stepUp',
  'admin.totpEnroll',
  'admin.read',
  'admin.role.manage',
  'admin.user.deactivate',
  'admin.audit.read',
  'venue.verify',
  'venue.import',
  'review.delete',
  'opencall.remove',
];

describe('registry structure', () => {
  it('has unique ids, unique method + path pairs and ids equal to their keys', () => {
    expect(new Set(ENDPOINT_LIST.map((endpoint) => endpoint.id)).size).toBe(ENDPOINT_LIST.length);
    const routes = ENDPOINT_LIST.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(new Set(routes).size).toBe(routes.length);
    for (const [key, endpoint] of Object.entries(ENDPOINTS)) {
      expect(endpoint.id).toBe(key);
      expect(endpoint.id).toMatch(/^[a-z][A-Za-z]+$/);
    }
  });

  it('covers the 49 endpoints of Phase 1 and Phase 2', () => {
    expect(ENDPOINT_LIST).toHaveLength(49);
    expect(ENDPOINT_LIST.filter((endpoint) => endpoint.phase === 1)).toHaveLength(12);
  });

  it('uses only strict object schemas for params, query and bodies', () => {
    for (const endpoint of ENDPOINT_LIST) {
      const schemas = [endpoint.params, endpoint.query, ...schemasOf(endpoint.body)];
      for (const schema of schemas) {
        expect(isStrictObject(schema), `${endpoint.id}`).toBe(true);
      }
    }
  });

  it('follows the body rules of the route wrapper', () => {
    for (const endpoint of ENDPOINT_LIST) {
      if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
        expect(endpoint.body, endpoint.id).not.toBeNull();
      }
      if (endpoint.method === 'GET') {
        expect(endpoint.body, endpoint.id).toBeNull();
      }
    }
  });

  it('declares exactly the path segments as params', () => {
    for (const endpoint of ENDPOINT_LIST) {
      expect(endpoint.path.startsWith('/api/v1/'), endpoint.id).toBe(true);
      expect(Object.keys(endpoint.params.shape).sort(), endpoint.id).toEqual(
        pathParamNames(endpoint.path).sort(),
      );
      expect(toOpenApiPath(endpoint.path)).not.toMatch(/[[\]]/);
    }
  });

  it('keeps one dynamic segment name per level, as Next.js requires', () => {
    const names = new Map<string, string>();
    for (const endpoint of ENDPOINT_LIST) {
      const segments = endpoint.path.split('/');
      segments.forEach((segment, index) => {
        if (!segment.startsWith('[')) {
          return;
        }
        const parent = segments.slice(0, index).join('/');
        const known = names.get(parent);
        expect(known === undefined || known === segment, `${endpoint.path}`).toBe(true);
        names.set(parent, segment);
      });
    }
  });

  it('has a success response with a body except for 204', () => {
    for (const endpoint of ENDPOINT_LIST) {
      expect(endpoint.response.schema === null, endpoint.id).toBe(endpoint.response.status === 204);
      for (const schema of schemasOf(endpoint.response.schema)) {
        const variants = schema instanceof z.ZodDiscriminatedUnion ? schema.options : [schema];
        for (const variant of variants) {
          expect(isStrictObject(variant as z.ZodType), endpoint.id).toBe(true);
        }
      }
    }
  });

  it('lists known error codes without duplicates', () => {
    for (const endpoint of ENDPOINT_LIST) {
      expect(new Set(endpoint.errors).size, endpoint.id).toBe(endpoint.errors.length);
      for (const code of endpointErrorCodes(endpoint)) {
        expect(ERROR_CODES).toContain(code);
      }
    }
  });
});

describe('authentication, client and rate-limit rules', () => {
  it('exempts only health from x-kadro-client', () => {
    const exempt = ENDPOINT_LIST.filter((endpoint) => endpoint.client === 'exempt');
    expect(exempt.map((endpoint) => endpoint.path)).toEqual(['/api/v1/health']);
  });

  it('keeps unauthenticated access to auth entry points, health and public reads', () => {
    const none = ENDPOINT_LIST.filter((endpoint) => endpoint.auth === 'none').map(
      (endpoint) => endpoint.path,
    );
    expect(none.sort()).toEqual(
      [
        '/api/v1/health',
        '/api/v1/auth/register',
        '/api/v1/auth/login',
        '/api/v1/auth/refresh',
        '/api/v1/auth/verify-email',
        '/api/v1/auth/forgot',
        '/api/v1/auth/reset',
        '/api/v1/auth/apple',
        '/api/v1/auth/google',
      ].sort(),
    );
    const optional = ENDPOINT_LIST.filter((endpoint) => endpoint.auth === 'optional');
    expect(optional.map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort()).toEqual([
      'GET /api/v1/invites/[code]',
      'GET /api/v1/open-calls',
      'GET /api/v1/venues',
      'GET /api/v1/venues/[slug]',
    ]);
  });

  it('names a matrix §8 group for every mutation and none for reads but the invite preview', () => {
    for (const endpoint of ENDPOINT_LIST) {
      if (endpoint.id === 'previewInvite') {
        expect(endpoint.rateLimit).toBe('I');
      } else if (endpoint.method === 'GET') {
        expect(endpoint.rateLimit, endpoint.id).toBeNull();
      } else {
        expect(endpoint.rateLimit, endpoint.id).not.toBeNull();
        expect(Object.keys(RATE_LIMIT_GROUPS)).toContain(endpoint.rateLimit);
      }
    }
  });

  it('applies the spec-fixed and proposed groups to their endpoints', () => {
    const group = (id: keyof typeof ENDPOINTS) => ENDPOINTS[id].rateLimit;
    for (const id of [
      'login',
      'register',
      'forgotPassword',
      'resetPassword',
      'verifyEmail',
      'signInWithApple',
      'signInWithGoogle',
    ] as const) {
      expect(group(id)).toBe('A');
    }
    expect(group('refresh')).toBe('R');
    expect(group('acceptInvite')).toBe('I');
    expect(group('previewInvite')).toBe('I');
    expect(group('publishOpenCall')).toBe('C');
    expect(group('deleteMe')).toBe('D');
    expect(group('createApplication')).toBe('O');
    expect(group('createVenue')).toBe('V');
    expect(group('createReview')).toBe('W');
    expect(group('presignUpload')).toBe('U');
    expect(group('registerPushToken')).toBe('P');
    expect(RATE_LIMIT_GROUPS.A).toMatchObject({ max: 5, windowSeconds: 900 });
    expect(RATE_LIMIT_GROUPS.U).toMatchObject({ max: 10, windowSeconds: 86_400 });
    expect(RATE_LIMIT_GROUPS.C).toMatchObject({ max: 10, windowSeconds: 86_400 });
    expect(RATE_LIMIT_GROUPS.D).toMatchObject({ max: 5, windowSeconds: 900 });
  });

  it('marks the V cells of the matrix as needing a verified email', () => {
    const verified = ENDPOINT_LIST.filter((endpoint) => endpoint.emailVerified).map(
      (endpoint) => endpoint.id,
    );
    expect(verified.sort()).toEqual(
      [
        'createTeam',
        'createInvite',
        'acceptInvite',
        'createApplication',
        'createVenue',
        'createReview',
      ].sort(),
    );
  });

  it('implies the authentication, CSRF and limit codes from the definition', () => {
    const codes = endpointErrorCodes(ENDPOINTS.markPayment);
    for (const code of [
      'validation_failed',
      'payload_too_large',
      'unsupported_media_type',
      'unauthenticated',
      'account_deactivated',
      'csrf_failed',
      'rate_limited',
      'not_found',
      'forbidden',
      'internal_error',
    ] as const) {
      expect(codes).toContain(code);
    }
    const health = endpointErrorCodes(ENDPOINTS.getHealth);
    expect(health).not.toContain('unauthenticated');
    expect(health).not.toContain('payload_too_large');
    expect(endpointErrorCodes(ENDPOINTS.getTeam)).not.toContain('csrf_failed');
  });

  it('documents the slot-reduction conflicts on match updates', () => {
    for (const code of ['slots_below_confirmed', 'slots_below_lineup'] as const) {
      expect(ENDPOINTS.updateMatch.errors).toContain(code);
      expect(ERROR_STATUS[code]).toBe(409);
    }
    expect(ENDPOINTS.voteMvp.errors).toContain('mvp_vote_closed');
  });

  it('answers unreadable team-scoped resources with 404 before 403', () => {
    for (const endpoint of ENDPOINT_LIST) {
      if (endpoint.errors.includes('forbidden')) {
        expect(endpoint.errors, endpoint.id).toContain('not_found');
      }
    }
    for (const code of ['entitlement_required', 'email_unverified'] as const) {
      expect(ERROR_STATUS[code]).toBe(403);
    }
  });
});

describe('authorization matrix', () => {
  const rows = matrixRows(matrixSource);
  const current = rows.filter((row) => !isLaterPhase(row.path));

  it('parses the endpoint tables of matrix §3', () => {
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) {
      expect(
        row.action === 'health.read' || (ACTIONS as readonly string[]).includes(row.action),
        row.action,
      ).toBe(true);
    }
  });

  it('maps every registry endpoint to its matrix row and action', () => {
    for (const endpoint of ENDPOINT_LIST) {
      const matching = current.filter(
        (row) => row.method === endpoint.method && row.path === normalizePath(endpoint.path),
      );
      expect(matching.length, `${endpoint.method} ${endpoint.path}`).toBeGreaterThan(0);
      const actions = endpointActions(endpoint);
      if (actions.length === 0) {
        expect(matching.map((row) => row.action)).toEqual(['health.read']);
      } else {
        expect(matching.map((row) => row.action).sort(), endpoint.id).toEqual([...actions].sort());
      }
    }
  });

  it('has a registry endpoint for every Phase 1 and Phase 2 matrix row', () => {
    for (const row of current) {
      const endpoint = ENDPOINT_LIST.find(
        (candidate) =>
          candidate.method === row.method && normalizePath(candidate.path) === row.path,
      );
      expect(endpoint, `${row.method} ${row.path}`).toBeDefined();
    }
  });

  it('uses every policy action except the Phase 5 admin and webhook ones', () => {
    const used = new Set(ENDPOINT_LIST.flatMap((endpoint) => endpointActions(endpoint)));
    for (const action of ACTIONS) {
      expect(used.has(action) || PHASE5_ACTIONS.includes(action), action).toBe(true);
      if (PHASE5_ACTIONS.includes(action)) {
        expect(used.has(action), action).toBe(false);
      }
    }
  });

  it('selects decide / withdraw and avatar / badge from the body', () => {
    expect(ENDPOINTS.decideApplication.policy).toEqual({
      selectBy: 'body.status',
      actions: {
        accepted: 'application.decide',
        rejected: 'application.decide',
        withdrawn: 'application.withdraw',
      },
    });
    const statuses = ENDPOINTS.decideApplication.body.shape.status.options;
    expect(Object.keys(ENDPOINTS.decideApplication.policy.actions).sort()).toEqual(
      [...statuses].sort(),
    );
    expect(Object.keys(ENDPOINTS.presignUpload.policy.actions).sort()).toEqual(['avatar', 'badge']);
  });
});

describe('existing web route files', () => {
  interface RouteSpecSource {
    readonly file: string;
    readonly exportName: string;
    readonly path: string | undefined;
    readonly method: string | undefined;
    readonly auth: string | undefined;
    readonly client: string;
    readonly authRateLimit: boolean;
    readonly actions: string[];
  }

  function field(block: string, name: string): string | undefined {
    // eslint-disable-next-line security/detect-non-literal-regexp -- name is a fixed spec key
    return new RegExp(`\\b${name}: '([^']+)'`).exec(block)?.[1];
  }

  function specs(): RouteSpecSource[] {
    return Object.entries(routeSources).flatMap(([file, source]) =>
      source
        .split(/^export const /m)
        .slice(1)
        .flatMap((block) => {
          const exportName = /^([A-Z]+) = route\(/.exec(block)?.[1];
          if (exportName === undefined) {
            return [];
          }
          return [
            {
              file,
              exportName,
              path: field(block, 'path'),
              method: field(block, 'method'),
              auth: field(block, 'auth'),
              client: field(block, 'client') ?? 'required',
              authRateLimit: /rateLimit: \{ group: 'auth'/.test(block),
              actions: [...block.matchAll(/ctx\.authorize\('([A-Za-z.]+)'/g)].map(
                (match) => match[1] ?? '',
              ),
            },
          ];
        }),
    );
  }

  function patternOf(file: string): string {
    const relative = file.replace(/^.*\/app\/api\/v1\//, '').replace(/\/?route\.ts$/, '');
    const segments = relative.split('/').filter((segment) => !/^\(.+\)$/.test(segment));
    return ['/api/v1', ...segments].filter((segment) => segment !== '').join('/');
  }

  const found = specs();

  it('finds the Phase 1 route files', () => {
    expect(Object.keys(routeSources).length).toBeGreaterThanOrEqual(11);
    expect(found.length).toBeGreaterThanOrEqual(12);
  });

  it('every route handler has a registry entry with the same method, path, auth and client', () => {
    for (const spec of found) {
      const where = `${spec.exportName} ${spec.file}`;
      expect(spec.path, where).toBe(patternOf(spec.file));
      expect(spec.method, where).toBe(spec.exportName);
      const endpoint: EndpointDefinition | undefined = ENDPOINT_LIST.find(
        (candidate) => candidate.method === spec.method && candidate.path === spec.path,
      );
      expect(endpoint, where).toBeDefined();
      if (endpoint === undefined) {
        continue;
      }
      expect(spec.auth, where).toBe(endpoint.auth);
      expect(spec.client, where).toBe(endpoint.client);
      if (spec.authRateLimit) {
        expect(endpoint.rateLimit, where).toBe('A');
      }
      expect(
        spec.actions.every((action) => endpointActions(endpoint).includes(action as Action)),
        where,
      ).toBe(true);
    }
  });

  it('every Phase 1 registry endpoint already has its route handler', () => {
    for (const endpoint of ENDPOINT_LIST.filter((candidate) => candidate.phase === 1)) {
      const spec = found.find(
        (candidate) => candidate.method === endpoint.method && candidate.path === endpoint.path,
      );
      expect(spec, `${endpoint.method} ${endpoint.path}`).toBeDefined();
    }
  });
});
