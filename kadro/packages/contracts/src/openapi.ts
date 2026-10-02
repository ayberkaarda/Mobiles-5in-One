import { z } from 'zod';

import {
  AUTH_CLIENT_HEADER,
  AUTH_CLIENTS,
  CSRF_HEADER,
  mobileAuthResponseSchema,
  tokenPairSchema,
  webAuthResponseSchema,
} from './auth.js';
import { acceptedResponseSchema } from './common.js';
import { geoPointSchema } from './districts.js';
import {
  ENDPOINT_LIST,
  type EndpointDefinition,
  endpointErrorCodes,
  type EndpointTag,
  type SchemaSpec,
  toOpenApiPath,
} from './endpoints.js';
import {
  lineupAssignmentSchema,
  matchDetailSchema,
  matchGuestParticipantSchema,
  matchGuestViewSchema,
  matchMemberViewSchema,
  matchMvpSchema,
  matchParticipantSchema,
  matchSummarySchema,
  matchVenueSchema,
  ownRsvpSchema,
  rsvpCountsSchema,
} from './matches.js';
import { applicationSchema, openCallPublicSchema, openCallSchema } from './open-calls.js';
import {
  ERROR_STATUS,
  type ErrorCode,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
} from './problem.js';
import { RATE_LIMIT_GROUPS } from './rate-limits.js';
import {
  invitePreviewSchema,
  teamDetailSchema,
  teamInviteSchema,
  teamMemberSchema,
  teamSummarySchema,
} from './teams.js';
import { uploadStatusResponseSchema } from './uploads.js';
import { meResponseSchema, userCardSchema, userPublicSchema } from './users.js';
import {
  venueDetailSchema,
  venueFeaturesSchema,
  venueRatingSchema,
  venueReviewSchema,
  venueSummarySchema,
} from './venues.js';

/**
 * OpenAPI 3.1 generation from the endpoint registry (product spec §5). Request schemas are
 * rendered in zod's input mode (what a client sends), response schemas in output mode (what the
 * server returns). `docs/api/openapi.json` is produced by `scripts/generate-openapi.ts` and a test
 * fails when the committed file is out of date.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export const OPENAPI_VERSION = '3.1.0';
export const API_DOCUMENT_VERSION = '1.0.0';
export const SESSION_COOKIE_NAME = '__Host-kadro_session';

const SCHEMA_REF = '#/components/schemas/';
const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Tag descriptions, in the order of `ENDPOINT_TAGS`. */
const TAG_DESCRIPTIONS = {
  health: 'Uptime probe',
  auth: 'Registration, sign-in, token rotation and password reset',
  me: 'The signed-in user: profile, push tokens, account deletion',
  teams: 'Teams, roster roles and invites',
  matches: 'Matches, RSVP, lineup, payment marking and MVP votes',
  'open-calls': 'Eksik Var: open calls and applications',
  venues: 'Saha Rehberi: venue directory and reviews',
  uploads: 'Presigned avatar and badge uploads',
} as const satisfies Record<EndpointTag, string>;

/** Shared response components, registered under fixed names so every operation reuses them. */
const SHARED_RESPONSE_SCHEMAS: readonly (readonly [string, z.ZodType])[] = [
  ['Problem', problemDetailsSchema],
  ['Accepted', acceptedResponseSchema],
  ['UserPublic', userPublicSchema],
  ['UserCard', userCardSchema],
  ['Me', meResponseSchema],
  ['TokenPair', tokenPairSchema],
  ['MobileAuthResponse', mobileAuthResponseSchema],
  ['WebAuthResponse', webAuthResponseSchema],
  ['GeoPoint', geoPointSchema],
  ['TeamSummary', teamSummarySchema],
  ['TeamMember', teamMemberSchema],
  ['TeamDetail', teamDetailSchema],
  ['TeamInvite', teamInviteSchema],
  ['InvitePreview', invitePreviewSchema],
  ['MatchVenue', matchVenueSchema],
  ['RsvpCounts', rsvpCountsSchema],
  ['MatchSummary', matchSummarySchema],
  ['MatchParticipant', matchParticipantSchema],
  ['MatchGuestParticipant', matchGuestParticipantSchema],
  ['OwnRsvp', ownRsvpSchema],
  ['MatchMvp', matchMvpSchema],
  ['LineupAssignment', lineupAssignmentSchema],
  ['MatchMemberView', matchMemberViewSchema],
  ['MatchGuestView', matchGuestViewSchema],
  ['MatchDetail', matchDetailSchema],
  ['OpenCall', openCallSchema],
  ['OpenCallPublic', openCallPublicSchema],
  ['Application', applicationSchema],
  ['VenueFeatures', venueFeaturesSchema],
  ['VenueRating', venueRatingSchema],
  ['VenueSummary', venueSummarySchema],
  ['VenueReview', venueReviewSchema],
  ['VenueDetail', venueDetailSchema],
  ['UploadStatus', uploadStatusResponseSchema],
];

type Registry = z.core.$ZodRegistry<{ id: string }>;

function pascal(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Registers `schema` under `id` unless it already has a name; returns the name in use. */
function named(registry: Registry, schema: z.ZodType, id: string): string {
  const existing = registry.get(schema);
  if (existing !== undefined) {
    return existing.id;
  }
  registry.add(schema, { id });
  return id;
}

function ref(id: string): JsonObject {
  return { $ref: `${SCHEMA_REF}${id}` };
}

function schemaRef(registry: Registry, spec: SchemaSpec, baseId: string): JsonObject {
  if ('byClient' in spec) {
    return {
      oneOf: AUTH_CLIENTS.map((client) =>
        ref(
          named(
            registry,
            client === 'mobile' ? spec.byClient.mobile : spec.byClient.web,
            `${baseId}${pascal(client)}`,
          ),
        ),
      ),
      description: `Selected by the \`${AUTH_CLIENT_HEADER}\` header (${AUTH_CLIENTS.join(' / ')}).`,
    };
  }
  return ref(named(registry, spec, baseId));
}

/** Removes the per-document keys zod adds to every top-level JSON Schema. */
function clean(schema: unknown): JsonObject {
  if (!isJsonObject(schema)) {
    throw new TypeError('JSON Schema conversion returned a non-object');
  }
  const { $schema: _schema, $id: _id, ...rest } = schema;
  return rest;
}

/**
 * `format: date-time` already states the RFC 3339 shape; zod's equivalent regular expression is
 * dropped to keep the document readable.
 */
function dropDateTimePattern(ctx: { jsonSchema: Record<string, unknown> }): void {
  if (ctx.jsonSchema.format === 'date-time') {
    delete ctx.jsonSchema.pattern;
  }
}

function convertRegistry(registry: Registry, io: 'input' | 'output'): JsonObject {
  const result = z.toJSONSchema(registry, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'throw',
    override: dropDateTimePattern,
    uri: (id) => `${SCHEMA_REF}${id}`,
  });
  return Object.fromEntries(
    Object.entries(result.schemas).map(([id, schema]) => [id, clean(schema)]),
  );
}

function acceptsUndefined(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success;
}

function parameters(endpoint: EndpointDefinition): JsonObject[] {
  const list: JsonObject[] = [];
  if (endpoint.client === 'required') {
    list.push({ $ref: '#/components/parameters/KadroClient' });
  }
  for (const [location, object] of [
    ['path', endpoint.params],
    ['query', endpoint.query],
  ] as const) {
    for (const [name, property] of Object.entries(object.shape as Record<string, z.ZodType>)) {
      list.push({
        name,
        in: location,
        required: location === 'path' || !acceptsUndefined(property),
        schema: clean(
          z.toJSONSchema(property, {
            target: 'draft-2020-12',
            io: 'input',
            unrepresentable: 'throw',
            override: dropDateTimePattern,
          }),
        ),
      });
    }
  }
  return list;
}

function problemResponses(endpoint: EndpointDefinition): JsonObject {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of endpointErrorCodes(endpoint)) {
    // eslint-disable-next-line security/detect-object-injection -- code is a typed ErrorCode key
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  const responses: JsonObject = {};
  for (const status of [...byStatus.keys()].sort((a, b) => a - b)) {
    const codes = byStatus.get(status) ?? [];
    const headers: JsonObject = { 'x-request-id': { $ref: '#/components/headers/RequestId' } };
    if (status === 429 || status === 503) {
      headers['Retry-After'] = { $ref: '#/components/headers/RetryAfter' };
    }
    responses[String(status)] = {
      description: `Problem details; \`code\` is one of: ${codes.join(', ')}`,
      headers,
      content: {
        [PROBLEM_CONTENT_TYPE]: {
          schema: {
            allOf: [
              ref('Problem'),
              {
                type: 'object',
                properties: { status: { const: status }, code: { enum: codes } },
              },
            ],
          },
        },
      },
    };
  }
  return responses;
}

function security(endpoint: EndpointDefinition): JsonValue[] {
  if (endpoint.auth === 'none') {
    return [];
  }
  const web: JsonObject =
    endpoint.method === 'GET' ? { sessionCookie: [] } : { sessionCookie: [], csrfToken: [] };
  const schemes: JsonValue[] = [{ bearerAuth: [] }, web];
  if (endpoint.auth === 'optional') {
    schemes.push({});
  }
  return schemes;
}

function policyExtension(endpoint: EndpointDefinition): JsonValue {
  const { policy } = endpoint;
  if ('selectBy' in policy) {
    return { selectBy: policy.selectBy, actions: { ...policy.actions } };
  }
  return policy.action;
}

function operation(
  endpoint: EndpointDefinition,
  requests: Registry,
  responses: Registry,
): JsonObject {
  const base = pascal(endpoint.id);
  const success: JsonObject = {
    description: endpoint.response.description,
    headers: { 'x-request-id': { $ref: '#/components/headers/RequestId' } },
  };
  if (endpoint.response.schema !== null) {
    success.content = {
      'application/json': {
        schema: schemaRef(responses, endpoint.response.schema, `${base}Response`),
      },
    };
  }
  const result: JsonObject = {
    operationId: endpoint.id,
    summary: endpoint.summary,
    tags: [endpoint.tag],
  };
  if (endpoint.description !== undefined) {
    result.description = endpoint.description;
  }
  const params = parameters(endpoint);
  if (params.length > 0) {
    result.parameters = params;
  }
  if (endpoint.body !== null) {
    result.requestBody = {
      required: true,
      content: {
        'application/json': { schema: schemaRef(requests, endpoint.body, `${base}Request`) },
      },
    };
  }
  result.responses = { [String(endpoint.response.status)]: success, ...problemResponses(endpoint) };
  result.security = security(endpoint);
  result['x-kadro-auth'] = endpoint.auth;
  result['x-kadro-client'] = endpoint.client;
  result['x-kadro-policy-action'] = policyExtension(endpoint);
  result['x-kadro-email-verified'] = endpoint.emailVerified;
  result['x-kadro-rate-limit'] =
    endpoint.rateLimit === null
      ? null
      : { group: endpoint.rateLimit, ...RATE_LIMIT_GROUPS[endpoint.rateLimit] };
  result['x-kadro-phase'] = endpoint.phase;
  return result;
}

function sortedObject(object: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** Builds the complete OpenAPI 3.1 document for every endpoint of the registry. */
export function buildOpenApiDocument(
  endpoints: readonly EndpointDefinition[] = ENDPOINT_LIST,
): JsonObject {
  const requests: Registry = z.registry<{ id: string }>();
  const responses: Registry = z.registry<{ id: string }>();
  for (const [id, schema] of SHARED_RESPONSE_SCHEMAS) {
    responses.add(schema, { id });
  }

  const pathItems = new Map<string, Map<string, JsonObject>>();
  for (const endpoint of endpoints) {
    const path = toOpenApiPath(endpoint.path);
    const pathItem = pathItems.get(path) ?? new Map<string, JsonObject>();
    pathItem.set(endpoint.method.toLowerCase(), operation(endpoint, requests, responses));
    pathItems.set(path, pathItem);
  }
  const paths: JsonObject = Object.fromEntries(
    [...pathItems].map(([path, item]) => [path, Object.fromEntries(item)]),
  );

  const requestSchemas = convertRegistry(requests, 'input');
  const responseSchemas = convertRegistry(responses, 'output');
  for (const id of Object.keys(requestSchemas)) {
    if (Object.hasOwn(responseSchemas, id)) {
      throw new Error(`schema name ${id} is used for both a request and a response`);
    }
  }

  return {
    openapi: OPENAPI_VERSION,
    jsonSchemaDialect: JSON_SCHEMA_DIALECT,
    info: {
      title: 'Kadro API',
      version: API_DOCUMENT_VERSION,
      description: [
        'REST API of Kadro, consumed by the mobile app and the web app.',
        '',
        `Every request except \`GET /api/v1/health\` carries the \`${AUTH_CLIENT_HEADER}\` header ` +
          '(`mobile` or `web`); a missing or unknown value, or `mobile` together with an `Origin` ' +
          'header, is rejected with 400. Mobile clients authenticate with an ES256 access JWT ' +
          `(bearer); web clients with the \`${SESSION_COOKIE_NAME}\` cookie and, on every ` +
          `mutation, the \`${CSRF_HEADER}\` header (double submit). A credential is accepted only ` +
          'on its own client type.',
        '',
        'Errors are RFC 9457 problem details (`application/problem+json`) with a stable `code`, ' +
          'never stack traces, SQL or input values. A resource the caller has no read relationship ' +
          'to answers 404, a readable resource without the permission answers 403, and a state ' +
          'conflict answers 409. Lists use cursor pagination: pass `nextCursor` back as `cursor`.',
        '',
        'Extensions: `x-kadro-policy-action` (authorization matrix action), `x-kadro-rate-limit` ' +
          '(matrix §8 group), `x-kadro-email-verified`, `x-kadro-auth`, `x-kadro-client`, ' +
          '`x-kadro-phase`.',
      ].join('\n'),
    },
    servers: [{ url: 'https://kadro.app', description: 'Production' }],
    tags: Object.entries(TAG_DESCRIPTIONS).map(([name, description]) => ({ name, description })),
    paths,
    components: {
      schemas: sortedObject({ ...requestSchemas, ...responseSchemas }),
      parameters: {
        KadroClient: {
          name: AUTH_CLIENT_HEADER,
          in: 'header',
          required: true,
          description:
            'Client type (ADR-0014). Selects the credential transport and, for refresh and ' +
            'logout, the body schema.',
          schema: { type: 'string', enum: [...AUTH_CLIENTS] },
        },
      },
      headers: {
        RequestId: {
          description: 'Request id, also present in every server log line of the request.',
          schema: { type: 'string' },
        },
        RetryAfter: {
          description: 'Seconds to wait before retrying.',
          schema: { type: 'integer', minimum: 0 },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: `Access JWT (ES256, 15 minutes); \`${AUTH_CLIENT_HEADER}: mobile\` only.`,
        },
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: SESSION_COOKIE_NAME,
          description: `HttpOnly session cookie; \`${AUTH_CLIENT_HEADER}: web\` only.`,
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: CSRF_HEADER,
          description: 'CSRF token (double submit), required on every web mutation.',
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Serialization in the layout Prettier gives JSON files (print width 100)
// ---------------------------------------------------------------------------

const PRINT_WIDTH = 100;
const INDENT = '  ';

function isPrimitive(value: JsonValue): value is null | boolean | number | string {
  return value === null || typeof value !== 'object';
}

function serializeValue(
  value: JsonValue,
  indent: string,
  prefixLength: number,
  suffixLength: number,
): string {
  if (isPrimitive(value)) {
    return JSON.stringify(value);
  }
  const inner = indent + INDENT;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    if (value.every(isPrimitive)) {
      const flat = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (prefixLength + flat.length + suffixLength <= PRINT_WIDTH) {
        return flat;
      }
    }
    const items = value.map(
      (item, index) =>
        inner + serializeValue(item, inner, inner.length, index < value.length - 1 ? 1 : 0),
    );
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return '{}';
  }
  const lines = entries.map(([key, item], index) => {
    const head = `${inner}${JSON.stringify(key)}: `;
    return head + serializeValue(item, inner, head.length, index < entries.length - 1 ? 1 : 0);
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/** Pretty JSON with a trailing newline, byte-identical to Prettier's output for the document. */
export function serializeOpenApiDocument(document: JsonObject): string {
  return `${serializeValue(document, '', 0, 0)}\n`;
}
