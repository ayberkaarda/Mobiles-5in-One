import { type ResourceContext } from '@kadro/auth';
import {
  type Action,
  AUTH_CLIENT_HEADER,
  type AuthClient,
  authClientSchema,
  type RateLimitGroup,
} from '@kadro/contracts';
import { type z } from 'zod';

import {
  type Allowed,
  authenticate,
  AuthorizationGate,
  hasCredentials,
  type Principal,
} from './authorize';
import { rateLimitSubject } from './client-ip';
import { allowsAnonymous, enforceEndpointGroup, isEndpointLimitGroup } from './group-limits';
import { API_RESPONSE_HEADERS, ApiError, problemResponse, toApiError } from './errors';
import { fallbackLogger, type Logger } from './logging';
import { type AuthAttemptSubject } from './ratelimit';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-context';
import { serverRuntime, type ServerRuntime } from './runtime';
import {
  assertNoBody,
  isStrictObjectSchema,
  paramsToObject,
  parseInput,
  queryToObject,
  readJsonBody,
  validationError,
} from './validate';

/**
 * Route wrapper for every `/api/v1` Route Handler. It implements steps 1–3 of the handler
 * template in authorization matrix §2 and the cross-cutting controls of security checklist
 * items 4, 5, 6, 8, 13 and 14:
 *
 * 1. `x-kadro-client` (missing / unknown, or `mobile` together with `Origin` → 400), then
 *    authentication over that client's transport (`auth: 'required' | 'optional'`);
 * 2. `.strict()` validation of params, query and JSON body (1 MiB limit);
 * 3. the group A rate limit for auth endpoints (`rateLimit: 'auth'`), including the
 *    progressive delay;
 * then the handler, which must call `ctx.authorize()` on authenticated routes. Every outcome is
 * logged once without bodies; failures become RFC 9457 problem responses; every response carries
 * `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `x-request-id`.
 *
 * `route()` attaches its spec to the returned function; `tests/route-coverage.test.ts` uses it to
 * prove that every exported handler under `app/api/v1` went through this wrapper.
 */

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
const METHODS_WITH_BODY: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH']);

/**
 * `required`: every request carries a valid `x-kadro-client` header (ADR-0014).
 * `exempt`: endpoints without a user principal (`webhooks/revenuecat`, `health`); a header that
 * is present is still validated.
 */
export type ClientRequirement = 'required' | 'exempt';

/**
 * `required`: 401 without valid credentials; the handler must call `ctx.authorize()`.
 * `optional`: credentials are verified when present (public reads with creator visibility).
 * `none`: credentials are not read (auth entry points, health, webhook).
 */
export type AuthRequirement = 'required' | 'optional' | 'none';

/** Body schema, either fixed or selected by client type (refresh / logout, ADR-0014). */
export type BodySpec = z.ZodType | { readonly byClient: Readonly<Record<AuthClient, z.ZodType>> };

type BodyOutput<TBody extends BodySpec | null> = TBody extends z.ZodType
  ? z.output<TBody>
  : TBody extends { readonly byClient: Readonly<Record<AuthClient, infer S>> }
    ? S extends z.ZodType
      ? z.output<S>
      : never
    : undefined;

export interface AuthRateLimitSpec<TBody> {
  readonly group: 'auth';
  /** Normalized email of the validated body; omitted for endpoints without one. */
  readonly email?: (body: TBody) => string | null | undefined;
}

export interface RequestContext {
  readonly requestId: string;
  /** Validated `x-kadro-client`; `null` only on exempt routes called without the header. */
  readonly client: AuthClient | null;
  /** Rate-limit subject derived from the trusted client address (`unknown` when absent). */
  readonly ipSubject: string;
  /** Normalized client address from the trusted proxy header, or `null`. */
  readonly ip: string | null;
  readonly principal: Principal | null;
  readonly logger: Logger;
  /** Policy check; see `AuthorizationGate.authorize`. */
  authorize(action: Action, resource?: ResourceContext): Promise<Allowed>;
  /** Group A helpers bound to this request's IP and email (auth endpoints only). */
  readonly authAttempts: {
    recordFailure(): Promise<void>;
    recordSuccess(): Promise<void>;
  } | null;
}

export interface HandlerInput<TParams, TQuery, TBody> {
  readonly request: Request;
  readonly params: TParams;
  readonly query: TQuery;
  readonly body: TBody;
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

export interface RouteSpec<
  TParams extends z.ZodType,
  TQuery extends z.ZodType,
  TBody extends BodySpec | null,
> {
  /** Route pattern as in the file tree, e.g. `/api/v1/teams/[id]`; used for logs, never the URL. */
  readonly path: `/api/v1/${string}`;
  readonly method: HttpMethod;
  readonly client?: ClientRequirement;
  readonly auth: AuthRequirement;
  readonly params: TParams;
  readonly query: TQuery;
  /** Required for POST / PUT / PATCH, `null` for GET; DELETE may have either. */
  readonly body: TBody;
  readonly rateLimit?: AuthRateLimitSpec<BodyOutput<TBody>>;
  /**
   * Endpoint group of authorization matrix §8, normally `ENDPOINTS.<id>.rateLimit` of the
   * registry: charged after validation (step 3). `null` or absent means no group limit; groups A
   * and R are not accepted here (group A uses `rateLimit`, R is the refresh endpoint's own).
   */
  readonly limitGroup?: RateLimitGroup | null;
  readonly handler: (
    input: HandlerInput<z.output<TParams>, z.output<TQuery>, BodyOutput<TBody>>,
  ) => Promise<Response> | Response;
}

/** What `route()` records on the handler for the coverage test. */
export interface RegisteredRoute {
  readonly path: string;
  readonly method: HttpMethod;
  readonly client: ClientRequirement;
  readonly auth: AuthRequirement;
  readonly params: z.ZodType;
  readonly query: z.ZodType;
  readonly bodies: readonly z.ZodType[];
  /** Endpoint group charged by the wrapper (`limitGroup`), `null` when none. */
  readonly limitGroup: RateLimitGroup | null;
}

/** Specs of every handler built by `route()`, keyed by the handler function. */
const REGISTRY = new WeakMap<object, RegisteredRoute>();

export interface NextRouteContext {
  readonly params: Promise<unknown>;
}

export type RouteHandler = (request: Request, context: NextRouteContext) => Promise<Response>;

/** The spec recorded by `route()` for a handler, or `undefined` if it was not built by `route()`. */
export function registeredRoute(value: unknown): RegisteredRoute | undefined {
  return typeof value === 'function' ? REGISTRY.get(value) : undefined;
}

/** Thrown when an authenticated handler returned without consulting the policy gate. */
export class AuthorizationNotCheckedError extends Error {
  constructor(path: string, method: string) {
    super(`${method} ${path} returned without calling ctx.authorize()`);
    this.name = 'AuthorizationNotCheckedError';
  }
}

function bodySchemas(body: BodySpec | null): z.ZodType[] {
  if (body === null) {
    return [];
  }
  return 'byClient' in body ? Object.values(body.byClient) : [body];
}

function selectBodySchema(body: BodySpec, client: AuthClient | null): z.ZodType | undefined {
  if (!('byClient' in body)) {
    return body;
  }
  switch (client) {
    case null:
      return undefined;
    case 'mobile':
      return body.byClient.mobile;
    case 'web':
      return body.byClient.web;
  }
}

function assertSpec(spec: RouteSpec<z.ZodType, z.ZodType, BodySpec | null>): void {
  const where = `${spec.method} ${spec.path}`;
  const schemas = [spec.params, spec.query, ...bodySchemas(spec.body)];
  if (!schemas.every(isStrictObjectSchema)) {
    throw new TypeError(`${where}: params, query and body schemas must be strict objects`);
  }
  if (METHODS_WITH_BODY.has(spec.method) && spec.body === null) {
    throw new TypeError(`${where}: a ${spec.method} handler requires a body schema`);
  }
  if (spec.method === 'GET' && spec.body !== null) {
    throw new TypeError(`${where}: a GET handler cannot declare a body`);
  }
  if (spec.rateLimit !== undefined && spec.auth === 'required') {
    throw new TypeError(`${where}: the auth rate-limit group applies to unauthenticated endpoints`);
  }
  const group = spec.limitGroup ?? null;
  if (group !== null) {
    if (!isEndpointLimitGroup(group)) {
      throw new TypeError(`${where}: rate-limit group ${group} is enforced by the auth endpoints`);
    }
    if (spec.rateLimit !== undefined) {
      throw new TypeError(`${where}: declare either the auth group or an endpoint group`);
    }
    if (spec.auth !== 'required' && !allowsAnonymous(group)) {
      throw new TypeError(`${where}: group ${group} is keyed by user and needs auth 'required'`);
    }
  }
}

function readClient(request: Request, requirement: ClientRequirement): AuthClient | null {
  const raw = request.headers.get(AUTH_CLIENT_HEADER);
  if (raw === null && requirement === 'exempt') {
    return null;
  }
  const parsed = authClientSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationError('headers', 'invalid_value', AUTH_CLIENT_HEADER);
  }
  if (parsed.data === 'mobile' && request.headers.has('origin')) {
    throw validationError('headers', 'unexpected_origin', 'origin');
  }
  return parsed.data;
}

function finalize(
  response: Response,
  requestId: string,
  extraCookies: readonly string[],
): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(API_RESPONSE_HEADERS)) {
    headers.set(name, value);
  }
  headers.set(REQUEST_ID_HEADER, requestId);
  for (const cookie of extraCookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function route<
  TParams extends z.ZodType,
  TQuery extends z.ZodType,
  TBody extends BodySpec | null,
>(spec: RouteSpec<TParams, TQuery, TBody>): RouteHandler {
  assertSpec(spec as unknown as RouteSpec<z.ZodType, z.ZodType, BodySpec | null>);
  const clientRequirement = spec.client ?? 'required';
  const registered: RegisteredRoute = Object.freeze({
    path: spec.path,
    method: spec.method,
    client: clientRequirement,
    auth: spec.auth,
    params: spec.params,
    query: spec.query,
    bodies: Object.freeze(bodySchemas(spec.body)),
    limitGroup: spec.limitGroup ?? null,
  });

  const handler = async (request: Request, context: NextRouteContext): Promise<Response> => {
    const startedAt = performance.now();
    const requestId = resolveRequestId(request.headers);
    let logger = fallbackLogger().child({ requestId });
    let client: AuthClient | null = null;
    let renewedCookies: readonly string[] = [];
    let response: Response;
    let failure: unknown;
    let problemCode: string | undefined;

    try {
      const runtime = await serverRuntime();
      logger = runtime.logger.child({ requestId });

      // Step 1: client type and authentication.
      client = readClient(request, clientRequirement);
      let principal: Principal | null = null;
      if (spec.auth !== 'none' && client !== null) {
        if (spec.auth === 'required' || hasCredentials(runtime, request, client)) {
          principal = await authenticate(runtime, request, client);
          renewedCookies = principal.renewedCookies;
        }
      } else if (spec.auth === 'required') {
        throw new ApiError('unauthenticated');
      }

      // Step 2: params, query and body.
      const params = parseInput('params', spec.params, paramsToObject(await context.params));
      const query = parseInput(
        'query',
        spec.query,
        queryToObject(new URL(request.url).searchParams),
      );
      let body: unknown = undefined;
      const bodySpec: BodySpec | null = spec.body;
      if (bodySpec === null) {
        await assertNoBody(request);
      } else {
        const schema = selectBodySchema(bodySpec, client);
        if (schema === undefined) {
          throw validationError('headers', 'invalid_value', AUTH_CLIENT_HEADER);
        }
        body = parseInput('body', schema, await readJsonBody(request));
      }
      const typedBody = body as BodyOutput<TBody>;

      // Step 3: rate limits (group A for auth entry points, endpoint groups of matrix §8).
      const ip = runtime.clientIp.resolve(request.headers);
      const ipSubject = rateLimitSubject(ip);
      if (ip === null && clientRequirement === 'required') {
        // ADR-0022: the trusted proxy header is missing or malformed, so this client shares the
        // `unknown` bucket. Only the route and request id are logged, never header values.
        // Exempt routes (health, webhook) are reached without the edge proxy and use no IP.
        runtime.metrics.increment('client_ip_missing');
        logger.warn({ metric: 'client_ip_missing', route: spec.path }, 'client ip missing');
      }
      let authAttempts: RequestContext['authAttempts'] = null;
      if (spec.rateLimit !== undefined) {
        const subject: AuthAttemptSubject = {
          ip: ipSubject,
          email: spec.rateLimit.email?.(typedBody) ?? null,
        };
        const { delayMs } = await runtime.authRateLimiter.consume(subject);
        if (delayMs > 0) {
          await runtime.sleep(delayMs);
        }
        authAttempts = {
          recordFailure: () => runtime.authRateLimiter.recordFailure(subject),
          recordSuccess: () => runtime.authRateLimiter.recordSuccess(subject),
        };
      }
      const limitGroup = spec.limitGroup ?? null;
      if (limitGroup !== null && isEndpointLimitGroup(limitGroup)) {
        await enforceEndpointGroup(runtime, limitGroup, {
          userId: principal?.userId ?? null,
          ipSubject,
        });
      }

      const gate = new AuthorizationGate(runtime, principal);
      const ctx: RequestContext = {
        requestId,
        client,
        ip,
        ipSubject,
        principal,
        logger,
        authorize: (action, resource) => gate.authorize(action, resource),
        authAttempts,
      };
      response = await spec.handler({
        request,
        params: params as z.output<TParams>,
        query: query as z.output<TQuery>,
        body: typedBody,
        ctx,
        runtime,
      });
      if (spec.auth === 'required' && !gate.wasConsulted) {
        throw new AuthorizationNotCheckedError(spec.path, spec.method);
      }
    } catch (error) {
      const apiError = toApiError(error);
      failure = apiError.status >= 500 ? error : undefined;
      problemCode = apiError.code;
      response = problemResponse(apiError, requestId);
    }

    const status = response.status;
    const entry = {
      route: spec.path,
      method: spec.method,
      status,
      client,
      problemCode,
      durationMs: Math.round(performance.now() - startedAt),
    };
    if (failure !== undefined) {
      // The `err` serializer (`serializeError`) strips SQL text, parameters and emails.
      logger.error({ ...entry, err: failure }, 'request failed');
    } else {
      logger.info(entry, 'request completed');
    }
    return finalize(response, requestId, status < 400 ? renewedCookies : []);
  };

  REGISTRY.set(handler, registered);
  return handler;
}

/** JSON success response; the wrapper adds the API security headers. */
export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(data), { ...init, headers });
}
