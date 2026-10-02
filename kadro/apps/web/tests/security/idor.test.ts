import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hashToken } from '@kadro/auth';
import { meResponseSchema, meStatsResponseSchema } from '@kadro/contracts';
import { emailTokens, refreshTokens, users } from '@kadro/db';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type RegisteredRoute, registeredRoute, type RouteHandler } from '../../lib/server/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  newPassword,
  parseSetCookies,
  post,
  setupAuthHarness,
  uniqueEmail,
  web,
} from '../auth/support';
import { call, expectProblem } from '../support/http';
// Team, invite and member rows (matrix §3.3).
import { paginatedResponseSchema, teamSummarySchema } from '@kadro/contracts';
import { districts, teamInvites, teamMembers, teams } from '@kadro/db';
import { generateInviteCode, inviteCodeHash } from '../../lib/server/teams/invites';
// Match, RSVP, lineup, payment and MVP rows (matrix §3.4).
import { matches as matchTable, matchRsvps, mvpVotes } from '@kadro/db';
// Open-call, application, venue and review rows (matrix §3.5, §3.6).
import { applicationSchema } from '@kadro/contracts';
import {
  matches as callMatches,
  openCallApplications,
  openCalls,
  venueReviews,
  venues,
} from '@kadro/db';
// Upload, push-token and account deletion rows (matrix §3.2, §3.7).
import { deletionRequests, newId, pushTokens, uploads } from '@kadro/db';
import { storedJobs } from '../support/jobs';

/**
 * IDOR suite (security checklist item 4): user A attacks resources owned by user B through every
 * protected endpoint, and the server must answer exactly as authorization matrix §2 orders it
 * (401 before 404 before 403) while B's resource stays untouched.
 *
 * Each row of IDOR_ROWS names B's resource, the endpoint (`METHOD /api/v1/...` as registered with
 * route(), dynamic segments in brackets), an `owner` function that reads the owner of the targeted
 * resource from the database (the row fails unless it really is B's), the attempt A makes, the
 * expected status and problem code, and a check that B's resource is unchanged afterwards.
 *
 * Phase 1 has only the caller's own profile and its sessions (refresh families, web sessions,
 * email tokens). Phase 2 resources go into the same table: extend `World` with B's team, match,
 * open-call application and venue review (created through the real routes), then add one row per
 * endpoint of matrix §3.3–3.7, for example `GET /api/v1/teams/[id]` with `params: { id: B's team }`
 * → 404 `not_found` (no read relationship), and `PATCH /api/v1/matches/[id]` by a player of B's
 * team → 403 `forbidden` (readable, not allowed). The route-coverage block at the end fails when a
 * protected route has no row, so a new endpoint cannot ship without its IDOR case.
 */

// ---------------------------------------------------------------------------
// Route registry: every Route Handler under app/api/v1 with its route() spec.
// ---------------------------------------------------------------------------

const API_ROOT = fileURLToPath(new URL('../../app/api/v1/', import.meta.url));

type RouteKey = `${RegisteredRoute['method']} /api/v1/${string}`;

interface LoadedRoute {
  readonly spec: RegisteredRoute;
  readonly handler: RouteHandler;
}

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

async function loadRoutes(): Promise<Map<RouteKey, LoadedRoute>> {
  const routes = new Map<RouteKey, LoadedRoute>();
  for (const file of routeFiles(API_ROOT)) {
    const routeModule = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(routeModule)) {
      const spec = registeredRoute(value);
      if (spec !== undefined) {
        routes.set(`${spec.method} ${spec.path}` as RouteKey, {
          spec,
          handler: value as RouteHandler,
        });
      }
    }
  }
  return routes;
}

/**
 * Public endpoints that act on a session or an emailed token. They need no principal, but they
 * address B's credentials, so they must have rows as well.
 */
const TOKEN_ROUTES: readonly RouteKey[] = [
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/auth/reset',
];

/** Coverage problems of a row table against the registered routes; empty when complete. */
function coverageProblems(
  routes: ReadonlyMap<RouteKey, LoadedRoute>,
  rowRoutes: readonly RouteKey[],
): string[] {
  const covered = new Set(rowRoutes);
  const problems: string[] = [];
  for (const [key, { spec }] of routes) {
    if ((spec.auth === 'required' || TOKEN_ROUTES.includes(key)) && !covered.has(key)) {
      problems.push(`${key} has no IDOR row`);
    }
  }
  for (const key of covered) {
    if (!routes.has(key)) {
      problems.push(`${key} is not a registered route`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Two-user world
// ---------------------------------------------------------------------------

interface WebSession {
  readonly session: string;
  readonly csrf: string;
  /** Both cookies as a browser sends them. */
  readonly cookie: string;
}

interface Account {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly mobile: { readonly accessToken: string; readonly refreshToken: string };
  readonly web: WebSession;
}

interface World {
  /** The attacker. */
  readonly a: Account;
  /** The victim whose resources are targeted. */
  readonly b: Account;
}

interface SendOptions {
  readonly headers: Record<string, string>;
  readonly json?: unknown;
  readonly query?: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, string>>;
}

type Send = (route: RouteKey, options: SendOptions) => Promise<Response>;

interface Expected {
  readonly status: number;
  /** Problem code for 4xx answers. */
  readonly code?: string;
}

interface IdorRow {
  /** B's resource that A targets. */
  readonly resource: string;
  /** Endpoint as registered with route(). */
  readonly route: RouteKey;
  /** What A tries. */
  readonly attempt: string;
  /** Reads the owner of the targeted resource from the database. */
  readonly owner: (world: World) => Promise<string | null | undefined>;
  readonly send: (world: World, send: Send) => Promise<Response>;
  readonly expected: Expected;
  /** Extra assertions on a successful answer (it must concern A only). */
  readonly response?: (world: World, response: Response) => Promise<void>;
  /** B's resource after the attempt. */
  readonly victimIntact: (world: World) => Promise<void>;
}

let auth: AuthHarness;
let routes: Map<RouteKey, LoadedRoute>;

function bearer(accessToken: string): Record<string, string> {
  return mobile(undefined, { authorization: `Bearer ${accessToken}` });
}

/** Web headers of a browser that holds `owner`'s cookies but sends `csrf` in the header. */
function crossSite(owner: WebSession, csrf: string): Record<string, string> {
  return web(undefined, { cookie: owner.cookie, 'x-csrf-token': csrf });
}

async function webLogin(email: string, password: string): Promise<WebSession> {
  const response = await post(routeHandler('POST /api/v1/auth/login'), web(), { email, password });
  expect(response.status, await response.clone().text()).toBe(200);
  const cookies = parseSetCookies(response);
  const session = cookies.get(auth.harness.env.SESSION_COOKIE_NAME)?.value ?? '';
  const csrf = cookies.get(auth.harness.env.CSRF_COOKIE_NAME)?.value ?? '';
  return {
    session,
    csrf,
    cookie: `${auth.harness.env.SESSION_COOKIE_NAME}=${session}; ${auth.harness.env.CSRF_COOKIE_NAME}=${csrf}`,
  };
}

function displayName(): string {
  return `Oyuncu ${randomBytes(3).toString('hex')}`;
}

async function account(): Promise<Account> {
  const name = displayName();
  const user = await createUser(auth, { displayName: name });
  const session = await mobileLogin(
    routeHandler('POST /api/v1/auth/login'),
    user.email,
    user.password,
  );
  return {
    ...user,
    displayName: name,
    mobile: { accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken },
    web: await webLogin(user.email, user.password),
  };
}

async function world(): Promise<World> {
  return { a: await account(), b: await account() };
}

function routeHandler(key: RouteKey): RouteHandler {
  const loaded = routes.get(key);
  if (loaded === undefined) {
    throw new Error(`${key} is not a registered route`);
  }
  return loaded.handler;
}

const send: Send = (key, options) => {
  const loaded = routes.get(key);
  if (loaded === undefined) {
    throw new Error(`${key} is not a registered route`);
  }
  const { spec, handler } = loaded;
  let pathname = spec.path;
  for (const [name, value] of Object.entries(options.params ?? {})) {
    pathname = pathname.replace(`[${name}]`, encodeURIComponent(value));
  }
  const search = new URLSearchParams(options.query ?? {}).toString();
  return call(handler, {
    method: spec.method,
    path: search === '' ? pathname : `${pathname}?${search}`,
    headers: options.headers,
    ...(options.json === undefined ? {} : { json: options.json }),
    ...(options.params === undefined ? {} : { params: options.params }),
  });
};

// ---------------------------------------------------------------------------
// Owner lookups and victim checks
// ---------------------------------------------------------------------------

async function userIdByEmail(email: string): Promise<string | undefined> {
  const [row] = await auth.database.client.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  return row?.id;
}

async function sessionOwner(token: string): Promise<string | undefined> {
  const [row] = await auth.database.client.db
    .select({ userId: refreshTokens.userId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(token)));
  return row?.userId;
}

async function emailTokenOwner(token: string): Promise<string | undefined> {
  const [row] = await auth.database.client.db
    .select({ userId: emailTokens.userId })
    .from(emailTokens)
    .where(eq(emailTokens.tokenHash, hashToken(token)));
  return row?.userId;
}

/** True while the session or refresh token is unrevoked and unexpired. */
async function sessionLive(token: string): Promise<boolean> {
  const [row] = await auth.database.client.db
    .select({ id: refreshTokens.id })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.tokenHash, hashToken(token)), isNull(refreshTokens.revokedAt)));
  return row !== undefined;
}

async function expectAllSessionsLive(victim: Account): Promise<void> {
  expect(await sessionLive(victim.mobile.refreshToken), 'mobile refresh family').toBe(true);
  expect(await sessionLive(victim.web.session), 'web session').toBe(true);
  const me = await send('GET /api/v1/me', { headers: bearer(victim.mobile.accessToken) });
  expect(me.status).toBe(200);
}

async function expectProfileUnchanged(victim: Account): Promise<void> {
  const [row] = await auth.database.client.db.select().from(users).where(eq(users.id, victim.id));
  expect(row?.displayName).toBe(victim.displayName);
  expect(row?.email).toBe(victim.email);
  expect(row?.role).toBe('user');
}

/** Sends a forgot request for `email` and returns the emailed reset token. */
async function resetTokenFor(email: string): Promise<string> {
  const response = await post(routeHandler('POST /api/v1/auth/forgot'), mobile(), { email });
  expect(response.status).toBe(202);
  await auth.drain();
  return auth.mail.tokenFor(email, 'password_reset');
}

// ---------------------------------------------------------------------------
// Team, invite and member fixtures of B (created on first use per world)
// ---------------------------------------------------------------------------

interface VictimTeam {
  readonly teamId: string;
  readonly teamName: string;
  readonly inviteId: string;
}

let idorDistrict: Promise<string> | undefined;

function districtId(): Promise<string> {
  idorDistrict ??= auth.database.client.db
    .insert(districts)
    .values({
      il: 'İzmir',
      ilce: 'Karşıyaka',
      ilSlug: 'izmir',
      slug: 'karsiyaka',
      centroid: { lng: 27.11, lat: 38.46 },
    })
    .returning({ id: districts.id })
    .then((rows) => rows[0]?.id ?? '');
  return idorDistrict;
}

/** Inserts a team owned by `ownerId` (as captain) with one live invite. */
async function insertTeamWithInvite(ownerId: string): Promise<VictimTeam> {
  const db = auth.database.client.db;
  const teamName = `Kadro ${randomBytes(3).toString('hex')}`;
  const [team] = await db
    .insert(teams)
    .values({
      name: teamName,
      slug: `kadro-${randomBytes(6).toString('hex')}`,
      districtId: await districtId(),
      ownerId,
    })
    .returning({ id: teams.id });
  if (team === undefined) {
    throw new Error('team insert returned no row');
  }
  await db.insert(teamMembers).values({ teamId: team.id, userId: ownerId, role: 'captain' });
  const [invite] = await db
    .insert(teamInvites)
    .values({
      teamId: team.id,
      codeHash: inviteCodeHash(generateInviteCode()),
      maxUses: 5,
      expiresAt: new Date(auth.harness.runtime.now().getTime() + 86_400_000),
    })
    .returning({ id: teamInvites.id });
  if (invite === undefined) {
    throw new Error('invite insert returned no row');
  }
  return { teamId: team.id, teamName, inviteId: invite.id };
}

const victimTeams = new WeakMap<World, Promise<VictimTeam>>();

/** B's team (B is captain and owner) with one live invite. */
function victimTeam(current: World): Promise<VictimTeam> {
  let team = victimTeams.get(current);
  if (team === undefined) {
    team = insertTeamWithInvite(current.b.id);
    victimTeams.set(current, team);
  }
  return team;
}

async function teamOwner(current: World): Promise<string | undefined> {
  const { teamId } = await victimTeam(current);
  const [row] = await auth.database.client.db
    .select({ ownerId: teams.ownerId })
    .from(teams)
    .where(eq(teams.id, teamId));
  return row?.ownerId;
}

async function inviteOwner(current: World): Promise<string | undefined> {
  const { inviteId } = await victimTeam(current);
  const [row] = await auth.database.client.db
    .select({ ownerId: teams.ownerId })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .where(eq(teamInvites.id, inviteId));
  return row?.ownerId;
}

/** B's team unchanged: same name and owner, B the only member and captain, invite unused and live. */
async function expectVictimTeamIntact(current: World): Promise<void> {
  const victim = await victimTeam(current);
  const db = auth.database.client.db;
  const [team] = await db.select().from(teams).where(eq(teams.id, victim.teamId));
  expect(team?.name).toBe(victim.teamName);
  expect(team?.ownerId).toBe(current.b.id);
  const members = await db
    .select({ userId: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, victim.teamId));
  const outsiders = members.filter((member) => member.userId !== current.a.id);
  expect(outsiders).toEqual([{ userId: current.b.id, role: 'captain' }]);
  const invites = await db.select().from(teamInvites).where(eq(teamInvites.teamId, victim.teamId));
  expect(invites.map((invite) => invite.id)).toEqual([victim.inviteId]);
  expect(invites[0]?.uses).toBe(0);
  expect(invites[0]?.expiresAt.getTime()).toBeGreaterThan(auth.harness.runtime.now().getTime());
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const IDOR_ROWS: readonly IdorRow[] = [
  {
    resource: 'profile',
    route: 'GET /api/v1/me',
    attempt: 'A names B in the query string',
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a, b }, request) =>
      request('GET /api/v1/me', { headers: bearer(a.mobile.accessToken), query: { userId: b.id } }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: ({ b }) => expectProfileUnchanged(b),
  },
  {
    resource: 'profile',
    route: 'GET /api/v1/me',
    attempt: 'A reads me: the identity comes from the credential only',
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a }, request) =>
      request('GET /api/v1/me', { headers: web(undefined, { cookie: a.web.cookie }) }),
    expected: { status: 200 },
    response: async ({ a, b }, response) => {
      const text = await response.text();
      expect(meResponseSchema.parse(JSON.parse(text)).id).toBe(a.id);
      expect(text).not.toContain(b.id);
      expect(text).not.toContain(b.email);
    },
    victimIntact: ({ b }) => expectProfileUnchanged(b),
  },
  {
    resource: 'profile statistics',
    route: 'GET /api/v1/me/stats',
    attempt: 'A names B in the query string',
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a, b }, request) =>
      request('GET /api/v1/me/stats', {
        headers: bearer(a.mobile.accessToken),
        query: { userId: b.id },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: ({ b }) => expectProfileUnchanged(b),
  },
  {
    resource: 'profile statistics',
    route: 'GET /api/v1/me/stats',
    attempt: "A reads stats: the caller's own rows and entitlement only",
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a }, request) =>
      request('GET /api/v1/me/stats', { headers: web(undefined, { cookie: a.web.cookie }) }),
    expected: { status: 200 },
    response: async (_world, response) => {
      expect(meStatsResponseSchema.parse(await response.json())).toEqual({
        tier: 'basic',
        matchesPlayed: 0,
        mvpCount: 0,
      });
    },
    victimIntact: ({ b }) => expectProfileUnchanged(b),
  },
  {
    resource: 'profile',
    route: 'PATCH /api/v1/me',
    attempt: 'A adds B as the target id to a profile update',
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a, b }, request) =>
      request('PATCH /api/v1/me', {
        headers: bearer(a.mobile.accessToken),
        json: { displayName: 'Ele Gecirildi', id: b.id },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: ({ b }) => expectProfileUnchanged(b),
  },
  {
    resource: 'profile',
    route: 'PATCH /api/v1/me',
    attempt: "cross-site update with B's cookies and A's CSRF token",
    owner: ({ b }) => sessionOwner(b.web.session),
    send: ({ a, b }, request) =>
      request('PATCH /api/v1/me', {
        headers: crossSite(b.web, a.web.csrf),
        json: { displayName: 'Ele Gecirildi' },
      }),
    expected: { status: 403, code: 'csrf_failed' },
    victimIntact: ({ b }) => expectProfileUnchanged(b),
  },
  {
    resource: 'mobile refresh family',
    route: 'POST /api/v1/auth/logout',
    attempt: "A logs out presenting B's refresh token",
    owner: ({ b }) => sessionOwner(b.mobile.refreshToken),
    send: ({ a, b }, request) =>
      request('POST /api/v1/auth/logout', {
        headers: bearer(a.mobile.accessToken),
        json: { refreshToken: b.mobile.refreshToken },
      }),
    expected: { status: 204 },
    response: async ({ a }) => {
      // Only the caller's own session ended.
      expect(await sessionLive(a.mobile.refreshToken)).toBe(false);
    },
    victimIntact: ({ b }) => expectAllSessionsLive(b),
  },
  {
    resource: 'web session',
    route: 'POST /api/v1/auth/logout',
    attempt: "cross-site logout with B's cookies and A's CSRF token",
    owner: ({ b }) => sessionOwner(b.web.session),
    send: ({ a, b }, request) =>
      request('POST /api/v1/auth/logout', { headers: crossSite(b.web, a.web.csrf), json: {} }),
    expected: { status: 403, code: 'csrf_failed' },
    victimIntact: ({ b }) => expectAllSessionsLive(b),
  },
  {
    resource: 'web session',
    route: 'POST /api/v1/auth/refresh',
    attempt: "cross-site rotation with B's cookies and A's CSRF token",
    owner: ({ b }) => sessionOwner(b.web.session),
    send: ({ a, b }, request) =>
      request('POST /api/v1/auth/refresh', { headers: crossSite(b.web, a.web.csrf), json: {} }),
    expected: { status: 403, code: 'csrf_failed' },
    victimIntact: ({ b }) => expectAllSessionsLive(b),
  },
  {
    resource: 'mobile refresh family',
    route: 'POST /api/v1/auth/refresh',
    attempt: "A replays its own rotated token: reuse detection revokes A's family only",
    owner: ({ b }) => sessionOwner(b.mobile.refreshToken),
    send: async ({ a }, request) => {
      const rotated = await request('POST /api/v1/auth/refresh', {
        headers: mobile(),
        json: { refreshToken: a.mobile.refreshToken },
      });
      expect(rotated.status).toBe(200);
      return request('POST /api/v1/auth/refresh', {
        headers: mobile(),
        json: { refreshToken: a.mobile.refreshToken },
      });
    },
    expected: { status: 401, code: 'unauthenticated' },
    victimIntact: ({ b }) => expectAllSessionsLive(b),
  },
  {
    resource: 'email verification token',
    route: 'POST /api/v1/auth/verify-email',
    attempt: "A redeems its own token naming B's account",
    owner: ({ b }) => userIdByEmail(b.email),
    send: async ({ a, b }, request) => {
      const token = verifyTokenFor(a);
      return request('POST /api/v1/auth/verify-email', {
        headers: mobile(),
        json: { token, userId: b.id },
      });
    },
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: ({ b }) => expectUnverified(b),
  },
  {
    resource: 'email verification token',
    route: 'POST /api/v1/auth/verify-email',
    attempt: "A's token verifies A's account only",
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a }, request) =>
      request('POST /api/v1/auth/verify-email', {
        headers: mobile(),
        json: { token: verifyTokenFor(a) },
      }),
    expected: { status: 204 },
    response: async ({ a }) => {
      const [row] = await auth.database.client.db.select().from(users).where(eq(users.id, a.id));
      expect(row?.emailVerifiedAt).not.toBeNull();
    },
    victimIntact: ({ b }) => expectUnverified(b),
  },
  {
    resource: 'password reset token',
    route: 'POST /api/v1/auth/reset',
    attempt: "A redeems its own reset token naming B's email",
    owner: async ({ b }) => emailTokenOwner(await resetTokenFor(b.email)),
    send: async ({ a, b }, request) =>
      request('POST /api/v1/auth/reset', {
        headers: mobile(),
        json: { token: await resetTokenFor(a.email), password: newPassword(), email: b.email },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: async ({ b }) => {
      await expectPasswordUnchanged(b);
      await expectAllSessionsLive(b);
    },
  },
  {
    resource: 'password reset token',
    route: 'POST /api/v1/auth/reset',
    attempt: "A's reset token changes A's password and ends A's sessions only",
    owner: async ({ b }) => emailTokenOwner(await resetTokenFor(b.email)),
    send: async ({ a }, request) =>
      request('POST /api/v1/auth/reset', {
        headers: mobile(),
        json: { token: await resetTokenFor(a.email), password: newPassword() },
      }),
    expected: { status: 204 },
    response: async ({ a }) => {
      expect(await sessionLive(a.mobile.refreshToken)).toBe(false);
    },
    victimIntact: async ({ b }) => {
      await expectPasswordUnchanged(b);
      await expectAllSessionsLive(b);
    },
  },
  // Teams, invites, members (matrix §3.3): B's team, its roster and its invite.
  {
    resource: 'team',
    route: 'GET /api/v1/teams',
    attempt: "A lists teams: B's team never appears",
    owner: teamOwner,
    send: async (current, request) => {
      await victimTeam(current);
      return request('GET /api/v1/teams', { headers: bearer(current.a.mobile.accessToken) });
    },
    expected: { status: 200 },
    response: async (current, response) => {
      const { teamId } = await victimTeam(current);
      const text = await response.text();
      expect(paginatedResponseSchema(teamSummarySchema).parse(JSON.parse(text)).items).toEqual([]);
      expect(text).not.toContain(teamId);
    },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team',
    route: 'POST /api/v1/teams',
    attempt: 'A creates a team naming B as owner',
    owner: teamOwner,
    send: async (current, request) =>
      request('POST /api/v1/teams', {
        headers: bearer(current.a.mobile.accessToken),
        json: { name: 'Ele Gecirildi', districtId: await districtId(), ownerId: current.b.id },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: async (current) => {
      await expectVictimTeamIntact(current);
      const owned = await auth.database.client.db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.ownerId, current.b.id));
      expect(owned).toHaveLength(1);
    },
  },
  {
    resource: 'team',
    route: 'GET /api/v1/teams/[id]',
    attempt: "A reads B's team",
    owner: teamOwner,
    send: async (current, request) =>
      request('GET /api/v1/teams/[id]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimTeam(current)).teamId },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team',
    route: 'PATCH /api/v1/teams/[id]',
    attempt: "A renames B's team",
    owner: teamOwner,
    send: async (current, request) =>
      request('PATCH /api/v1/teams/[id]', {
        headers: web(undefined, {
          cookie: current.a.web.cookie,
          'x-csrf-token': current.a.web.csrf,
        }),
        params: { id: (await victimTeam(current)).teamId },
        json: { name: 'Ele Gecirildi' },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team',
    route: 'PATCH /api/v1/teams/[id]',
    attempt: "A, a player of B's team, renames it",
    owner: teamOwner,
    send: async (current, request) => {
      const { teamId } = await victimTeam(current);
      await auth.database.client.db
        .insert(teamMembers)
        .values({ teamId, userId: current.a.id, role: 'player' });
      return request('PATCH /api/v1/teams/[id]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: teamId },
        json: { name: 'Ele Gecirildi' },
      });
    },
    expected: { status: 403, code: 'forbidden' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team',
    route: 'DELETE /api/v1/teams/[id]',
    attempt: "A deletes B's team",
    owner: teamOwner,
    send: async (current, request) =>
      request('DELETE /api/v1/teams/[id]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimTeam(current)).teamId },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team invite',
    route: 'GET /api/v1/teams/[id]/invites',
    attempt: "A lists the invites of B's team",
    owner: inviteOwner,
    send: async (current, request) =>
      request('GET /api/v1/teams/[id]/invites', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimTeam(current)).teamId },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team invite',
    route: 'POST /api/v1/teams/[id]/invites',
    attempt: "A creates an invite for B's team",
    owner: teamOwner,
    send: async (current, request) =>
      request('POST /api/v1/teams/[id]/invites', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimTeam(current)).teamId },
        json: {},
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team invite',
    route: 'DELETE /api/v1/teams/[id]/invites/[inviteId]',
    attempt: "A, captain of its own team, revokes B's invite through its own team id",
    owner: inviteOwner,
    send: async (current, request) => {
      const own = await insertTeamWithInvite(current.a.id);
      return request('DELETE /api/v1/teams/[id]/invites/[inviteId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: own.teamId, inviteId: (await victimTeam(current)).inviteId },
      });
    },
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team invite',
    route: 'POST /api/v1/invites/[code]/accept',
    attempt: "A guesses a code to join B's team",
    owner: inviteOwner,
    send: async (current, request) => {
      await victimTeam(current);
      return request('POST /api/v1/invites/[code]/accept', {
        headers: bearer(current.a.mobile.accessToken),
        params: { code: generateInviteCode() },
        json: {},
      });
    },
    expected: { status: 404, code: 'not_found' },
    victimIntact: async (current) => {
      await expectVictimTeamIntact(current);
      const { teamId } = await victimTeam(current);
      const joined = await auth.database.client.db
        .select()
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, current.a.id)));
      expect(joined).toEqual([]);
    },
  },
  {
    resource: 'team member',
    route: 'PATCH /api/v1/teams/[id]/members/[userId]',
    attempt: "A makes itself captain of B's team",
    owner: teamOwner,
    send: async (current, request) =>
      request('PATCH /api/v1/teams/[id]/members/[userId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimTeam(current)).teamId, userId: current.a.id },
        json: { role: 'captain' },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  {
    resource: 'team member',
    route: 'DELETE /api/v1/teams/[id]/members/[userId]',
    attempt: "A removes B from B's team",
    owner: teamOwner,
    send: async (current, request) =>
      request('DELETE /api/v1/teams/[id]/members/[userId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimTeam(current)).teamId, userId: current.b.id },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimTeamIntact,
  },
  // Matches, RSVP, lineup, payments, MVP (matrix §3.4): B's locked and played matches.
  {
    resource: 'match',
    route: 'GET /api/v1/teams/[id]/matches',
    attempt: "A lists the matches of B's team",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) =>
      request('GET /api/v1/teams/[id]/matches', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).teamId },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match',
    route: 'POST /api/v1/teams/[id]/matches',
    attempt: "A creates a match in B's team",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) =>
      request('POST /api/v1/teams/[id]/matches', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).teamId },
        json: {
          venueText: 'Ele Gecirildi',
          startsAt: new Date(auth.harness.runtime.now().getTime() + 86_400_000).toISOString(),
          format: '5v5',
          feeTotalMinor: 0,
          slots: 10,
        },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match',
    route: 'GET /api/v1/matches/[id]',
    attempt: "A reads B's match",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) =>
      request('GET /api/v1/matches/[id]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).lockedId },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match',
    route: 'PATCH /api/v1/matches/[id]',
    attempt: "A reopens B's match and changes the fee",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) =>
      request('PATCH /api/v1/matches/[id]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).lockedId },
        json: { status: 'open', feeTotalMinor: 1 },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match',
    route: 'PATCH /api/v1/matches/[id]',
    attempt: "A, a player of B's team, cancels B's match",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) => {
      const { teamId, lockedId } = await victimMatches(current);
      await auth.database.client.db
        .insert(teamMembers)
        .values({ teamId, userId: current.a.id, role: 'player' });
      return request('PATCH /api/v1/matches/[id]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: lockedId },
        json: { status: 'cancelled' },
      });
    },
    expected: { status: 403, code: 'forbidden' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match',
    route: 'DELETE /api/v1/matches/[id]',
    attempt: "A cancels B's match",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) =>
      request('DELETE /api/v1/matches/[id]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).lockedId },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match RSVP',
    route: 'PUT /api/v1/matches/[id]/rsvp',
    attempt: "A joins B's match",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) =>
      request('PUT /api/v1/matches/[id]/rsvp', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).lockedId },
        json: { status: 'in' },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match lineup',
    route: 'PUT /api/v1/matches/[id]/lineup',
    attempt: "A, captain of its own team, sets the lineup of B's match",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) => {
      await insertTeamWithInvite(current.a.id);
      return request('PUT /api/v1/matches/[id]/lineup', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).lockedId },
        json: { sides: [{ userId: current.b.id, side: 'A' }] },
      });
    },
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match payment',
    route: 'PATCH /api/v1/matches/[id]/payments/[userId]',
    attempt: "A marks B's share on B's match",
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) =>
      request('PATCH /api/v1/matches/[id]/payments/[userId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).lockedId, userId: current.b.id },
        json: { paid: true },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'match payment',
    route: 'PATCH /api/v1/matches/[id]/payments/[userId]',
    attempt: 'A, captain of its own locked match, names B as the payment target there',
    owner: (current) => matchOwner(current, 'lockedId'),
    send: async (current, request) => {
      const own = await insertTeamWithInvite(current.a.id);
      const ownMatch = await insertLockedMatch(own.teamId, current.a.id);
      return request('PATCH /api/v1/matches/[id]/payments/[userId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: ownMatch, userId: current.b.id },
        json: { paid: true },
      });
    },
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  {
    resource: 'MVP vote',
    route: 'POST /api/v1/matches/[id]/mvp-vote',
    attempt: "A votes on B's played match",
    owner: (current) => matchOwner(current, 'playedId'),
    send: async (current, request) =>
      request('POST /api/v1/matches/[id]/mvp-vote', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimMatches(current)).playedId },
        json: { voteeId: current.b.id },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimMatchesIntact,
  },
  // Open calls and applications (matrix §3.5): B's call and B's own application elsewhere.
  {
    resource: 'open call',
    route: 'POST /api/v1/matches/[id]/open-call',
    attempt: "A publishes a call on B's match",
    owner: callOwner,
    send: async (current, request) =>
      request('POST /api/v1/matches/[id]/open-call', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimCalls(current)).matchId },
        json: {
          missingCount: 1,
          position: null,
          level: 'casual',
          expiresAt: new Date(auth.harness.runtime.now().getTime() + 3_600_000).toISOString(),
        },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'open call',
    route: 'PATCH /api/v1/matches/[id]/open-call',
    attempt: "A closes B's call",
    owner: callOwner,
    send: async (current, request) =>
      request('PATCH /api/v1/matches/[id]/open-call', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimCalls(current)).matchId },
        json: { status: 'closed' },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'open call',
    route: 'PATCH /api/v1/matches/[id]/open-call',
    attempt: "A, a player of B's team, closes B's call",
    owner: callOwner,
    send: async (current, request) => {
      const { teamId } = await victimTeam(current);
      await auth.database.client.db
        .insert(teamMembers)
        .values({ teamId, userId: current.a.id, role: 'player' });
      return request('PATCH /api/v1/matches/[id]/open-call', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimCalls(current)).matchId },
        json: { status: 'closed' },
      });
    },
    expected: { status: 403, code: 'forbidden' },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'open call',
    route: 'POST /api/v1/open-calls/[id]/applications',
    attempt: "A applies to B's call in B's name",
    owner: callOwner,
    send: async (current, request) =>
      request('POST /api/v1/open-calls/[id]/applications', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimCalls(current)).callId },
        json: { userId: current.b.id },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'open call',
    route: 'GET /api/v1/open-calls/[id]/applications',
    attempt: "A lists the applications of B's call",
    owner: callOwner,
    send: async (current, request) =>
      request('GET /api/v1/open-calls/[id]/applications', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimCalls(current)).callId },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'application',
    route: 'GET /api/v1/open-calls/[id]/applications',
    attempt: "A, applicant of the same call, lists it: only A's own row, never B's",
    owner: applicationOwner,
    send: async (current, request) => {
      const { foreignCallId } = await victimCalls(current);
      await auth.database.client.db
        .insert(openCallApplications)
        .values({ openCallId: foreignCallId, userId: current.a.id });
      return request('GET /api/v1/open-calls/[id]/applications', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: foreignCallId },
      });
    },
    expected: { status: 200 },
    response: async (current, response) => {
      const { applicationId } = await victimCalls(current);
      const text = await response.text();
      const items = paginatedResponseSchema(applicationSchema).parse(JSON.parse(text)).items;
      expect(items.map((item) => item.applicant.id)).toEqual([current.a.id]);
      expect(text).not.toContain(applicationId);
      expect(text).not.toContain(current.b.id);
    },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'application',
    route: 'PATCH /api/v1/open-calls/[id]/applications/[appId]',
    attempt: "A accepts a pending application on B's call",
    owner: callOwner,
    send: async (current, request) => {
      const victim = await victimCalls(current);
      return request('PATCH /api/v1/open-calls/[id]/applications/[appId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: victim.callId, appId: victim.pendingOnCallId },
        json: { status: 'accepted' },
      });
    },
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'application',
    route: 'PATCH /api/v1/open-calls/[id]/applications/[appId]',
    attempt: "A, captain of its own call, rejects B's application through its own call id",
    owner: applicationOwner,
    send: async (current, request) => {
      const own = await insertTeamWithInvite(current.a.id);
      const ownCall = await insertOpenCall(own.teamId);
      return request('PATCH /api/v1/open-calls/[id]/applications/[appId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: ownCall.callId, appId: (await victimCalls(current)).applicationId },
        json: { status: 'rejected' },
      });
    },
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimCallsIntact,
  },
  {
    resource: 'application',
    route: 'PATCH /api/v1/open-calls/[id]/applications/[appId]',
    attempt: "A, applicant of the same call, withdraws B's application",
    owner: applicationOwner,
    send: async (current, request) => {
      const victim = await victimCalls(current);
      await auth.database.client.db
        .insert(openCallApplications)
        .values({ openCallId: victim.foreignCallId, userId: current.a.id });
      return request('PATCH /api/v1/open-calls/[id]/applications/[appId]', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: victim.foreignCallId, appId: victim.applicationId },
        json: { status: 'withdrawn' },
      });
    },
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimCallsIntact,
  },
  // Venues and reviews (matrix §3.6): B's review of a verified venue.
  {
    resource: 'venue',
    route: 'POST /api/v1/venues',
    attempt: 'A creates a venue naming B as its creator',
    owner: reviewOwner,
    send: async (current, request) =>
      request('POST /api/v1/venues', {
        headers: bearer(current.a.mobile.accessToken),
        json: {
          name: `Deneme Sahası ${randomBytes(3).toString('hex')}`,
          districtId: await districtId(),
          location: { latitude: 38.46, longitude: 27.11 },
          indoor: false,
          features: {},
          createdBy: current.b.id,
        },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: async (current) => {
      await expectVictimReviewIntact(current);
      const created = await auth.database.client.db
        .select({ id: venues.id })
        .from(venues)
        .where(eq(venues.createdBy, current.b.id));
      expect(created).toEqual([]);
    },
  },
  {
    resource: 'venue review',
    route: 'POST /api/v1/venues/[slug]/reviews',
    attempt: "A reviews B's venue in B's name",
    owner: reviewOwner,
    send: async (current, request) =>
      request('POST /api/v1/venues/[slug]/reviews', {
        headers: bearer(current.a.mobile.accessToken),
        params: { slug: (await victimReview(current)).slug },
        json: { rating: 1, userId: current.b.id },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: expectVictimReviewIntact,
  },
  {
    resource: 'venue review',
    route: 'DELETE /api/v1/venues/[slug]/reviews/mine',
    attempt: "A deletes 'mine' on the venue B reviewed: B's review stays",
    owner: reviewOwner,
    send: async (current, request) =>
      request('DELETE /api/v1/venues/[slug]/reviews/mine', {
        headers: bearer(current.a.mobile.accessToken),
        params: { slug: (await victimReview(current)).slug },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimReviewIntact,
  },
  // Uploads (matrix §3.7 footnote 31): B's pending avatar upload and B's team badge.
  {
    resource: 'team badge',
    route: 'POST /api/v1/uploads/presign',
    attempt: "A presigns a badge for B's team",
    owner: teamOwner,
    send: async (current, request) =>
      request('POST /api/v1/uploads/presign', {
        headers: bearer(current.a.mobile.accessToken),
        json: {
          kind: 'badge',
          teamId: (await victimTeam(current)).teamId,
          contentType: 'image/png',
          contentLength: 1_000,
        },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: async (current) => {
      await expectVictimTeamIntact(current);
      const rows = await auth.database.client.db
        .select({ id: uploads.id })
        .from(uploads)
        .where(eq(uploads.teamId, (await victimTeam(current)).teamId));
      expect(rows).toEqual([]);
    },
  },
  {
    resource: 'avatar upload',
    route: 'POST /api/v1/uploads/presign',
    attempt: "A presigns into B's avatar key",
    owner: uploadOwner,
    send: async (current, request) =>
      request('POST /api/v1/uploads/presign', {
        headers: bearer(current.a.mobile.accessToken),
        json: {
          kind: 'avatar',
          contentType: 'image/png',
          contentLength: 1_000,
          key: (await victimUpload(current)).key,
        },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: expectVictimUploadIntact,
  },
  {
    resource: 'avatar upload',
    route: 'POST /api/v1/uploads/[id]/complete',
    attempt: "A completes B's upload",
    owner: uploadOwner,
    send: async (current, request) =>
      request('POST /api/v1/uploads/[id]/complete', {
        headers: bearer(current.a.mobile.accessToken),
        params: { id: (await victimUpload(current)).id },
        json: {},
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimUploadIntact,
  },
  {
    resource: 'avatar upload',
    route: 'GET /api/v1/uploads/[id]',
    attempt: "A reads the status of B's upload",
    owner: uploadOwner,
    send: async (current, request) =>
      request('GET /api/v1/uploads/[id]', {
        headers: web(undefined, { cookie: current.a.web.cookie }),
        params: { id: (await victimUpload(current)).id },
      }),
    expected: { status: 404, code: 'not_found' },
    victimIntact: expectVictimUploadIntact,
  },
  // Push tokens and account deletion (matrix §3.2).
  {
    resource: 'push token',
    route: 'POST /api/v1/me/push-tokens',
    attempt: 'A registers a token naming B as its owner',
    owner: pushTokenOwner,
    send: (current, request) =>
      request('POST /api/v1/me/push-tokens', {
        headers: bearer(current.a.mobile.accessToken),
        json: { expoToken: victimPushToken(current), platform: 'ios', userId: current.b.id },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: expectVictimPushTokenIntact,
  },
  {
    resource: 'account',
    route: 'DELETE /api/v1/me',
    attempt: "A asks to delete B's account by id",
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a, b }, request) =>
      request('DELETE /api/v1/me', {
        headers: bearer(a.mobile.accessToken),
        json: { password: a.password, userId: b.id },
      }),
    expected: { status: 400, code: 'validation_failed' },
    victimIntact: expectAccountIntact,
  },
  {
    resource: 'account',
    route: 'DELETE /api/v1/me',
    attempt: "A presents B's password: the proof is checked against A's own account",
    owner: ({ b }) => userIdByEmail(b.email),
    send: ({ a, b }, request) =>
      request('DELETE /api/v1/me', {
        headers: bearer(a.mobile.accessToken),
        json: { password: b.password },
      }),
    expected: { status: 401, code: 'reauth_required' },
    victimIntact: expectAccountIntact,
  },
  {
    resource: 'account',
    route: 'DELETE /api/v1/me',
    attempt: "cross-site deletion with B's cookies and A's CSRF token",
    owner: ({ b }) => sessionOwner(b.web.session),
    send: ({ a, b }, request) =>
      request('DELETE /api/v1/me', {
        headers: crossSite(b.web, a.web.csrf),
        json: { password: b.password },
      }),
    expected: { status: 403, code: 'csrf_failed' },
    victimIntact: expectAccountIntact,
  },
];

// ---------------------------------------------------------------------------
// Upload, push-token and account fixtures of B
// ---------------------------------------------------------------------------

interface VictimUpload {
  readonly id: string;
  readonly key: string;
}

const victimUploads = new WeakMap<World, Promise<VictimUpload>>();

/** B's pending avatar upload, inserted as the presign endpoint stores it. */
function victimUpload(current: World): Promise<VictimUpload> {
  let upload = victimUploads.get(current);
  if (upload === undefined) {
    const id = newId();
    const key = `avatars/${current.b.id}/${id}`;
    upload = auth.database.client.db
      .insert(uploads)
      .values({
        id,
        userId: current.b.id,
        kind: 'avatar',
        contentType: 'image/png',
        contentLength: 1_000,
        status: 'pending',
        key,
        createdAt: auth.harness.runtime.now(),
      })
      .then(() => ({ id, key }));
    victimUploads.set(current, upload);
  }
  return upload;
}

async function uploadOwner(current: World): Promise<string | undefined> {
  const { id } = await victimUpload(current);
  const [row] = await auth.database.client.db
    .select({ userId: uploads.userId })
    .from(uploads)
    .where(eq(uploads.id, id));
  return row?.userId;
}

/** B's upload still pending, its key unchanged, no processing job, and no upload row for A. */
async function expectVictimUploadIntact(current: World): Promise<void> {
  const victim = await victimUpload(current);
  const db = auth.database.client.db;
  const [row] = await db.select().from(uploads).where(eq(uploads.id, victim.id));
  expect(row).toMatchObject({ userId: current.b.id, status: 'pending', key: victim.key });
  const jobs = await storedJobs(auth.database.url, 'upload.process');
  expect(jobs.filter((job) => job.data.uploadId === victim.id)).toEqual([]);
  expect(await db.select().from(uploads).where(eq(uploads.userId, current.a.id))).toEqual([]);
}

const victimTokens = new WeakMap<World, string>();

/** B's registered Expo token (generated at run time, inserted by the owner lookup). */
function victimPushToken(current: World): string {
  let expo = victimTokens.get(current);
  if (expo === undefined) {
    expo = `ExponentPushToken[${randomBytes(12).toString('base64url')}]`;
    victimTokens.set(current, expo);
  }
  return expo;
}

async function pushTokenOwner(current: World): Promise<string | undefined> {
  const token = victimPushToken(current);
  const db = auth.database.client.db;
  await db
    .insert(pushTokens)
    .values({ userId: current.b.id, expoToken: token, platform: 'android' })
    .onConflictDoNothing();
  const [row] = await db
    .select({ userId: pushTokens.userId })
    .from(pushTokens)
    .where(eq(pushTokens.expoToken, token));
  return row?.userId;
}

async function expectVictimPushTokenIntact(current: World): Promise<void> {
  const rows = await auth.database.client.db
    .select({ userId: pushTokens.userId, platform: pushTokens.platform })
    .from(pushTokens)
    .where(eq(pushTokens.expoToken, victimPushToken(current)));
  expect(rows).toEqual([{ userId: current.b.id, platform: 'android' }]);
}

/** Neither account is deactivated or has a pending deletion; B's sessions all work. */
async function expectAccountIntact(current: World): Promise<void> {
  const db = auth.database.client.db;
  for (const user of [current.a, current.b]) {
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.deactivatedAt).toBeNull();
    expect(
      await db.select().from(deletionRequests).where(eq(deletionRequests.userId, user.id)),
    ).toEqual([]);
  }
  await expectAllSessionsLive(current.b);
}

// ---------------------------------------------------------------------------
// Match fixtures of B (created on first use per world)
// ---------------------------------------------------------------------------

interface VictimMatches {
  readonly teamId: string;
  /** Locked match of B's team; B holds a confirmed, unpaid RSVP. */
  readonly lockedId: string;
  /** Played match inside its MVP window; B holds a confirmed RSVP. */
  readonly playedId: string;
}

const MATCH_HOUR_MS = 3_600_000;
const VICTIM_FEE_MINOR = 50_000;

/** A locked match of `teamId` with `userId` confirmed. */
async function insertLockedMatch(teamId: string, userId: string): Promise<string> {
  const db = auth.database.client.db;
  const now = auth.harness.runtime.now().getTime();
  const [row] = await db
    .insert(matchTable)
    .values({
      teamId,
      startsAt: new Date(now + 48 * MATCH_HOUR_MS),
      format: '5v5',
      slots: 10,
      feeTotalMinor: VICTIM_FEE_MINOR,
      status: 'locked',
      lockedAt: new Date(now - MATCH_HOUR_MS),
      venueText: 'Karşıyaka Halı Saha',
    })
    .returning({ id: matchTable.id });
  if (row === undefined) {
    throw new Error('match insert returned no row');
  }
  await db.insert(matchRsvps).values({ matchId: row.id, userId, status: 'in' });
  return row.id;
}

async function insertVictimMatches(current: World): Promise<VictimMatches> {
  const { teamId } = await victimTeam(current);
  const db = auth.database.client.db;
  const now = auth.harness.runtime.now().getTime();
  const lockedId = await insertLockedMatch(teamId, current.b.id);
  const [played] = await db
    .insert(matchTable)
    .values({
      teamId,
      startsAt: new Date(now - 2 * MATCH_HOUR_MS),
      format: '5v5',
      slots: 10,
      feeTotalMinor: VICTIM_FEE_MINOR,
      status: 'played',
      lockedAt: new Date(now - 24 * MATCH_HOUR_MS),
      mvpVoteClosesAt: new Date(now + 20 * MATCH_HOUR_MS),
      venueText: 'Karşıyaka Halı Saha',
    })
    .returning({ id: matchTable.id });
  if (played === undefined) {
    throw new Error('match insert returned no row');
  }
  await db.insert(matchRsvps).values({ matchId: played.id, userId: current.b.id, status: 'in' });
  return { teamId, lockedId, playedId: played.id };
}

const victimMatchSets = new WeakMap<World, Promise<VictimMatches>>();

function victimMatches(current: World): Promise<VictimMatches> {
  let set = victimMatchSets.get(current);
  if (set === undefined) {
    set = insertVictimMatches(current);
    victimMatchSets.set(current, set);
  }
  return set;
}

async function matchOwner(
  current: World,
  which: 'lockedId' | 'playedId',
): Promise<string | undefined> {
  const victim = await victimMatches(current);
  const [row] = await auth.database.client.db
    .select({ ownerId: teams.ownerId })
    .from(matchTable)
    .innerJoin(teams, eq(teams.id, matchTable.teamId))
    .where(eq(matchTable.id, which === 'lockedId' ? victim.lockedId : victim.playedId));
  return row?.ownerId;
}

/** B's team, its two matches, B's RSVPs on them and the vote table untouched. */
async function expectVictimMatchesIntact(current: World): Promise<void> {
  await expectVictimTeamIntact(current);
  const victim = await victimMatches(current);
  const db = auth.database.client.db;
  const rows = await db
    .select({
      id: matchTable.id,
      status: matchTable.status,
      fee: matchTable.feeTotalMinor,
    })
    .from(matchTable)
    .where(eq(matchTable.teamId, victim.teamId));
  expect(rows.map((row) => row.id).sort()).toEqual([victim.lockedId, victim.playedId].sort());
  expect(rows.find((row) => row.id === victim.lockedId)).toMatchObject({
    status: 'locked',
    fee: VICTIM_FEE_MINOR,
  });
  for (const matchId of [victim.lockedId, victim.playedId]) {
    const rsvps = await db
      .select({
        userId: matchRsvps.userId,
        status: matchRsvps.status,
        paid: matchRsvps.paid,
        side: matchRsvps.side,
      })
      .from(matchRsvps)
      .where(eq(matchRsvps.matchId, matchId));
    expect(rsvps).toEqual([{ userId: current.b.id, status: 'in', paid: false, side: null }]);
  }
  expect(await db.select().from(mvpVotes).where(eq(mvpVotes.matchId, victim.playedId))).toEqual([]);
}

// ---------------------------------------------------------------------------
// Open-call, application and review fixtures of B (created on first use per world)
// ---------------------------------------------------------------------------

interface VictimCalls {
  /** Open match of B's team with B's open call on it. */
  readonly matchId: string;
  readonly callId: string;
  /** A third user's pending application to B's call. */
  readonly pendingOnCallId: string;
  /** Open call of a third user's team that B applied to, and B's pending application. */
  readonly foreignCallId: string;
  readonly applicationId: string;
}

interface VictimReview {
  readonly venueId: string;
  readonly slug: string;
  readonly reviewId: string;
}

const CALL_HOUR_MS = 3_600_000;

/** A verified user without a session (applicant or owner who never sends a request). */
async function insertBareUser(): Promise<string> {
  const [row] = await auth.database.client.db
    .insert(users)
    .values({ email: uniqueEmail(), displayName: displayName(), emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  if (row === undefined) {
    throw new Error('user insert returned no row');
  }
  return row.id;
}

/** An open future match of `teamId` with one open call on it. */
async function insertOpenCall(teamId: string): Promise<{ matchId: string; callId: string }> {
  const db = auth.database.client.db;
  const now = auth.harness.runtime.now().getTime();
  const [match] = await db
    .insert(callMatches)
    .values({
      teamId,
      startsAt: new Date(now + 48 * CALL_HOUR_MS),
      format: '7v7',
      slots: 14,
      status: 'open',
      venueText: 'Deneme sahası',
    })
    .returning({ id: callMatches.id });
  if (match === undefined) {
    throw new Error('match insert returned no row');
  }
  const [call] = await db
    .insert(openCalls)
    .values({
      matchId: match.id,
      missingCount: 2,
      level: 'regular',
      districtId: await districtId(),
      expiresAt: new Date(now + 24 * CALL_HOUR_MS),
    })
    .returning({ id: openCalls.id });
  if (call === undefined) {
    throw new Error('open call insert returned no row');
  }
  return { matchId: match.id, callId: call.id };
}

async function insertApplicationRow(openCallId: string, userId: string): Promise<string> {
  const [row] = await auth.database.client.db
    .insert(openCallApplications)
    .values({ openCallId, userId })
    .returning({ id: openCallApplications.id });
  if (row === undefined) {
    throw new Error('application insert returned no row');
  }
  return row.id;
}

async function insertVictimCalls(current: World): Promise<VictimCalls> {
  const { teamId } = await victimTeam(current);
  const own = await insertOpenCall(teamId);
  const pendingOnCallId = await insertApplicationRow(own.callId, await insertBareUser());
  const other = await insertTeamWithInvite(await insertBareUser());
  const foreign = await insertOpenCall(other.teamId);
  const applicationId = await insertApplicationRow(foreign.callId, current.b.id);
  return {
    matchId: own.matchId,
    callId: own.callId,
    pendingOnCallId,
    foreignCallId: foreign.callId,
    applicationId,
  };
}

const victimCallSets = new WeakMap<World, Promise<VictimCalls>>();

function victimCalls(current: World): Promise<VictimCalls> {
  let set = victimCallSets.get(current);
  if (set === undefined) {
    set = insertVictimCalls(current);
    victimCallSets.set(current, set);
  }
  return set;
}

/** Owner (captain) of the team behind B's call. */
async function callOwner(current: World): Promise<string | undefined> {
  const { callId } = await victimCalls(current);
  const [row] = await auth.database.client.db
    .select({ ownerId: teams.ownerId })
    .from(openCalls)
    .innerJoin(callMatches, eq(callMatches.id, openCalls.matchId))
    .innerJoin(teams, eq(teams.id, callMatches.teamId))
    .where(eq(openCalls.id, callId));
  return row?.ownerId;
}

async function applicationOwner(current: World): Promise<string | undefined> {
  const { applicationId } = await victimCalls(current);
  const [row] = await auth.database.client.db
    .select({ userId: openCallApplications.userId })
    .from(openCallApplications)
    .where(eq(openCallApplications.id, applicationId));
  return row?.userId;
}

/**
 * B's call still open with its missing count, the third user's application and B's own
 * application still pending, no RSVP added to either match, and A never applied to B's call.
 */
async function expectVictimCallsIntact(current: World): Promise<void> {
  await expectVictimTeamIntact(current);
  const victim = await victimCalls(current);
  const db = auth.database.client.db;
  const calls = await db
    .select({ id: openCalls.id, status: openCalls.status, missing: openCalls.missingCount })
    .from(openCalls)
    .where(eq(openCalls.matchId, victim.matchId));
  expect(calls).toEqual([{ id: victim.callId, status: 'open', missing: 2 }]);
  const onVictimCall = await db
    .select({ id: openCallApplications.id, status: openCallApplications.status })
    .from(openCallApplications)
    .where(eq(openCallApplications.openCallId, victim.callId));
  expect(onVictimCall).toEqual([{ id: victim.pendingOnCallId, status: 'pending' }]);
  const [own] = await db
    .select({ status: openCallApplications.status })
    .from(openCallApplications)
    .where(eq(openCallApplications.id, victim.applicationId));
  expect(own?.status).toBe('pending');
  const rsvps = await db
    .select({ id: matchRsvps.id })
    .from(matchRsvps)
    .where(eq(matchRsvps.matchId, victim.matchId));
  expect(rsvps).toEqual([]);
}

async function insertVictimReview(current: World): Promise<VictimReview> {
  const db = auth.database.client.db;
  const suffix = randomBytes(4).toString('hex');
  const [venue] = await db
    .insert(venues)
    .values({
      name: `[ÖRNEK] Deneme Sahası ${suffix}`,
      slug: `ornek-deneme-${suffix}`,
      searchName: `[ornek] deneme sahasi ${suffix}`,
      districtId: await districtId(),
      point: { lng: 27.11, lat: 38.46 },
      verified: true,
    })
    .returning({ id: venues.id, slug: venues.slug });
  if (venue === undefined) {
    throw new Error('venue insert returned no row');
  }
  const [review] = await db
    .insert(venueReviews)
    .values({ venueId: venue.id, userId: current.b.id, rating: 4, text: 'Zemin iyi' })
    .returning({ id: venueReviews.id });
  if (review === undefined) {
    throw new Error('review insert returned no row');
  }
  return { venueId: venue.id, slug: venue.slug, reviewId: review.id };
}

const victimReviews = new WeakMap<World, Promise<VictimReview>>();

function victimReview(current: World): Promise<VictimReview> {
  let review = victimReviews.get(current);
  if (review === undefined) {
    review = insertVictimReview(current);
    victimReviews.set(current, review);
  }
  return review;
}

async function reviewOwner(current: World): Promise<string | undefined> {
  const { reviewId } = await victimReview(current);
  const [row] = await auth.database.client.db
    .select({ userId: venueReviews.userId })
    .from(venueReviews)
    .where(eq(venueReviews.id, reviewId));
  return row?.userId;
}

/** B's review unchanged and the only review of the venue. */
async function expectVictimReviewIntact(current: World): Promise<void> {
  const victim = await victimReview(current);
  const rows = await auth.database.client.db
    .select({ id: venueReviews.id, userId: venueReviews.userId, rating: venueReviews.rating })
    .from(venueReviews)
    .where(eq(venueReviews.venueId, victim.venueId));
  expect(rows).toEqual([{ id: victim.reviewId, userId: current.b.id, rating: 4 }]);
}

/** World variant for verification rows: both accounts start unverified. */
const UNVERIFIED_ROUTES: ReadonlySet<RouteKey> = new Set(['POST /api/v1/auth/verify-email']);

/** Token of the verification mail sent when `target` registered. */
function verifyTokenFor(target: Account): string {
  return auth.mail.tokenFor(target.email, 'verify_email');
}

async function expectUnverified(victim: Account): Promise<void> {
  const [row] = await auth.database.client.db.select().from(users).where(eq(users.id, victim.id));
  expect(row?.emailVerifiedAt).toBeNull();
}

async function expectPasswordUnchanged(victim: Account): Promise<void> {
  const response = await post(routeHandler('POST /api/v1/auth/login'), mobile(), {
    email: victim.email,
    password: victim.password,
  });
  expect(response.status).toBe(200);
}

/** Accounts created through register, so each has a pending verification email. */
async function registeredAccount(): Promise<Account> {
  const email = uniqueEmail();
  const password = newPassword();
  const name = displayName();
  const registered = await post(routeHandler('POST /api/v1/auth/register'), mobile(), {
    email,
    password,
    displayName: name,
  });
  expect(registered.status).toBe(202);
  await auth.drain();
  const id = await userIdByEmail(email);
  if (id === undefined) {
    throw new Error('register created no account');
  }
  const session = await mobileLogin(routeHandler('POST /api/v1/auth/login'), email, password);
  return {
    id,
    email,
    password,
    displayName: name,
    mobile: { accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken },
    web: await webLogin(email, password),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

beforeAll(async () => {
  auth = await setupAuthHarness('web_security_idor', {
    RATE_LIMIT_AUTH_MAX: '100',
    RATE_LIMIT_REFRESH_MAX: '1000',
  });
  routes = await loadRoutes();
});

afterAll(async () => {
  await auth.database.dispose();
});

describe('IDOR: user A against resources of user B (matrix §2 order)', () => {
  for (const row of IDOR_ROWS) {
    it(`${row.route} [${row.resource}] ${row.attempt} → ${row.expected.status}`, async () => {
      auth.harness.setNow(new Date());
      const current = UNVERIFIED_ROUTES.has(row.route)
        ? { a: await registeredAccount(), b: await registeredAccount() }
        : await world();
      expect(await row.owner(current), 'the targeted resource belongs to B').toBe(current.b.id);

      const response = await row.send(current, send);
      if (row.expected.code === undefined) {
        expect(response.status, await response.clone().text()).toBe(row.expected.status);
      } else {
        await expectProblem(response.clone(), row.expected.status, row.expected.code);
      }
      await row.response?.(current, response);
      await row.victimIntact(current);
    });
  }
});

describe('IDOR: anonymous callers are refused before anything else', () => {
  it('answers 401 on every protected route, even with B-targeting input', async () => {
    const victim = await account();
    const protectedRoutes = [...routes].filter(([, { spec }]) => spec.auth === 'required');
    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const [key, { spec }] of protectedRoutes) {
      const json =
        spec.method === 'GET' || spec.method === 'DELETE' ? undefined : { id: victim.id };
      for (const headers of [mobile(), web()]) {
        await expectProblem(await send(key, { headers, json }), 401, 'unauthenticated');
      }
    }
    await expectProfileUnchanged(victim);
    await expectAllSessionsLive(victim);
  });
});

describe('IDOR route coverage', () => {
  it('has a row for every protected and token-bearing route', () => {
    expect(
      coverageProblems(
        routes,
        IDOR_ROWS.map((row) => row.route),
      ),
    ).toEqual([]);
  });

  it('fails for a protected route without a row and for a row without a route', () => {
    const rows = IDOR_ROWS.map((row) => row.route).filter((key) => key !== 'PATCH /api/v1/me');
    expect(coverageProblems(routes, [...rows, 'DELETE /api/v1/teams/[id]/badge'])).toEqual([
      'PATCH /api/v1/me has no IDOR row',
      'DELETE /api/v1/teams/[id]/badge is not a registered route',
    ]);
  });
});
