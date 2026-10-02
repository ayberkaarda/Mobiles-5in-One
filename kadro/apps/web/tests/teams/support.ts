import { randomBytes, randomUUID } from 'node:crypto';

import { generateOpaqueToken, hashToken } from '@kadro/auth';
import { type TeamRole } from '@kadro/contracts';
import {
  type Database,
  districts,
  type MatchStatus,
  matches,
  matchRsvps,
  type RsvpStatus,
  refreshTokens,
  teamInvites,
  teamMembers,
  teams,
  users,
} from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { type RouteHandler } from '../../lib/server/http';
import { generateInviteCode, inviteCodeHash } from '../../lib/server/teams/invites';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { TEST_EDGE_PROXY } from '../support/env';
import { call, MOBILE, WEB } from '../support/http';
import { bootstrapJobQueues } from '../support/jobs';
import { installTestRuntime, type TestRuntime } from '../support/runtime';
import { GET as listTeamsRoute, POST as createTeamRoute } from '../../app/api/v1/teams/route';
import {
  DELETE as deleteTeamRoute,
  GET as getTeamRoute,
  PATCH as updateTeamRoute,
} from '../../app/api/v1/teams/[id]/route';
import {
  GET as listInvitesRoute,
  POST as createInviteRoute,
} from '../../app/api/v1/teams/[id]/invites/route';
import { DELETE as revokeInviteRoute } from '../../app/api/v1/teams/[id]/invites/[inviteId]/route';
import {
  DELETE as removeMemberRoute,
  PATCH as updateMemberRoute,
} from '../../app/api/v1/teams/[id]/members/[userId]/route';
import { GET as previewInviteRoute } from '../../app/api/v1/invites/[code]/route';
import { POST as acceptInviteRoute } from '../../app/api/v1/invites/[code]/accept/route';

/**
 * Shared fixtures of the team, invite and member suites: a migrated disposable database, the test
 * runtime (controlled clock, captured logs), accounts with live mobile sessions (as a login would
 * create them) and direct-insert team fixtures. All identifiers and credentials are generated at
 * run time.
 */

export const DAY_MS = 86_400_000;

export interface Account {
  readonly id: string;
  /** Mobile bearer headers with a per-account client address. */
  readonly headers: Record<string, string>;
  readonly ip: string;
}

export interface WebAccount extends Account {
  readonly cookie: string;
  readonly csrf: string;
}

export interface TeamsHarness {
  readonly database: TestDatabase;
  readonly db: Database;
  readonly harness: TestRuntime;
  readonly districtId: string;
  readonly otherDistrictId: string;
}

let ipCounter = 0;

/** A fresh client address per account, so suites do not share rate-limit buckets. */
export function uniqueIp(): string {
  ipCounter += 1;
  const third = Math.floor(ipCounter / 250) % 250;
  return `198.51.${third}.${(ipCounter % 250) + 1}`;
}

export function forwardedFor(ip: string): string {
  return `${ip}, ${TEST_EDGE_PROXY}`;
}

export async function setupTeamsHarness(prefix: string): Promise<TeamsHarness> {
  const migrated = await createMigratedDatabase(prefix);
  // Accepting an invite enqueues `team.member_joined` in its transaction (ADR-0028).
  await bootstrapJobQueues(migrated.url);
  const db = migrated.client.db;
  const harness = await installTestRuntime({ db, env: { DATABASE_URL: migrated.url } });
  const database: TestDatabase = {
    ...migrated,
    dispose: async () => {
      await harness.runtime.jobClient.close();
      await migrated.dispose();
    },
  };
  const inserted = await db
    .insert(districts)
    .values([
      {
        il: 'İstanbul',
        ilce: 'Kadıköy',
        ilSlug: 'istanbul',
        slug: 'kadikoy',
        centroid: { lng: 29.03, lat: 40.99 },
      },
      {
        il: 'İstanbul',
        ilce: 'Beşiktaş',
        ilSlug: 'istanbul',
        slug: 'besiktas',
        centroid: { lng: 29.0, lat: 41.04 },
      },
    ])
    .returning({ id: districts.id });
  return {
    database,
    db,
    harness,
    districtId: inserted[0]?.id ?? '',
    otherDistrictId: inserted[1]?.id ?? '',
  };
}

export interface AccountOptions {
  readonly verified?: boolean;
  readonly role?: 'user' | 'moderator' | 'admin';
  readonly displayName?: string;
}

async function insertUser(t: TeamsHarness, options: AccountOptions): Promise<string> {
  const [row] = await t.db
    .insert(users)
    .values({
      email: `oyuncu-${randomUUID()}@example.test`,
      displayName: options.displayName ?? `Oyuncu ${randomBytes(3).toString('hex')}`,
      emailVerifiedAt: options.verified === false ? null : new Date(),
      role: options.role ?? 'user',
    })
    .returning({ id: users.id });
  if (row === undefined) {
    throw new Error('user insert returned no row');
  }
  return row.id;
}

/** A user with a live mobile refresh family and an access token bound to it. */
export async function account(t: TeamsHarness, options: AccountOptions = {}): Promise<Account> {
  const id = await insertUser(t, options);
  const familyId = randomUUID();
  await t.db.insert(refreshTokens).values({
    tokenHash: hashToken(generateOpaqueToken()),
    userId: id,
    client: 'mobile',
    familyId,
    expiresAt: new Date(t.harness.runtime.now().getTime() + 30 * DAY_MS),
  });
  const issued = await t.harness.runtime.accessTokens.issue(
    { userId: id, sessionId: familyId },
    t.harness.runtime.now(),
  );
  const ip = uniqueIp();
  return {
    id,
    ip,
    headers: {
      ...MOBILE,
      authorization: `Bearer ${issued.token}`,
      'x-forwarded-for': forwardedFor(ip),
    },
  };
}

/** A user signed in on the web: session cookie plus CSRF cookie and header. */
export async function webAccount(
  t: TeamsHarness,
  options: AccountOptions = {},
): Promise<WebAccount> {
  const id = await insertUser(t, options);
  const token = generateOpaqueToken();
  const familyId = randomUUID();
  await t.db.insert(refreshTokens).values({
    tokenHash: hashToken(token),
    userId: id,
    client: 'web',
    familyId,
    expiresAt: new Date(t.harness.runtime.now().getTime() + 7 * DAY_MS),
  });
  const csrf = t.harness.runtime.csrf.issue(familyId);
  const cookie = `${t.harness.env.SESSION_COOKIE_NAME}=${token}; ${t.harness.env.CSRF_COOKIE_NAME}=${csrf}`;
  const ip = uniqueIp();
  return {
    id,
    ip,
    cookie,
    csrf,
    headers: { ...WEB, cookie, 'x-csrf-token': csrf, 'x-forwarded-for': forwardedFor(ip) },
  };
}

/** Anonymous mobile headers from a fresh client address. */
export function anonymous(ip = uniqueIp()): Record<string, string> {
  return { ...MOBILE, 'x-forwarded-for': forwardedFor(ip) };
}

// ---------------------------------------------------------------------------
// Direct-insert fixtures
// ---------------------------------------------------------------------------

export interface TeamFixture {
  readonly id: string;
  readonly captain: Account;
  readonly coCaptain: Account;
  readonly player: Account;
}

export async function insertTeam(
  t: TeamsHarness,
  ownerId: string,
  values: { name?: string; isProLocked?: boolean } = {},
): Promise<string> {
  const [team] = await t.db
    .insert(teams)
    .values({
      name: values.name ?? `Kadro ${randomBytes(3).toString('hex')}`,
      slug: `kadro-${randomBytes(6).toString('hex')}`,
      districtId: t.districtId,
      ownerId,
      isProLocked: values.isProLocked ?? false,
    })
    .returning({ id: teams.id });
  if (team === undefined) {
    throw new Error('team insert returned no row');
  }
  await addMember(t, team.id, ownerId, 'captain');
  return team.id;
}

export async function addMember(
  t: TeamsHarness,
  teamId: string,
  userId: string,
  role: TeamRole,
  joinedAt: Date = t.harness.runtime.now(),
): Promise<void> {
  await t.db.insert(teamMembers).values({ teamId, userId, role, joinedAt });
}

/** Team with a captain, a co-captain and a player (matrix §9.2 `capA`, `coA`, `plyA`). */
export async function teamFixture(
  t: TeamsHarness,
  values: { isProLocked?: boolean } = {},
): Promise<TeamFixture> {
  const captain = await account(t);
  const coCaptain = await account(t);
  const player = await account(t);
  const id = await insertTeam(t, captain.id, values);
  await addMember(t, id, coCaptain.id, 'co_captain');
  await addMember(t, id, player.id, 'player');
  return { id, captain, coCaptain, player };
}

export async function memberRole(
  t: TeamsHarness,
  teamId: string,
  userId: string,
): Promise<TeamRole | null> {
  const [row] = await t.db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return row?.role ?? null;
}

export async function teamRow(t: TeamsHarness, teamId: string) {
  const [row] = await t.db.select().from(teams).where(eq(teams.id, teamId));
  return row;
}

export interface InviteFixture {
  readonly id: string;
  readonly code: string;
}

/** Invite inserted directly (hash only, as the API stores it). */
export async function insertInvite(
  t: TeamsHarness,
  teamId: string,
  values: { maxUses?: number; uses?: number; expiresAt?: Date } = {},
): Promise<InviteFixture> {
  const code = generateInviteCode();
  const [row] = await t.db
    .insert(teamInvites)
    .values({
      teamId,
      codeHash: inviteCodeHash(code),
      maxUses: values.maxUses ?? 20,
      uses: values.uses ?? 0,
      expiresAt: values.expiresAt ?? new Date(t.harness.runtime.now().getTime() + DAY_MS),
    })
    .returning({ id: teamInvites.id });
  if (row === undefined) {
    throw new Error('invite insert returned no row');
  }
  return { id: row.id, code };
}

export async function insertMatch(
  t: TeamsHarness,
  teamId: string,
  status: MatchStatus,
  slots = 10,
): Promise<string> {
  const now = t.harness.runtime.now().getTime();
  const [row] = await t.db
    .insert(matches)
    .values({
      teamId,
      startsAt: new Date(status === 'played' ? now - DAY_MS : now + DAY_MS),
      format: '5v5',
      slots,
      status,
      lockedAt: status === 'locked' ? new Date(now) : null,
      venueText: 'Moda Halı Saha',
    })
    .returning({ id: matches.id });
  if (row === undefined) {
    throw new Error('match insert returned no row');
  }
  return row.id;
}

export async function insertRsvp(
  t: TeamsHarness,
  matchId: string,
  userId: string,
  status: RsvpStatus,
  waitlistedAt: Date | null = null,
): Promise<void> {
  await t.db.insert(matchRsvps).values({
    matchId,
    userId,
    status,
    waitlistedAt: status === 'waitlist' ? (waitlistedAt ?? new Date()) : null,
  });
}

export async function rsvpStatus(
  t: TeamsHarness,
  matchId: string,
  userId: string,
): Promise<RsvpStatus | null> {
  const [row] = await t.db
    .select({ status: matchRsvps.status })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, userId)));
  return row?.status ?? null;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RequestOptions {
  readonly headers: Record<string, string>;
  readonly params?: Record<string, string>;
  readonly query?: Record<string, string>;
  readonly json?: unknown;
}

function request(
  handler: RouteHandler,
  method: string,
  pattern: string,
  options: RequestOptions,
): Promise<Response> {
  let pathname = pattern;
  for (const [name, value] of Object.entries(options.params ?? {})) {
    pathname = pathname.replace(`[${name}]`, encodeURIComponent(value));
  }
  const search = new URLSearchParams(options.query ?? {}).toString();
  return call(handler, {
    method,
    path: search === '' ? pathname : `${pathname}?${search}`,
    headers: options.headers,
    ...(options.json === undefined ? {} : { json: options.json }),
    ...(options.params === undefined ? {} : { params: options.params }),
  });
}

export const api = {
  listTeams: (headers: Record<string, string>, query: Record<string, string> = {}) =>
    request(listTeamsRoute, 'GET', '/api/v1/teams', { headers, query }),
  createTeam: (headers: Record<string, string>, json: unknown) =>
    request(createTeamRoute, 'POST', '/api/v1/teams', { headers, json }),
  getTeam: (headers: Record<string, string>, id: string) =>
    request(getTeamRoute, 'GET', '/api/v1/teams/[id]', { headers, params: { id } }),
  updateTeam: (headers: Record<string, string>, id: string, json: unknown) =>
    request(updateTeamRoute, 'PATCH', '/api/v1/teams/[id]', { headers, params: { id }, json }),
  deleteTeam: (headers: Record<string, string>, id: string) =>
    request(deleteTeamRoute, 'DELETE', '/api/v1/teams/[id]', { headers, params: { id } }),
  createInvite: (headers: Record<string, string>, id: string, json: unknown = {}) =>
    request(createInviteRoute, 'POST', '/api/v1/teams/[id]/invites', {
      headers,
      params: { id },
      json,
    }),
  listInvites: (headers: Record<string, string>, id: string, query: Record<string, string> = {}) =>
    request(listInvitesRoute, 'GET', '/api/v1/teams/[id]/invites', {
      headers,
      params: { id },
      query,
    }),
  revokeInvite: (headers: Record<string, string>, id: string, inviteId: string) =>
    request(revokeInviteRoute, 'DELETE', '/api/v1/teams/[id]/invites/[inviteId]', {
      headers,
      params: { id, inviteId },
    }),
  previewInvite: (headers: Record<string, string>, code: string) =>
    request(previewInviteRoute, 'GET', '/api/v1/invites/[code]', { headers, params: { code } }),
  acceptInvite: (headers: Record<string, string>, code: string, json: unknown = {}) =>
    request(acceptInviteRoute, 'POST', '/api/v1/invites/[code]/accept', {
      headers,
      params: { code },
      json,
    }),
  updateMember: (headers: Record<string, string>, id: string, userId: string, json: unknown) =>
    request(updateMemberRoute, 'PATCH', '/api/v1/teams/[id]/members/[userId]', {
      headers,
      params: { id, userId },
      json,
    }),
  removeMember: (headers: Record<string, string>, id: string, userId: string) =>
    request(removeMemberRoute, 'DELETE', '/api/v1/teams/[id]/members/[userId]', {
      headers,
      params: { id, userId },
    }),
};

/** Reads a JSON success body after asserting its status (the body text is the failure message). */
export async function expectJson<T = unknown>(response: Response, status: number): Promise<T> {
  const text = await response.text();
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}
