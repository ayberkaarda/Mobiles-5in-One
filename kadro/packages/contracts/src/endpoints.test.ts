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
  type EndpointId,
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

/** Matrix rows such as `GET admin/**` cover every registry path below their prefix. */
function rowMatches(row: MatrixRow, method: string, path: string): boolean {
  if (row.method !== method) {
    return false;
  }
  if (row.path.endsWith('/**')) {
    return path.startsWith(row.path.slice(0, -2));
  }
  return row.path === path;
}

/**
 * Phase 3–5 endpoints whose matrix rows are written by the docs work packages of those phases
 * (the matrix is not owned by the contracts package). Each id leaves this list when its row lands.
 */
const PENDING_MATRIX_ROWS: readonly EndpointId[] = [
  // Public reference data without a policy action: its matrix row is documented in prose
  // (`none`) and is not a parseable `action` row, so it stays out of the row mapping below.
  'listDistricts',
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

  it('covers the 67 endpoints of Phases 1 to 5', () => {
    expect(ENDPOINT_LIST).toHaveLength(67);
    const perPhase = (phase: number) =>
      ENDPOINT_LIST.filter((endpoint) => endpoint.phase === phase).length;
    expect([1, 2, 3, 4, 5].map(perPhase)).toEqual([12, 37, 2, 0, 16]);
  });

  it('puts every admin route under /api/v1/admin and every webhook under /api/v1/webhooks', () => {
    for (const endpoint of ENDPOINT_LIST) {
      expect(endpoint.path.startsWith('/api/v1/admin/'), endpoint.id).toBe(
        endpoint.tag === 'admin',
      );
      expect(endpoint.path.startsWith('/api/v1/webhooks/'), endpoint.id).toBe(
        endpoint.tag === 'webhooks',
      );
    }
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
  it('exempts only health and the webhook from x-kadro-client (ADR-0020)', () => {
    const exempt = ENDPOINT_LIST.filter((endpoint) => endpoint.client === 'exempt');
    expect(exempt.map((endpoint) => endpoint.path)).toEqual([
      '/api/v1/health',
      '/api/v1/webhooks/revenuecat',
    ]);
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
        '/api/v1/districts',
        '/api/v1/webhooks/revenuecat',
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

  it('names a matrix §8 group for every mutation but the webhook, none for reads but the invite preview', () => {
    for (const endpoint of ENDPOINT_LIST) {
      if (endpoint.id === 'previewInvite') {
        expect(endpoint.rateLimit).toBe('I');
      } else if (endpoint.id === 'receiveRevenueCatWebhook') {
        // Provider deliveries arrive in bursts and must not be dropped (ADR-0063).
        expect(endpoint.rateLimit).toBeNull();
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
    for (const id of ['adminStepUp', 'adminTotpEnroll', 'adminTotpConfirm'] as const) {
      expect(group(id)).toBe('T');
    }
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
    // Admin routes answer non-staff with 403 before any resource is loaded (matrix §3.8).
    for (const endpoint of ENDPOINT_LIST.filter((candidate) => candidate.tag !== 'admin')) {
      if (endpoint.errors.includes('forbidden')) {
        expect(endpoint.errors, endpoint.id).toContain('not_found');
      }
    }
    for (const code of ['entitlement_required', 'email_unverified'] as const) {
      expect(ERROR_STATUS[code]).toBe(403);
    }
  });
});

describe('admin step-up', () => {
  const admin = ENDPOINT_LIST.filter((endpoint) => endpoint.tag === 'admin');
  const establishing = ['adminStepUp', 'adminTotpEnroll', 'adminTotpConfirm'];

  it('requires step-up on every admin route except the ones that establish it', () => {
    expect(admin).toHaveLength(15);
    for (const endpoint of admin) {
      expect(endpoint.stepUp === true, endpoint.id).toBe(!establishing.includes(endpoint.id));
      expect(endpoint.auth, endpoint.id).toBe('required');
      expect(endpoint.errors, endpoint.id).toContain('forbidden');
    }
    for (const endpoint of ENDPOINT_LIST.filter((candidate) => candidate.tag !== 'admin')) {
      expect(endpoint.stepUp, endpoint.id).toBeUndefined();
    }
    expect(endpointErrorCodes(ENDPOINTS.listAuditLogs)).toContain('step_up_required');
    expect(endpointErrorCodes(ENDPOINTS.adminStepUp)).not.toContain('step_up_required');
    expect(ERROR_STATUS.step_up_required).toBe(401);
  });

  it('asks for a fresh TOTP code on role and deactivation changes', () => {
    for (const id of ['setUserRole', 'setUserDeactivated'] as const) {
      expect(Object.keys(ENDPOINTS[id].body.shape), id).toContain('totpCode');
      expect(ENDPOINTS[id].errors, id).toContain('totp_invalid');
      expect(ENDPOINTS[id].errors, id).toContain('last_admin');
    }
    expect(ERROR_STATUS.totp_invalid).toBe(401);
    expect(ERROR_STATUS.totp_already_enrolled).toBe(409);
  });
});

describe('authorization matrix', () => {
  const rows = matrixRows(matrixSource);
  const registered = ENDPOINT_LIST.filter(
    (endpoint) => !(PENDING_MATRIX_ROWS as readonly string[]).includes(endpoint.id),
  );

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
    for (const endpoint of registered) {
      const path = normalizePath(endpoint.path);
      const exact = rows.filter((row) => row.method === endpoint.method && row.path === path);
      const matching =
        exact.length > 0 ? exact : rows.filter((row) => rowMatches(row, endpoint.method, path));
      expect(matching.length, `${endpoint.method} ${endpoint.path}`).toBeGreaterThan(0);
      const actions = endpointActions(endpoint);
      if (actions.length === 0) {
        expect(matching.map((row) => row.action)).toEqual(['health.read']);
      } else {
        expect(matching.map((row) => row.action).sort(), endpoint.id).toEqual([...actions].sort());
      }
    }
  });

  it('has a registry endpoint for every matrix row', () => {
    for (const row of rows) {
      const endpoint = ENDPOINT_LIST.find((candidate) =>
        rowMatches(row, candidate.method, normalizePath(candidate.path)),
      );
      expect(endpoint, `${row.method} ${row.path}`).toBeDefined();
    }
  });

  it('keeps the pending matrix rows few and real', () => {
    for (const id of PENDING_MATRIX_ROWS) {
      const endpoint = ENDPOINTS[id];
      expect(endpoint.phase, id).toBeGreaterThanOrEqual(3);
      const path = normalizePath(endpoint.path);
      expect(
        rows.some((row) => row.method === endpoint.method && row.path === path),
        `${id} now has a matrix row: remove it from PENDING_MATRIX_ROWS`,
      ).toBe(false);
    }
  });

  it('uses every policy action', () => {
    const used = new Set(ENDPOINT_LIST.flatMap((endpoint) => endpointActions(endpoint)));
    for (const action of ACTIONS) {
      expect(used.has(action), action).toBe(true);
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
