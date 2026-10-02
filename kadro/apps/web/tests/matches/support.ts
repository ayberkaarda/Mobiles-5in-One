import { randomBytes } from 'node:crypto';

import { type JobQueue, type TeamRole } from '@kadro/contracts';
import {
  auditLogs,
  districts,
  type LineupSide,
  type MatchStatus,
  matches,
  matchRsvps,
  mvpVotes,
  openCallApplications,
  openCalls,
  type RsvpStatus,
  venues,
} from '@kadro/db';
import { and, asc, eq } from 'drizzle-orm';
import pg from 'pg';

import { type RouteHandler } from '../../lib/server/http';
import { type JobsHarness, setupJobsHarness } from '../jobs/support';
import { call } from '../support/http';
import { type StoredJob, storedJobs } from '../support/jobs';
import {
  type Account,
  account,
  addMember,
  DAY_MS,
  insertTeam,
  type TeamsHarness,
} from '../teams/support';
import {
  GET as listMatchesRoute,
  POST as createMatchRoute,
} from '../../app/api/v1/teams/[id]/matches/route';
import {
  DELETE as deleteMatchRoute,
  GET as getMatchRoute,
  PATCH as updateMatchRoute,
} from '../../app/api/v1/matches/[id]/route';
import { PUT as rsvpRoute } from '../../app/api/v1/matches/[id]/rsvp/route';
import { PUT as lineupRoute } from '../../app/api/v1/matches/[id]/lineup/route';
import { PATCH as paymentRoute } from '../../app/api/v1/matches/[id]/payments/[userId]/route';
import { POST as mvpRoute } from '../../app/api/v1/matches/[id]/mvp-vote/route';

/**
 * Shared fixtures of the match suites: a migrated disposable database with the worker's queues,
 * a domain client that runs as the `kadro_app` role (so grants, the append-only audit table and
 * the job table behave as in production), the team fixtures of the teams suites and direct-insert
 * match fixtures. Identifiers and credentials are generated at run time.
 */

export { DAY_MS };
export const HOUR_MS = 3_600_000;

export interface MatchesHarness extends TeamsHarness {
  readonly jobs: JobsHarness;
  /** Superuser URL of the test database (job reads, grant changes). */
  readonly adminUrl: string;
  dispose(): Promise<void>;
}

export async function setupMatchesHarness(prefix: string): Promise<MatchesHarness> {
  const jobs = await setupJobsHarness(prefix);
  const db = jobs.app.db;
  const inserted = await db
    .insert(districts)
    .values([
      {
        il: 'Ankara',
        ilce: 'Çankaya',
        ilSlug: 'ankara',
        slug: 'cankaya',
        centroid: { lng: 32.86, lat: 39.9 },
      },
      {
        il: 'Ankara',
        ilce: 'Keçiören',
        ilSlug: 'ankara',
        slug: 'kecioren',
        centroid: { lng: 32.86, lat: 39.98 },
      },
    ])
    .returning({ id: districts.id });
  return {
    database: jobs.database,
    db,
    harness: jobs.harness,
    districtId: inserted[0]?.id ?? '',
    otherDistrictId: inserted[1]?.id ?? '',
    jobs,
    adminUrl: jobs.database.url,
    dispose: () => jobs.dispose(),
  };
}

/** Runs SQL as the superuser of the test database (grant changes in rollback tests). */
export async function asAdmin(t: MatchesHarness, statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: t.adminUrl });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface MatchOptions {
  readonly status?: MatchStatus;
  readonly slots?: number;
  readonly feeTotalMinor?: number;
  readonly startsAt?: Date;
  readonly lockedAt?: Date | null;
  readonly mvpVoteClosesAt?: Date | null;
  readonly venueId?: string | null;
}

export async function insertMatchRow(
  t: MatchesHarness,
  teamId: string,
  options: MatchOptions = {},
): Promise<string> {
  const now = t.harness.runtime.now().getTime();
  const status = options.status ?? 'open';
  const startsAt =
    options.startsAt ?? new Date(status === 'played' ? now - 2 * HOUR_MS : now + 3 * DAY_MS);
  const [row] = await t.db
    .insert(matches)
    .values({
      teamId,
      startsAt,
      format: '7v7',
      slots: options.slots ?? 10,
      feeTotalMinor: options.feeTotalMinor ?? 140_000,
      status,
      lockedAt:
        options.lockedAt !== undefined
          ? options.lockedAt
          : status === 'locked' || status === 'played'
            ? new Date(now - DAY_MS)
            : null,
      mvpVoteClosesAt:
        options.mvpVoteClosesAt !== undefined
          ? options.mvpVoteClosesAt
          : status === 'played'
            ? new Date(now + 20 * HOUR_MS)
            : null,
      venueId: options.venueId ?? null,
      venueText: options.venueId ? null : 'Çankaya Halı Saha',
    })
    .returning({ id: matches.id });
  if (row === undefined) {
    throw new Error('match insert returned no row');
  }
  return row.id;
}

export interface RsvpOptions {
  readonly side?: LineupSide | null;
  readonly paid?: boolean;
  readonly waitlistedAt?: Date;
}

export async function insertRsvp(
  t: MatchesHarness,
  matchId: string,
  userId: string,
  status: RsvpStatus,
  options: RsvpOptions = {},
): Promise<string> {
  const [row] = await t.db
    .insert(matchRsvps)
    .values({
      matchId,
      userId,
      status,
      side: options.side ?? null,
      paid: options.paid ?? false,
      waitlistedAt: status === 'waitlist' ? (options.waitlistedAt ?? new Date()) : null,
    })
    .returning({ id: matchRsvps.id });
  if (row === undefined) {
    throw new Error('rsvp insert returned no row');
  }
  return row.id;
}

/**
 * A free player accepted through an open call (matrix §1.3 `guest(M)`, ADR-0003): an accepted
 * application on a call of the match plus an RSVP.
 */
export async function insertGuest(
  t: MatchesHarness,
  matchId: string,
  status: RsvpStatus = 'in',
  options: RsvpOptions = {},
): Promise<Account> {
  const guest = await account(t);
  const [call] = await t.db
    .insert(openCalls)
    .values({
      matchId,
      missingCount: 1,
      level: 'regular',
      districtId: t.districtId,
      status: 'closed',
      expiresAt: new Date(t.harness.runtime.now().getTime() + DAY_MS),
    })
    .returning({ id: openCalls.id });
  if (call === undefined) {
    throw new Error('open call insert returned no row');
  }
  await t.db
    .insert(openCallApplications)
    .values({ openCallId: call.id, userId: guest.id, status: 'accepted' });
  await insertRsvp(t, matchId, guest.id, status, options);
  return guest;
}

export interface MatchWorld {
  readonly teamId: string;
  readonly matchId: string;
  readonly captain: Account;
  readonly coCaptain: Account;
  readonly player: Account;
  readonly guest: Account;
  /** Verified user without any relationship to the team or match. */
  readonly outsider: Account;
  /** Moderator without a relationship (no staff override, ADR-0007). */
  readonly moderator: Account;
  /** Moderator who is a player of the team (matrix §9.2 `modPlyA`). */
  readonly modPlayer: Account;
}

export type Actor = 'anon' | Exclude<keyof MatchWorld, 'teamId' | 'matchId'>;

/**
 * Team with captain, co-captain, player and a moderator-player, one match, and a guest of it.
 * Captain, co-captain and player hold `in` RSVPs; the guest holds `guestStatus`.
 */
export async function matchWorld(
  t: MatchesHarness,
  options: MatchOptions & {
    readonly isProLocked?: boolean;
    readonly guestStatus?: RsvpStatus;
  } = {},
): Promise<MatchWorld> {
  const captain = await account(t);
  const coCaptain = await account(t);
  const player = await account(t);
  const modPlayer = await account(t, { role: 'moderator' });
  const outsider = await account(t);
  const moderator = await account(t, { role: 'moderator' });
  const teamId = await insertTeam(t, captain.id, { isProLocked: options.isProLocked ?? false });
  await addMember(t, teamId, coCaptain.id, 'co_captain');
  await addMember(t, teamId, player.id, 'player');
  await addMember(t, teamId, modPlayer.id, 'player');
  const matchId = await insertMatchRow(t, teamId, options);
  for (const member of [captain, coCaptain, player]) {
    await insertRsvp(t, matchId, member.id, 'in');
  }
  const guest = await insertGuest(t, matchId, options.guestStatus ?? 'in');
  return { teamId, matchId, captain, coCaptain, player, guest, outsider, moderator, modPlayer };
}

export function headersOf(world: MatchWorld, actor: Actor): Record<string, string> {
  if (actor === 'anon') {
    return { 'x-kadro-client': 'mobile' };
  }
  // eslint-disable-next-line security/detect-object-injection -- actor is a typed MatchWorld key
  return world[actor].headers;
}

export async function addPlayer(
  t: MatchesHarness,
  teamId: string,
  role: TeamRole = 'player',
): Promise<Account> {
  const member = await account(t);
  await addMember(t, teamId, member.id, role);
  return member;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function matchRow(t: MatchesHarness, matchId: string) {
  const [row] = await t.db.select().from(matches).where(eq(matches.id, matchId));
  return row;
}

export async function rsvpRow(t: MatchesHarness, matchId: string, userId: string) {
  const [row] = await t.db
    .select()
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, userId)));
  return row;
}

export async function rsvpStatuses(
  t: MatchesHarness,
  matchId: string,
): Promise<Map<string, RsvpStatus>> {
  const rows = await t.db
    .select({ userId: matchRsvps.userId, status: matchRsvps.status })
    .from(matchRsvps)
    .where(eq(matchRsvps.matchId, matchId))
    .orderBy(asc(matchRsvps.createdAt));
  return new Map(rows.map((row) => [row.userId, row.status]));
}

export async function confirmedIds(t: MatchesHarness, matchId: string): Promise<string[]> {
  const rows = await t.db
    .select({ userId: matchRsvps.userId })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.status, 'in')));
  return rows.map((row) => row.userId).sort();
}

export async function auditRows(t: MatchesHarness, targetId: string) {
  return t.db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.targetId, targetId))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
}

export async function voteRows(t: MatchesHarness, matchId: string) {
  return t.db.select().from(mvpVotes).where(eq(mvpVotes.matchId, matchId));
}

/** Jobs of `queue` that concern `refId` (match id for match pushes and reminders). */
export async function jobsFor(
  t: MatchesHarness,
  queue: JobQueue,
  refId: string,
): Promise<StoredJob[]> {
  const jobs = await storedJobs(t.adminUrl, queue);
  return jobs.filter((job) => job.data.refId === refId || job.data.matchId === refId);
}

export async function insertVenue(
  t: MatchesHarness,
  values: { verified?: boolean; createdBy?: string | null } = {},
): Promise<{ id: string; slug: string; name: string }> {
  const suffix = randomBytes(4).toString('hex');
  const name = `Saha ${suffix}`;
  const [row] = await t.db
    .insert(venues)
    .values({
      name,
      slug: `saha-${suffix}`,
      searchName: `saha ${suffix}`,
      districtId: t.districtId,
      point: { lng: 32.85, lat: 39.92 },
      verified: values.verified ?? true,
      createdBy: values.createdBy ?? null,
    })
    .returning({ id: venues.id, slug: venues.slug, name: venues.name });
  if (row === undefined) {
    throw new Error('venue insert returned no row');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

function send(
  handler: RouteHandler,
  method: string,
  pattern: string,
  headers: Record<string, string>,
  params: Record<string, string>,
  json?: unknown,
  query: Record<string, string> = {},
): Promise<Response> {
  let pathname = pattern;
  for (const [name, value] of Object.entries(params)) {
    pathname = pathname.replace(`[${name}]`, encodeURIComponent(value));
  }
  const search = new URLSearchParams(query).toString();
  return call(handler, {
    method,
    path: search === '' ? pathname : `${pathname}?${search}`,
    headers,
    params,
    ...(json === undefined ? {} : { json }),
  });
}

type Headers = Record<string, string>;

export const matchApi = {
  list: (headers: Headers, teamId: string, query: Record<string, string> = {}) =>
    send(
      listMatchesRoute,
      'GET',
      '/api/v1/teams/[id]/matches',
      headers,
      { id: teamId },
      undefined,
      query,
    ),
  create: (headers: Headers, teamId: string, json: unknown) =>
    send(createMatchRoute, 'POST', '/api/v1/teams/[id]/matches', headers, { id: teamId }, json),
  get: (headers: Headers, matchId: string) =>
    send(getMatchRoute, 'GET', '/api/v1/matches/[id]', headers, { id: matchId }),
  update: (headers: Headers, matchId: string, json: unknown) =>
    send(updateMatchRoute, 'PATCH', '/api/v1/matches/[id]', headers, { id: matchId }, json),
  remove: (headers: Headers, matchId: string) =>
    send(deleteMatchRoute, 'DELETE', '/api/v1/matches/[id]', headers, { id: matchId }),
  rsvp: (headers: Headers, matchId: string, status: string) =>
    send(rsvpRoute, 'PUT', '/api/v1/matches/[id]/rsvp', headers, { id: matchId }, { status }),
  rsvpBody: (headers: Headers, matchId: string, json: unknown) =>
    send(rsvpRoute, 'PUT', '/api/v1/matches/[id]/rsvp', headers, { id: matchId }, json),
  lineup: (headers: Headers, matchId: string, json: unknown) =>
    send(lineupRoute, 'PUT', '/api/v1/matches/[id]/lineup', headers, { id: matchId }, json),
  pay: (headers: Headers, matchId: string, userId: string, json: unknown) =>
    send(
      paymentRoute,
      'PATCH',
      '/api/v1/matches/[id]/payments/[userId]',
      headers,
      { id: matchId, userId },
      json,
    ),
  vote: (headers: Headers, matchId: string, json: unknown) =>
    send(mvpRoute, 'POST', '/api/v1/matches/[id]/mvp-vote', headers, { id: matchId }, json),
};

/** Reads a JSON success body after asserting its status (the body text is the failure message). */
export async function expectJson<T = unknown>(response: Response, status: number): Promise<T> {
  const text = await response.text();
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

/** A future start time `days` ahead of the harness clock, as an ISO string. */
export function inDays(t: MatchesHarness, days: number): string {
  return new Date(t.harness.runtime.now().getTime() + days * DAY_MS).toISOString();
}
