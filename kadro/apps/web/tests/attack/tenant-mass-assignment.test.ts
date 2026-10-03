import { randomBytes } from 'node:crypto';

import { ENDPOINTS } from '@kadro/contracts';
import {
  matches,
  matchRsvps,
  mvpVotes,
  newId,
  openCallApplications,
  openCalls,
  pushTokens,
  refreshTokens,
  subscriptions,
  teamInvites,
  teamMembers,
  teams,
  uploads,
  users,
  venueReviews,
  venues,
} from '@kadro/db';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { json, route, type RouteHandler } from '../../lib/server/http';
import { newPassword, uniqueEmail } from '../auth/support';
import { call } from '../support/http';
import {
  account,
  addMember,
  anonymous,
  insertTeam,
  setupTeamsHarness,
  type TeamsHarness,
} from '../teams/support';
import { type LoadedRoute, loadRoutes } from './support';

/**
 * Mass-assignment attack suite (authorization matrix §4: "every write schema is `.strict()`;
 * fields not listed as writable are rejected with 400, not silently dropped").
 *
 * Part 1 walks every params, query and body schema of the endpoint registry and reports each
 * object node, at any depth, that does not reject unknown keys (zod 4 `catchall` other than
 * `never`). `route()` already refuses a non-strict top level; this sweep also covers nested
 * objects, unions, arrays, pipes and wrappers.
 *
 * Part 2 drives the shipped Route Handlers against the database as a legitimate actor: for each
 * write route the actor sends a body that is valid on its own plus one server-owned field at a
 * time (`role`, `isPro`, `userId`, `status`, `teamId`, `createdBy`, `entitlements`, `stepUpUntil`
 * and route-specific ones such as `ownerId`, `verified`, `lockedAt`). Each attempt must answer
 * 400 `validation_failed` and a database read must show the targeted rows unchanged. The same
 * body without the extra field is then sent as a control and must answer the route's success
 * status and change the rows, which proves the base body is valid and the database read observes
 * the write path (so a 400 is caused by the extra field, not by a broken fixture).
 *
 * Negative controls feed both parts a deliberately permissive schema / handler and require that
 * the checks flag it.
 */

let t: TeamsHarness;
let routes: Map<string, LoadedRoute>;

const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Part 1: structural strictness of every registered schema
// ---------------------------------------------------------------------------

interface ZodInternals {
  readonly _zod?: { readonly def: Record<string, unknown> & { readonly type: string } };
}

function defOf(schema: unknown): (Record<string, unknown> & { type: string }) | undefined {
  return (schema as ZodInternals | undefined)?._zod?.def;
}

/** Paths of object nodes that accept unknown keys (strip or passthrough), at any depth. */
function nonStrictNodes(schema: unknown, at = '$', seen = new Set<unknown>()): string[] {
  const def = defOf(schema);
  if (def === undefined || seen.has(schema)) {
    return [];
  }
  seen.add(schema);
  const walk = (child: unknown, path: string): string[] => nonStrictNodes(child, path, seen);
  switch (def.type) {
    case 'object': {
      const catchall = defOf(def.catchall);
      const own =
        catchall?.type === 'never' ? [] : [`${at} (catchall: ${catchall?.type ?? 'strip'})`];
      const shape = def.shape as Record<string, unknown>;
      return [
        ...own,
        ...Object.entries(shape).flatMap(([name, child]) => walk(child, `${at}.${name}`)),
      ];
    }
    case 'union':
      return (def.options as unknown[]).flatMap((option, index) => walk(option, `${at}|${index}`));
    case 'intersection':
      return [...walk(def.left, `${at}&L`), ...walk(def.right, `${at}&R`)];
    case 'pipe':
      return [...walk(def.in, at), ...walk(def.out, at)];
    case 'array':
      return walk(def.element, `${at}[]`);
    case 'tuple':
      return [
        ...(def.items as unknown[]).flatMap((item, index) => walk(item, `${at}[${index}]`)),
        ...walk(def.rest, `${at}[...]`),
      ];
    case 'record':
      return walk(def.valueType, `${at}{}`);
    case 'lazy':
      return walk((def.getter as () => unknown)(), at);
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
    case 'success':
      return walk(def.innerType, at);
    default:
      return [];
  }
}

/**
 * Nested objects that intentionally accept unknown keys. The RevenueCat event is a third-party
 * payload authenticated by the shared secret only (matrix §3.7 footnote 25); its unknown fields
 * are never written to a row, so it is the one documented exception.
 */
const LOOSE_BY_DESIGN: Readonly<Record<string, string>> = {
  'POST /api/v1/webhooks/revenuecat body $.event (catchall: unknown)':
    'third-party webhook event; unknown fields are never stored (packages/contracts billing.ts)',
};

function registryOffenders(): string[] {
  const offenders: string[] = [];
  for (const { key, spec } of routes.values()) {
    const parts: [string, unknown][] = [
      ['params', spec.params],
      ['query', spec.query],
      ...spec.bodies.map((body): [string, unknown] => ['body', body]),
    ];
    for (const [where, schema] of parts) {
      for (const node of nonStrictNodes(schema)) {
        const finding = `${key} ${where} ${node}`;
        if (LOOSE_BY_DESIGN[finding] === undefined) {
          offenders.push(finding);
        }
      }
    }
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// Part 2: runtime attempts against the shipped handlers
// ---------------------------------------------------------------------------

/** Server-owned fields every write route is probed with (unless the field is writable there). */
function commonExtras(otherUserId: string, otherTeamId: string): Record<string, unknown> {
  return {
    role: 'admin',
    isPro: true,
    userId: otherUserId,
    status: 'accepted',
    teamId: otherTeamId,
    createdBy: otherUserId,
    entitlements: { pro: true, teamsUnlimited: true },
    stepUpUntil: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
  };
}

interface Prepared {
  readonly headers: () => Record<string, string>;
  readonly params?: Record<string, string>;
  /** A body that is valid on its own; called once per attempt. */
  readonly base: () => Record<string, unknown>;
  /** Rows the attack targets, read back from the database. */
  readonly snapshot: () => Promise<unknown>;
}

interface MassCase {
  readonly key: string;
  readonly actor: string;
  readonly prepare: (other: { userId: string; teamId: string }) => Promise<Prepared>;
  readonly specificExtras: Record<string, unknown>;
  readonly control: { readonly status: number; readonly changesRows: boolean };
}

interface MassOutcome {
  readonly tested: readonly string[];
  readonly problems: readonly string[];
  readonly controlStatus: number;
  readonly controlBody: string;
  readonly controlChangedRows: boolean;
}

function pathFor(key: string, params: Record<string, string> = {}): string {
  let pathname = key.split(' ')[1] ?? '';
  for (const [name, value] of Object.entries(params)) {
    pathname = pathname.replace(`[${name}]`, encodeURIComponent(value));
  }
  return pathname;
}

function writableKeys(key: string): Set<string> {
  const body = routes.get(key)?.spec.bodies[0] as { shape?: Record<string, unknown> } | undefined;
  return new Set(Object.keys(body?.shape ?? {}));
}

/**
 * Sends every extra field once on top of the valid base body, then the control. Returns the
 * problems found (empty = mass assignment is refused and nothing changed). Shared by the real
 * cases and the negative control.
 */
async function attack(
  handler: RouteHandler,
  testCase: MassCase,
  writable: ReadonlySet<string>,
): Promise<MassOutcome> {
  const otherUser = await account(t);
  const otherTeamId = await insertTeam(t, otherUser.id);
  const prepared = await testCase.prepare({ userId: otherUser.id, teamId: otherTeamId });
  const [method] = testCase.key.split(' ') as [string];
  const extras = {
    ...commonExtras(otherUser.id, otherTeamId),
    ...testCase.specificExtras,
  };
  const tested = Object.keys(extras).filter((field) => !writable.has(field));
  const problems: string[] = [];
  const send = (body: Record<string, unknown>) =>
    call(handler, {
      method,
      path: pathFor(testCase.key, prepared.params),
      headers: prepared.headers(),
      params: prepared.params ?? {},
      json: body,
    });

  const before = await prepared.snapshot();
  for (const field of tested) {
    const response = await send({ ...prepared.base(), [field]: extras[field] });
    const text = await response.text();
    let code: unknown;
    try {
      code = (JSON.parse(text) as { code?: unknown }).code;
    } catch {
      code = '<non-json>';
    }
    if (response.status !== 400 || code !== 'validation_failed') {
      problems.push(`extra "${field}" answered ${response.status} ${String(code)}`);
    }
    const after = await prepared.snapshot();
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      problems.push(`extra "${field}" changed the database`);
    }
  }

  const control = await send(prepared.base());
  const controlBody = await control.text();
  const afterControl = await prepared.snapshot();
  return {
    tested,
    problems,
    controlStatus: control.status,
    controlBody,
    controlChangedRows: JSON.stringify(afterControl) !== JSON.stringify(before),
  };
}

function marker(prefix: string): string {
  return `${prefix} ${randomBytes(4).toString('hex')}`;
}

async function insertMatchRow(
  teamId: string,
  status: 'open' | 'locked' | 'played',
): Promise<string> {
  const now = t.harness.runtime.now().getTime();
  const [row] = await t.db
    .insert(matches)
    .values({
      teamId,
      startsAt: new Date(status === 'played' ? now - 2 * HOUR_MS : now + 48 * HOUR_MS),
      format: '5v5',
      slots: 10,
      feeTotalMinor: 50_000,
      status,
      lockedAt: status === 'open' ? null : new Date(now - 24 * HOUR_MS),
      mvpVoteClosesAt: status === 'played' ? new Date(now + 20 * HOUR_MS) : null,
      venueText: 'Moda Hali Saha',
    })
    .returning({ id: matches.id });
  if (row === undefined) {
    throw new Error('match insert returned no row');
  }
  return row.id;
}

async function insertCall(matchId: string): Promise<string> {
  const [row] = await t.db
    .insert(openCalls)
    .values({
      matchId,
      missingCount: 2,
      level: 'regular',
      districtId: t.districtId,
      expiresAt: new Date(t.harness.runtime.now().getTime() + 24 * HOUR_MS),
    })
    .returning({ id: openCalls.id });
  if (row === undefined) {
    throw new Error('open call insert returned no row');
  }
  return row.id;
}

/** Wall-clock timestamp for extras built at module load (before the harness exists). */
function wallClock(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function future(ms: number): string {
  return new Date(t.harness.runtime.now().getTime() + ms).toISOString();
}

const CASES: readonly MassCase[] = [
  {
    key: 'PATCH /api/v1/me',
    actor: 'self',
    specificExtras: {
      id: newId(),
      email: 'baskasi@example.test',
      emailVerifiedAt: null,
      avatarKey: 'avatars/someone/else.webp',
      deactivatedAt: null,
      isTombstone: true,
    },
    control: { status: 200, changesRows: true },
    prepare: async () => {
      const self = await account(t);
      const name = marker('Yeni Isim');
      return {
        headers: () => self.headers,
        base: () => ({ displayName: name }),
        snapshot: async () => ({
          user: await t.db.select().from(users).where(eq(users.id, self.id)),
          sessions: await t.db
            .select({ stepUpUntil: refreshTokens.stepUpUntil, revokedAt: refreshTokens.revokedAt })
            .from(refreshTokens)
            .where(eq(refreshTokens.userId, self.id)),
          subscriptions: await t.db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, self.id)),
        }),
      };
    },
  },
  {
    key: 'POST /api/v1/auth/register',
    actor: 'anonymous',
    specificExtras: { emailVerifiedAt: new Date().toISOString(), isTombstone: false, id: newId() },
    control: { status: 202, changesRows: true },
    prepare: async () => {
      const displayName = marker('Kayit');
      return {
        headers: () => anonymous(),
        base: () => ({ email: uniqueEmail(), password: newPassword(), displayName }),
        snapshot: async () =>
          t.db
            .select({ id: users.id, role: users.role, verified: users.emailVerifiedAt })
            .from(users)
            .where(eq(users.displayName, displayName)),
      };
    },
  },
  {
    key: 'POST /api/v1/teams',
    actor: 'verified user',
    specificExtras: {
      ownerId: newId(),
      slug: 'ele-gecirilmis-slug',
      isProLocked: false,
      badgeKey: 'badges/x/y.webp',
      id: newId(),
    },
    control: { status: 201, changesRows: true },
    prepare: async () => {
      const actor = await account(t);
      const name = marker('Takim');
      return {
        headers: () => actor.headers,
        base: () => ({ name, districtId: t.districtId }),
        snapshot: async () => ({
          teams: await t.db.select().from(teams).where(eq(teams.name, name)),
          memberships: await t.db
            .select()
            .from(teamMembers)
            .where(eq(teamMembers.userId, actor.id)),
        }),
      };
    },
  },
  {
    key: 'PATCH /api/v1/teams/[id]',
    actor: 'captain',
    specificExtras: {
      ownerId: newId(),
      slug: 'ele-gecirilmis-slug',
      isProLocked: true,
      badgeKey: 'badges/x/y.webp',
      id: newId(),
    },
    control: { status: 200, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const teamId = await insertTeam(t, captain.id);
      const name = marker('Yeni Takim Adi');
      return {
        headers: () => captain.headers,
        params: { id: teamId },
        base: () => ({ name }),
        snapshot: async () => ({
          team: await t.db.select().from(teams).where(eq(teams.id, teamId)),
          members: await t.db
            .select()
            .from(teamMembers)
            .where(eq(teamMembers.teamId, teamId))
            .orderBy(asc(teamMembers.userId)),
        }),
      };
    },
  },
  {
    key: 'PATCH /api/v1/teams/[id]/members/[userId]',
    actor: 'captain',
    specificExtras: { joinedAt: new Date(0).toISOString(), id: newId() },
    control: { status: 200, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const player = await account(t);
      const teamId = await insertTeam(t, captain.id);
      await addMember(t, teamId, player.id, 'player');
      return {
        headers: () => captain.headers,
        params: { id: teamId, userId: player.id },
        base: () => ({ role: 'co_captain' }),
        snapshot: async () =>
          t.db
            .select()
            .from(teamMembers)
            .where(eq(teamMembers.teamId, teamId))
            .orderBy(asc(teamMembers.userId)),
      };
    },
  },
  {
    key: 'POST /api/v1/teams/[id]/invites',
    actor: 'co-captain',
    specificExtras: {
      uses: 0,
      codeHash: 'kendi-hash-degeri',
      code: 'kendi-kodu',
      expiresAt: wallClock(HOUR_MS),
    },
    control: { status: 201, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const coCaptain = await account(t);
      const teamId = await insertTeam(t, captain.id);
      await addMember(t, teamId, coCaptain.id, 'co_captain');
      return {
        headers: () => coCaptain.headers,
        params: { id: teamId },
        base: () => ({ maxUses: 5 }),
        snapshot: async () => t.db.select().from(teamInvites).where(eq(teamInvites.teamId, teamId)),
      };
    },
  },
  {
    key: 'POST /api/v1/teams/[id]/matches',
    actor: 'captain',
    specificExtras: {
      lockedAt: wallClock(0),
      mvpVoteClosesAt: wallClock(HOUR_MS),
      id: newId(),
    },
    control: { status: 201, changesRows: true },
    prepare: async ({ teamId: otherTeamId }) => {
      const captain = await account(t);
      const teamId = await insertTeam(t, captain.id);
      const startsAt = future(72 * HOUR_MS);
      return {
        headers: () => captain.headers,
        params: { id: teamId },
        base: () => ({
          venueText: 'Moda Hali Saha',
          startsAt,
          format: '5v5',
          feeTotalMinor: 0,
          slots: 10,
        }),
        snapshot: async () => ({
          own: await t.db.select().from(matches).where(eq(matches.teamId, teamId)),
          other: await t.db.select().from(matches).where(eq(matches.teamId, otherTeamId)),
        }),
      };
    },
  },
  {
    key: 'PATCH /api/v1/matches/[id]',
    actor: 'captain',
    specificExtras: {
      lockedAt: wallClock(0),
      mvpVoteClosesAt: wallClock(HOUR_MS),
      matchId: newId(),
    },
    control: { status: 200, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const teamId = await insertTeam(t, captain.id);
      const matchId = await insertMatchRow(teamId, 'open');
      const venueText = marker('Yeni Saha');
      return {
        headers: () => captain.headers,
        params: { id: matchId },
        base: () => ({ venueText }),
        snapshot: async () => t.db.select().from(matches).where(eq(matches.id, matchId)),
      };
    },
  },
  {
    key: 'PUT /api/v1/matches/[id]/rsvp',
    actor: 'player',
    specificExtras: { paid: true, side: 'A', waitlistedAt: null, matchId: newId() },
    control: { status: 200, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const player = await account(t);
      const teamId = await insertTeam(t, captain.id);
      await addMember(t, teamId, player.id, 'player');
      const matchId = await insertMatchRow(teamId, 'open');
      return {
        headers: () => player.headers,
        params: { id: matchId },
        base: () => ({ status: 'in' }),
        snapshot: async () => t.db.select().from(matchRsvps).where(eq(matchRsvps.matchId, matchId)),
      };
    },
  },
  {
    key: 'PATCH /api/v1/matches/[id]/payments/[userId]',
    actor: 'captain',
    specificExtras: { matchId: newId(), side: 'B', amountMinor: 0 },
    control: { status: 200, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const player = await account(t);
      const teamId = await insertTeam(t, captain.id);
      await addMember(t, teamId, player.id, 'player');
      const matchId = await insertMatchRow(teamId, 'locked');
      await t.db.insert(matchRsvps).values({ matchId, userId: player.id, status: 'in' });
      return {
        headers: () => captain.headers,
        params: { id: matchId, userId: player.id },
        base: () => ({ paid: true }),
        snapshot: async () => t.db.select().from(matchRsvps).where(eq(matchRsvps.matchId, matchId)),
      };
    },
  },
  {
    key: 'POST /api/v1/matches/[id]/mvp-vote',
    actor: 'player',
    specificExtras: { voterId: newId(), matchId: newId() },
    control: { status: 201, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const player = await account(t);
      const teamId = await insertTeam(t, captain.id);
      await addMember(t, teamId, player.id, 'player');
      const matchId = await insertMatchRow(teamId, 'played');
      for (const userId of [captain.id, player.id]) {
        await t.db.insert(matchRsvps).values({ matchId, userId, status: 'in' });
      }
      return {
        headers: () => player.headers,
        params: { id: matchId },
        base: () => ({ voteeId: captain.id }),
        snapshot: async () => t.db.select().from(mvpVotes).where(eq(mvpVotes.matchId, matchId)),
      };
    },
  },
  {
    key: 'POST /api/v1/matches/[id]/open-call',
    actor: 'captain',
    specificExtras: { matchId: newId(), id: newId() },
    control: { status: 201, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const teamId = await insertTeam(t, captain.id);
      const matchId = await insertMatchRow(teamId, 'open');
      const expiresAt = future(HOUR_MS);
      return {
        headers: () => captain.headers,
        params: { id: matchId },
        base: () => ({ missingCount: 1, position: null, level: 'casual', expiresAt }),
        snapshot: async () => t.db.select().from(openCalls).where(eq(openCalls.matchId, matchId)),
      };
    },
  },
  {
    key: 'POST /api/v1/open-calls/[id]/applications',
    actor: 'verified user from another team',
    specificExtras: { openCallId: newId(), id: newId() },
    control: { status: 201, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const applicant = await account(t);
      const teamId = await insertTeam(t, captain.id);
      const callId = await insertCall(await insertMatchRow(teamId, 'open'));
      return {
        headers: () => applicant.headers,
        params: { id: callId },
        base: () => ({ message: 'Kaleci olarak gelebilirim' }),
        snapshot: async () =>
          t.db
            .select()
            .from(openCallApplications)
            .where(eq(openCallApplications.openCallId, callId)),
      };
    },
  },
  {
    key: 'PATCH /api/v1/open-calls/[id]/applications/[appId]',
    actor: 'applicant',
    specificExtras: { openCallId: newId(), message: 'Sonradan degisti' },
    control: { status: 200, changesRows: true },
    prepare: async () => {
      const captain = await account(t);
      const applicant = await account(t);
      const teamId = await insertTeam(t, captain.id);
      const callId = await insertCall(await insertMatchRow(teamId, 'open'));
      const [application] = await t.db
        .insert(openCallApplications)
        .values({ openCallId: callId, userId: applicant.id })
        .returning({ id: openCallApplications.id });
      const appId = application?.id ?? '';
      return {
        headers: () => applicant.headers,
        params: { id: callId, appId },
        base: () => ({ status: 'withdrawn' }),
        snapshot: async () =>
          t.db.select().from(openCallApplications).where(eq(openCallApplications.id, appId)),
      };
    },
  },
  {
    key: 'POST /api/v1/venues',
    actor: 'verified user',
    specificExtras: {
      verified: true,
      isSample: true,
      slug: 'ele-gecirilmis-saha',
      searchName: 'ele gecirilmis',
      id: newId(),
    },
    control: { status: 201, changesRows: true },
    prepare: async () => {
      const actor = await account(t);
      const name = marker('Deneme Sahasi');
      return {
        headers: () => actor.headers,
        base: () => ({
          name,
          districtId: t.districtId,
          location: { latitude: 40.99, longitude: 29.03 },
          indoor: false,
          features: {},
        }),
        snapshot: async () => t.db.select().from(venues).where(eq(venues.name, name)),
      };
    },
  },
  {
    key: 'POST /api/v1/me/push-tokens',
    actor: 'self',
    specificExtras: { lastSeenAt: new Date(0).toISOString(), id: newId() },
    control: { status: 204, changesRows: true },
    prepare: async () => {
      const actor = await account(t);
      const expoToken = `ExponentPushToken[deneme-${randomBytes(6).toString('hex')}]`;
      return {
        headers: () => actor.headers,
        base: () => ({ expoToken, platform: 'android' }),
        snapshot: async () =>
          t.db.select().from(pushTokens).where(eq(pushTokens.expoToken, expoToken)),
      };
    },
  },
  {
    key: 'POST /api/v1/venues/[slug]/reviews',
    actor: 'verified user without a played match there',
    specificExtras: { venueId: newId(), id: newId() },
    // Not eligible (no played match at the venue): the control proves the body passes
    // validation and reaches the policy, which then refuses without a write.
    control: { status: 403, changesRows: false },
    prepare: async () => {
      const actor = await account(t);
      const suffix = randomBytes(4).toString('hex');
      const [venue] = await t.db
        .insert(venues)
        .values({
          name: `Acik Saha ${suffix}`,
          slug: `acik-saha-${suffix}`,
          searchName: `acik saha ${suffix}`,
          districtId: t.districtId,
          point: { lng: 29.03, lat: 40.99 },
          verified: true,
        })
        .returning({ id: venues.id, slug: venues.slug });
      const venueId = venue?.id ?? '';
      return {
        headers: () => actor.headers,
        params: { slug: venue?.slug ?? '' },
        base: () => ({ rating: 4 }),
        snapshot: async () =>
          t.db.select().from(venueReviews).where(eq(venueReviews.venueId, venueId)),
      };
    },
  },
  {
    key: 'POST /api/v1/uploads/presign',
    actor: 'self',
    specificExtras: { key: 'avatars/someone/else.webp', id: newId() },
    // This harness has no object storage configured: the handler answers 503 after validation,
    // which still proves the base body is valid (a schema rejection would be 400).
    control: { status: 503, changesRows: false },
    prepare: async () => {
      const actor = await account(t);
      return {
        headers: () => actor.headers,
        base: () => ({ kind: 'avatar', contentType: 'image/png', contentLength: 1_000 }),
        snapshot: async () => t.db.select().from(uploads).where(eq(uploads.userId, actor.id)),
      };
    },
  },
];

function handlerFor(key: string): RouteHandler {
  const loaded = routes.get(key);
  if (loaded === undefined) {
    throw new Error(`${key} is not a registered route`);
  }
  return loaded.handler;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

beforeAll(async () => {
  t = await setupTeamsHarness('web_attack_tenant_mass');
  routes = new Map((await loadRoutes()).map((entry) => [entry.key, entry]));
});

afterAll(async () => {
  await t.database.dispose();
});

describe('mass assignment: every registered schema rejects unknown keys at every depth', () => {
  it('finds no object node that strips or passes through unknown keys', () => {
    expect(routes.size).toBeGreaterThan(40);
    expect(registryOffenders()).toEqual([]);
  });

  it('keeps the documented exception real (it still exists and is still loose)', () => {
    const findings = [...routes.values()].flatMap(({ key, spec }) =>
      spec.bodies.flatMap((body) => nonStrictNodes(body).map((node) => `${key} body ${node}`)),
    );
    expect(findings).toEqual(Object.keys(LOOSE_BY_DESIGN));
  });

  it('negative control: the walker flags permissive objects at any depth', () => {
    expect(nonStrictNodes(z.strictObject({ name: z.string() }))).toEqual([]);
    expect(nonStrictNodes(z.object({ name: z.string() }))).toEqual(['$ (catchall: strip)']);
    expect(nonStrictNodes(z.looseObject({ name: z.string() }))).toEqual(['$ (catchall: unknown)']);
    expect(
      nonStrictNodes(
        z
          .strictObject({
            sides: z.array(z.object({ userId: z.string() })).optional(),
            pick: z.union([z.strictObject({ a: z.string() }), z.object({ b: z.string() })]),
          })
          .refine(() => true),
      ),
    ).toEqual(['$.sides[] (catchall: strip)', '$.pick|1 (catchall: strip)']);
  });
});

describe('mass assignment: server-owned fields are refused by the shipped handlers', () => {
  for (const testCase of CASES) {
    it(`${testCase.key} as ${testCase.actor}`, async () => {
      t.harness.setNow(new Date());
      const writable = writableKeys(testCase.key);
      expect(writable.size, 'route has an object body schema').toBeGreaterThan(0);
      const outcome = await attack(handlerFor(testCase.key), testCase, writable);
      // Every required field was probed unless the route legitimately writes it.
      for (const field of ['role', 'isPro', 'userId', 'status', 'teamId', 'createdBy']) {
        expect(outcome.tested.includes(field) || writable.has(field), field).toBe(true);
      }
      expect(outcome.tested).toEqual(
        expect.arrayContaining(['isPro', 'entitlements', 'stepUpUntil']),
      );
      expect(outcome.problems).toEqual([]);
      expect(outcome.controlStatus, outcome.controlBody).toBe(testCase.control.status);
      expect(outcome.controlChangedRows, 'control write visible in the database').toBe(
        testCase.control.changesRows,
      );
    });
  }

  it('covers every route whose body can carry a server-owned field', () => {
    const writeRoutes = [...routes.values()].filter(
      ({ spec }) => spec.method !== 'GET' && spec.auth !== 'none' && !spec.path.includes('/admin/'),
    );
    const covered = new Set(CASES.map((testCase) => testCase.key));
    const uncovered = writeRoutes
      .map(({ key }) => key)
      .filter((key) => !covered.has(key) && NOT_PROBED[key] === undefined);
    expect(uncovered).toEqual([]);
  });
});

/**
 * Authenticated write routes without a runtime probe here, with the reason. The structural sweep
 * above still proves their schemas strict at every depth.
 */
const NOT_PROBED: Readonly<Record<string, string>> = {
  'DELETE /api/v1/me': 'body is a re-auth proof only; covered by tests/security/idor.test.ts',
  'DELETE /api/v1/teams/[id]': 'empty body schema; nothing assignable',
  'DELETE /api/v1/teams/[id]/invites/[inviteId]': 'empty body schema; nothing assignable',
  'DELETE /api/v1/teams/[id]/members/[userId]': 'empty body schema; nothing assignable',
  'DELETE /api/v1/matches/[id]': 'empty body schema; nothing assignable',
  'DELETE /api/v1/venues/[slug]/reviews/mine': 'empty body schema; nothing assignable',
  'PUT /api/v1/matches/[id]/lineup':
    'body is user ids + sides; nested strictness proven by the structural sweep',
  'PATCH /api/v1/matches/[id]/open-call': 'body is the literal status "closed" only',
  'POST /api/v1/invites/[code]/accept': 'empty body schema; the code is the credential',
  'POST /api/v1/uploads/[id]/complete': 'empty body schema; nothing assignable',
  'POST /api/v1/auth/logout': 'session transport only; no row field in the body',
};

describe('negative control: the runtime probe detects a permissive handler', () => {
  /**
   * A real `route()` handler whose strict schema over-accepts `role` and whose handler spreads
   * the body into the user row: the classic mass-assignment bug. The probe must flag the 2xx and
   * the changed row.
   */
  const permissiveUpdateMe = route({
    path: '/api/v1/me',
    method: 'PATCH',
    auth: 'required',
    params: ENDPOINTS.updateMe.params,
    query: ENDPOINTS.updateMe.query,
    body: z.strictObject({
      displayName: z.string().min(2).max(40),
      role: z.enum(['user', 'moderator', 'admin']).optional(),
    }),
    handler: async ({ body, ctx }) => {
      await ctx.authorize('me.update');
      const userId = ctx.principal?.userId ?? '';
      await t.db.update(users).set(body).where(eq(users.id, userId));
      return json({ ok: true });
    },
  });

  it('flags the accepted role and the changed row', async () => {
    t.harness.setNow(new Date());
    const meCase = CASES.find((testCase) => testCase.key === 'PATCH /api/v1/me');
    if (meCase === undefined) {
      throw new Error('PATCH /api/v1/me case missing');
    }
    // `role` is accepted by this broken schema; the probe sends it as an attacker would.
    const roleOutcome = await attack(
      permissiveUpdateMe,
      { ...meCase, specificExtras: {} },
      new Set(['displayName']),
    );
    expect(roleOutcome.problems).toEqual(
      expect.arrayContaining([
        'extra "role" answered 200 undefined',
        'extra "role" changed the database',
      ]),
    );
  });
});
