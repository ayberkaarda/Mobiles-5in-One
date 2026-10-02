import {
  type ActorContext,
  can,
  type Decision,
  hashToken,
  type ResourceContext,
  sessionExtension,
} from '@kadro/auth';
import {
  type Action,
  type AuthClient,
  CSRF_HEADER,
  ERROR_STATUS,
  opaqueTokenSchema,
  type PlatformRole,
} from '@kadro/contracts';
import { refreshTokens, users } from '@kadro/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { proSubscriptionExists } from './billing/entitlements';
import { csrfCookie, readCookie, sessionCookie } from './cookies';
import { ApiError } from './errors';
import { type ServerRuntime } from './runtime';

/**
 * Server-side enforcement (security checklist items 3, 4 and 12; ADR-0012, ADR-0013, ADR-0014).
 *
 * Step 1 of the handler template (authorization matrix §2) is {@link authenticate}: the
 * credential is accepted only over the transport of the declared client type (bearer JWT for
 * `mobile`, session cookie for `web`, CSRF header on every web mutation), and the user row is
 * then loaded by primary key on every request, so `role`, email verification and
 * `deactivated_at` never come from token claims. Steps 4–6 call {@link AuthorizationGate.authorize}
 * with the facts of the resource loaded through its read-scoped query; the gate maps the policy
 * decision to 401 / 403 / 404 / 409 exactly as `can()` returns it.
 */

export interface Principal {
  readonly userId: string;
  /** `sid`: refresh-token family of the mobile login or of the web session. */
  readonly sessionId: string;
  readonly client: AuthClient;
  readonly platformRole: PlatformRole;
  readonly emailVerified: boolean;
  /** Web only: the `refresh_tokens` row behind the session cookie. */
  readonly sessionRowId: string | null;
  /** `step_up_until` of the live session row (web) or refresh family (mobile). */
  readonly stepUpUntil: Date | null;
  /**
   * Kadro Pro at authentication time: a `subscriptions` row of the user grants it at the request's
   * clock (ADR-0065). Loaded in the same query as the user row; never taken from a client claim.
   */
  readonly isPro: boolean;
  /** `Set-Cookie` values renewing the rolling web session, if it was extended. */
  readonly renewedCookies: readonly string[];
}

export const GUEST_ACTOR: ActorContext = Object.freeze({
  userId: null,
  platformRole: null,
  emailVerified: false,
  deactivated: false,
  stepUpUntil: null,
  isPro: false,
});

const BEARER = /^Bearer[ ]+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const MAX_AUTHORIZATION_LENGTH = 4_096;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function unauthenticated(): ApiError {
  return new ApiError('unauthenticated', {
    headers: { 'WWW-Authenticate': 'Bearer realm="kadro-api"' },
  });
}

/** True when the request carries a credential for its client's transport. */
export function hasCredentials(
  runtime: ServerRuntime,
  request: Request,
  client: AuthClient,
): boolean {
  if (client === 'mobile') {
    return request.headers.has('authorization');
  }
  return (
    readCookie(request.headers.get('cookie'), runtime.env.SESSION_COOKIE_NAME).kind !== 'absent'
  );
}

interface UserState {
  role: PlatformRole;
  emailVerifiedAt: Date | null;
  deactivatedAt: Date | null;
}

function assertActive(user: UserState | undefined): asserts user is UserState {
  if (user === undefined) {
    throw unauthenticated();
  }
  if (user.deactivatedAt !== null) {
    throw new ApiError('account_deactivated');
  }
}

async function authenticateMobile(runtime: ServerRuntime, request: Request): Promise<Principal> {
  const header = request.headers.get('authorization');
  if (header === null || header.length > MAX_AUTHORIZATION_LENGTH) {
    throw unauthenticated();
  }
  const jws = BEARER.exec(header.trim())?.[1];
  if (jws === undefined) {
    throw unauthenticated();
  }
  const verdict = await runtime.accessTokens.verify(jws, runtime.now());
  if (!verdict.ok) {
    throw unauthenticated();
  }
  // One round trip: the user row (ADR-0012) plus the state of the token's refresh family. A
  // family is live while it holds an unrevoked, unexpired mobile row of this same user; logout,
  // password reset, deactivation and reuse detection revoke every row of it, so the access
  // token stops working on the next request instead of after its 15-minute lifetime.
  const now = runtime.now();
  const liveFamilyRow = and(
    eq(refreshTokens.familyId, verdict.claims.sid),
    eq(refreshTokens.userId, users.id),
    eq(refreshTokens.client, 'mobile'),
    isNull(refreshTokens.revokedAt),
    gt(refreshTokens.expiresAt, now),
  );
  const [user] = await runtime.db
    .select({
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      deactivatedAt: users.deactivatedAt,
      familyLive: sql<boolean>`exists (select 1 from ${refreshTokens} where ${liveFamilyRow})`,
      stepUpUntil:
        sql<Date | null>`(select max(${refreshTokens.stepUpUntil}) from ${refreshTokens} where ${liveFamilyRow})`.mapWith(
          refreshTokens.stepUpUntil,
        ),
      isPro: proSubscriptionExists(runtime.db, users.id, now),
    })
    .from(users)
    .where(eq(users.id, verdict.claims.sub))
    .limit(1);
  assertActive(user);
  if (!user.familyLive) {
    throw unauthenticated();
  }
  return {
    userId: verdict.claims.sub,
    sessionId: verdict.claims.sid,
    client: 'mobile',
    platformRole: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    sessionRowId: null,
    stepUpUntil: user.stepUpUntil ?? null,
    isPro: user.isPro,
    renewedCookies: [],
  };
}

function csrfValid(
  runtime: ServerRuntime,
  request: Request,
  sessionBinding: string,
  cookieToken: string | null,
): boolean {
  return runtime.csrf.verify({
    cookieToken,
    headerToken: request.headers.get(CSRF_HEADER),
    sessionBinding,
  });
}

function csrfCookieValue(runtime: ServerRuntime, request: Request): string | null {
  const lookup = readCookie(request.headers.get('cookie'), runtime.env.CSRF_COOKIE_NAME);
  return lookup.kind === 'present' ? lookup.value : null;
}

/**
 * Double-submit CSRF check for cookie-authenticated mutations (403 `csrf_failed`). Exported for
 * auth endpoints that consume the session cookie themselves (`auth/refresh`, `auth/logout`).
 */
export function assertCsrf(runtime: ServerRuntime, request: Request, sessionBinding: string): void {
  if (!csrfValid(runtime, request, sessionBinding, csrfCookieValue(runtime, request))) {
    throw new ApiError('csrf_failed');
  }
}

async function authenticateWeb(runtime: ServerRuntime, request: Request): Promise<Principal> {
  const lookup = readCookie(request.headers.get('cookie'), runtime.env.SESSION_COOKIE_NAME);
  if (lookup.kind !== 'present') {
    throw unauthenticated();
  }
  const parsed = opaqueTokenSchema.safeParse(lookup.value);
  if (!parsed.success) {
    throw unauthenticated();
  }
  const now = runtime.now();
  const [session] = await runtime.db
    .select({
      rowId: refreshTokens.id,
      familyId: refreshTokens.familyId,
      expiresAt: refreshTokens.expiresAt,
      stepUpUntil: refreshTokens.stepUpUntil,
      userId: users.id,
      role: users.role,
      emailVerifiedAt: users.emailVerifiedAt,
      deactivatedAt: users.deactivatedAt,
      isPro: proSubscriptionExists(runtime.db, users.id, now),
    })
    .from(refreshTokens)
    .innerJoin(users, eq(users.id, refreshTokens.userId))
    .where(
      and(
        eq(refreshTokens.tokenHash, hashToken(parsed.data)),
        eq(refreshTokens.client, 'web'),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, now),
      ),
    )
    .limit(1);
  if (session === undefined) {
    throw unauthenticated();
  }
  const csrfToken = csrfCookieValue(runtime, request);
  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    if (!csrfValid(runtime, request, session.familyId, csrfToken)) {
      throw new ApiError('csrf_failed');
    }
  }
  assertActive(session);

  const renewedCookies: string[] = [];
  const ttl = runtime.env.SESSION_TTL_SECONDS;
  const extendedUntil = sessionExtension(session.expiresAt, ttl, now);
  if (extendedUntil !== null) {
    const updated = await runtime.db
      .update(refreshTokens)
      .set({ expiresAt: extendedUntil })
      .where(and(eq(refreshTokens.id, session.rowId), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (updated.length > 0) {
      renewedCookies.push(sessionCookie(runtime.env, parsed.data, ttl));
      if (
        csrfToken !== null &&
        runtime.csrf.verify({
          cookieToken: csrfToken,
          headerToken: csrfToken,
          sessionBinding: session.familyId,
        })
      ) {
        renewedCookies.push(csrfCookie(runtime.env, csrfToken, ttl));
      }
    }
  }

  return {
    userId: session.userId,
    sessionId: session.familyId,
    client: 'web',
    platformRole: session.role,
    emailVerified: session.emailVerifiedAt !== null,
    sessionRowId: session.rowId,
    stepUpUntil: session.stepUpUntil,
    isPro: session.isPro,
    renewedCookies,
  };
}

/**
 * Authenticates the request over the transport of `client` only (ADR-0014): a cookie on a
 * `mobile` request or a bearer token on a `web` request is ignored, which yields 401. A
 * deactivated account is 401 `account_deactivated` on every endpoint (ADR-0012).
 */
export function authenticate(
  runtime: ServerRuntime,
  request: Request,
  client: AuthClient,
): Promise<Principal> {
  return client === 'mobile'
    ? authenticateMobile(runtime, request)
    : authenticateWeb(runtime, request);
}

export function actorContext(principal: Principal | null, stepUpUntil: Date | null): ActorContext {
  if (principal === null) {
    return GUEST_ACTOR;
  }
  return {
    userId: principal.userId,
    platformRole: principal.platformRole,
    emailVerified: principal.emailVerified,
    deactivated: false,
    stepUpUntil,
    isPro: principal.isPro,
  };
}

export type Allowed = Extract<Decision, { allow: true }>;

/**
 * Per-request policy gate. Every handler of an authenticated route calls `authorize()` before it
 * reads or writes data on behalf of the actor; the route wrapper fails the request with 500 when a
 * handler returns without having consulted the gate.
 */
export class AuthorizationGate {
  private consulted = false;

  constructor(
    private readonly runtime: ServerRuntime,
    readonly principal: Principal | null,
  ) {}

  get wasConsulted(): boolean {
    return this.consulted;
  }

  /** The policy actor for this request (guest when unauthenticated). */
  actor(): ActorContext {
    return actorContext(this.principal, this.principal?.stepUpUntil ?? null);
  }

  /**
   * Evaluates `can(actor, action, resource)`. A denial is thrown as the matching `ApiError`
   * (401 / 403 / 404 / 409); a missing resource fact (`PolicyContextError`) propagates and
   * becomes 500, so a handler bug fails closed.
   */
  async authorize(action: Action, resource: ResourceContext = {}): Promise<Allowed> {
    this.consulted = true;
    const decision = can(this.actor(), action, resource, {
      now: this.runtime.now(),
    });
    if (decision.allow) {
      return decision;
    }
    if (ERROR_STATUS[decision.code] !== decision.status) {
      throw new Error(`policy status ${decision.status} disagrees with code ${decision.code}`);
    }
    throw decision.code === 'unauthenticated' ? unauthenticated() : new ApiError(decision.code);
  }
}
