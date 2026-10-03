import { randomBytes } from 'node:crypto';

import { ENDPOINTS, teamParamsSchema } from '@kadro/contracts';
import {
  matches,
  matchRsvps,
  mvpVotes,
  newId,
  openCallApplications,
  openCalls,
  teamInvites,
  teamMembers,
  teams,
  uploads,
  users,
  venueImports,
  venueReviews,
  venues,
} from '@kadro/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { json, route, type RouteHandler } from '../../lib/server/http';
import { call } from '../support/http';
import {
  type Account,
  account,
  addMember,
  insertInvite,
  insertTeam,
  setupTeamsHarness,
  type TeamsHarness,
} from '../teams/support';
import { dynamicSegments, type LoadedRoute, loadRoutes } from './support';

/**
 * Authenticated cross-user and cross-team BOLA / IDOR sweep (threat model §5, authorization
 * matrix §2 and §5), driven by the endpoint registry.
 *
 * A victim team (captain, co-captain, player) owns a team, an invite, locked / open / played
 * matches, an open call with a pending application, an upload, an unverified venue, a review and
 * a venue import. Two attackers then call every id-bearing route against those resources:
 *
 * - `stranger`: a verified user with no relationship to anything of the victim;
 * - `foreign-captain`: the captain of a different team, i.e. the highest team role elsewhere.
 *
 * Every attempt must answer the status the matrix assigns (404 `not_found` for team-scoped
 * resources the attacker cannot read, 403 `forbidden` for admin routes), never a 2xx, and the
 * body must not contain any victim marker (names, ids, venue text). For every case the same
 * request with the victim's ids replaced by unknown ids must produce an identical status and an
 * identical body apart from `requestId` (matrix §2: "identical body to a truly missing id"). After
 * every attempt a snapshot of all victim rows must be unchanged.
 *
 * The coverage block fails when an id-bearing route has neither a case nor a reasoned exemption,
 * and a negative control proves the checks fail against a deliberately permissive handler.
 */

let t: TeamsHarness;
let routes: Map<string, LoadedRoute>;

const HOUR_MS = 3_600_000;

type Persona = 'stranger' | 'foreign-captain';

interface Attacker {
  readonly persona: Persona;
  readonly account: Account;
  /** Own team, match, locked match and open call of a `foreign-captain` (undefined for a stranger). */
  readonly own?: {
    readonly teamId: string;
    readonly openMatchId: string;
    readonly lockedMatchId: string;
    readonly callId: string;
  };
}

interface Victim {
  readonly teamId: string;
  readonly teamName: string;
  readonly captain: Account;
  readonly coCaptain: Account;
  readonly player: Account;
  readonly applicant: Account;
  readonly inviteId: string;
  readonly openMatchId: string;
  readonly lockedMatchId: string;
  readonly playedMatchId: string;
  readonly callId: string;
  readonly applicationId: string;
  readonly uploadId: string;
  readonly uploadKey: string;
  readonly hiddenVenueId: string;
  readonly hiddenVenueSlug: string;
  readonly hiddenVenueName: string;
  readonly reviewedVenueId: string;
  readonly reviewId: string;
  readonly importId: string;
  readonly venueText: string;
  readonly applicationMessage: string;
}

interface Attempt {
  readonly params: Record<string, string>;
  readonly json?: unknown;
}

type Expected =
  | { readonly status: 404; readonly code: 'not_found' }
  | { readonly status: 403; readonly code: 'forbidden' };

const NOT_FOUND: Expected = { status: 404, code: 'not_found' };
const FORBIDDEN: Expected = { status: 403, code: 'forbidden' };

interface BolaCase {
  readonly key: string;
  readonly label: string;
  readonly personas: readonly Persona[];
  readonly expected: Expected;
  readonly attempt: (victim: Victim, attacker: Attacker) => Attempt;
  /** Path segments that address the victim's resource; replaced by unknown ids for the twin. */
  readonly victimSegments: readonly string[];
}

const BOTH: readonly Persona[] = ['stranger', 'foreign-captain'];

function future(ms: number): string {
  return new Date(t.harness.runtime.now().getTime() + ms).toISOString();
}

function own(attacker: Attacker): NonNullable<Attacker['own']> {
  if (attacker.own === undefined) {
    throw new Error(`${attacker.persona} has no own team`);
  }
  return attacker.own;
}

// ---------------------------------------------------------------------------
// Cases: one or more per id-bearing route of the registry.
// ---------------------------------------------------------------------------

const CASES: readonly BolaCase[] = [
  // Teams (matrix §3.3).
  {
    key: 'GET /api/v1/teams/[id]',
    label: 'reads the victim team',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId } }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/teams/[id]',
    label: 'renames the victim team',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId }, json: { name: 'Ele Gecirildi' } }),
    victimSegments: ['id'],
  },
  {
    key: 'DELETE /api/v1/teams/[id]',
    label: 'deletes the victim team',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId } }),
    victimSegments: ['id'],
  },
  {
    key: 'GET /api/v1/teams/[id]/invites',
    label: 'lists the victim invites',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId } }),
    victimSegments: ['id'],
  },
  {
    key: 'POST /api/v1/teams/[id]/invites',
    label: 'mints an invite into the victim team',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId }, json: { maxUses: 5 } }),
    victimSegments: ['id'],
  },
  {
    key: 'DELETE /api/v1/teams/[id]/invites/[inviteId]',
    label: 'revokes the victim invite',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId, inviteId: v.inviteId } }),
    victimSegments: ['id', 'inviteId'],
  },
  {
    key: 'DELETE /api/v1/teams/[id]/invites/[inviteId]',
    label: 'revokes the victim invite through its own team id (parent swap)',
    personas: ['foreign-captain'],
    expected: NOT_FOUND,
    attempt: (v, a) => ({ params: { id: own(a).teamId, inviteId: v.inviteId } }),
    victimSegments: ['inviteId'],
  },
  {
    key: 'GET /api/v1/teams/[id]/matches',
    label: 'lists the victim matches',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId } }),
    victimSegments: ['id'],
  },
  {
    key: 'POST /api/v1/teams/[id]/matches',
    label: 'schedules a match for the victim team',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({
      params: { id: v.teamId },
      json: {
        venueText: 'Ele Gecirildi',
        startsAt: future(48 * HOUR_MS),
        format: '5v5',
        feeTotalMinor: 0,
        slots: 10,
      },
    }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/teams/[id]/members/[userId]',
    label: 'promotes the victim player',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({
      params: { id: v.teamId, userId: v.player.id },
      json: { role: 'co_captain' },
    }),
    victimSegments: ['id', 'userId'],
  },
  {
    key: 'PATCH /api/v1/teams/[id]/members/[userId]',
    label: 'hands its own captaincy to the victim player (parent swap)',
    personas: ['foreign-captain'],
    expected: NOT_FOUND,
    attempt: (v, a) => ({
      params: { id: own(a).teamId, userId: v.player.id },
      json: { role: 'captain' },
    }),
    victimSegments: ['userId'],
  },
  {
    key: 'DELETE /api/v1/teams/[id]/members/[userId]',
    label: 'removes the victim player',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.teamId, userId: v.player.id } }),
    victimSegments: ['id', 'userId'],
  },
  {
    key: 'DELETE /api/v1/teams/[id]/members/[userId]',
    label: 'removes the victim captain through its own team id (parent swap)',
    personas: ['foreign-captain'],
    expected: NOT_FOUND,
    attempt: (v, a) => ({ params: { id: own(a).teamId, userId: v.captain.id } }),
    victimSegments: ['userId'],
  },
  // Matches, RSVP, lineup, payments, MVP (matrix §3.4).
  {
    key: 'GET /api/v1/matches/[id]',
    label: 'reads the victim match',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.lockedMatchId } }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/matches/[id]',
    label: 'moves the victim match',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.openMatchId }, json: { venueText: 'Ele Gecirildi' } }),
    victimSegments: ['id'],
  },
  {
    key: 'DELETE /api/v1/matches/[id]',
    label: 'cancels the victim match',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.openMatchId } }),
    victimSegments: ['id'],
  },
  {
    key: 'PUT /api/v1/matches/[id]/rsvp',
    label: 'joins the victim match',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.openMatchId }, json: { status: 'in' } }),
    victimSegments: ['id'],
  },
  {
    key: 'PUT /api/v1/matches/[id]/lineup',
    label: 'rewrites the victim lineup',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({
      params: { id: v.lockedMatchId },
      json: { sides: [{ userId: v.player.id, side: 'A' }] },
    }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/matches/[id]/payments/[userId]',
    label: 'marks the victim player as paid',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({
      params: { id: v.lockedMatchId, userId: v.player.id },
      json: { paid: true },
    }),
    victimSegments: ['id', 'userId'],
  },
  {
    key: 'PATCH /api/v1/matches/[id]/payments/[userId]',
    label: 'names the victim player on its own locked match (parent swap)',
    personas: ['foreign-captain'],
    expected: NOT_FOUND,
    attempt: (v, a) => ({
      params: { id: own(a).lockedMatchId, userId: v.player.id },
      json: { paid: true },
    }),
    victimSegments: ['userId'],
  },
  {
    key: 'POST /api/v1/matches/[id]/mvp-vote',
    label: 'votes on the victim played match',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.playedMatchId }, json: { voteeId: v.player.id } }),
    victimSegments: ['id'],
  },
  // Open calls and applications (matrix §3.5).
  {
    key: 'POST /api/v1/matches/[id]/open-call',
    label: 'publishes a call on the victim match',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({
      params: { id: v.lockedMatchId },
      json: { missingCount: 1, position: null, level: 'casual', expiresAt: future(HOUR_MS) },
    }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/matches/[id]/open-call',
    label: 'closes the victim call',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.openMatchId }, json: { status: 'closed' } }),
    victimSegments: ['id'],
  },
  {
    key: 'GET /api/v1/open-calls/[id]/applications',
    label: 'lists the applications of the victim call',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.callId } }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/open-calls/[id]/applications/[appId]',
    label: 'accepts the pending application on the victim call',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({
      params: { id: v.callId, appId: v.applicationId },
      json: { status: 'accepted' },
    }),
    victimSegments: ['id', 'appId'],
  },
  {
    key: 'PATCH /api/v1/open-calls/[id]/applications/[appId]',
    label: 'rejects the victim application through its own call id (parent swap)',
    personas: ['foreign-captain'],
    expected: NOT_FOUND,
    attempt: (v, a) => ({
      params: { id: own(a).callId, appId: v.applicationId },
      json: { status: 'rejected' },
    }),
    victimSegments: ['appId'],
  },
  {
    key: 'PATCH /api/v1/open-calls/[id]/applications/[appId]',
    label: 'withdraws the victim application',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({
      params: { id: v.callId, appId: v.applicationId },
      json: { status: 'withdrawn' },
    }),
    victimSegments: ['id', 'appId'],
  },
  // Uploads (matrix §3.7, footnote 31).
  {
    key: 'GET /api/v1/uploads/[id]',
    label: 'reads the victim upload',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.uploadId } }),
    victimSegments: ['id'],
  },
  {
    key: 'POST /api/v1/uploads/[id]/complete',
    label: 'completes the victim upload',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { id: v.uploadId }, json: {} }),
    victimSegments: ['id'],
  },
  // Venues and reviews (matrix §3.6): the victim's unverified venue is visible to its creator only.
  {
    key: 'GET /api/v1/venues/[slug]',
    label: 'reads the victim unverified venue',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { slug: v.hiddenVenueSlug } }),
    victimSegments: ['slug'],
  },
  {
    key: 'POST /api/v1/venues/[slug]/reviews',
    label: 'reviews the victim unverified venue',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { slug: v.hiddenVenueSlug }, json: { rating: 1 } }),
    victimSegments: ['slug'],
  },
  {
    key: 'DELETE /api/v1/venues/[slug]/reviews/mine',
    label: 'deletes "mine" on the venue the victim reviewed',
    personas: BOTH,
    expected: NOT_FOUND,
    attempt: (v) => ({ params: { slug: v.hiddenVenueSlug } }),
    victimSegments: ['slug'],
  },
  // Admin (matrix §3.8): no staff role → 403 before the id is looked at.
  {
    key: 'PATCH /api/v1/admin/venues/[id]',
    label: 'verifies the victim venue',
    personas: BOTH,
    expected: FORBIDDEN,
    attempt: (v) => ({ params: { id: v.hiddenVenueId }, json: { verified: true } }),
    victimSegments: ['id'],
  },
  {
    key: 'GET /api/v1/admin/venues/import/[importId]',
    label: 'reads the victim venue import',
    personas: BOTH,
    expected: FORBIDDEN,
    attempt: (v) => ({ params: { importId: v.importId } }),
    victimSegments: ['importId'],
  },
  {
    key: 'DELETE /api/v1/admin/reviews/[id]',
    label: 'removes the victim review',
    personas: BOTH,
    expected: FORBIDDEN,
    attempt: (v) => ({ params: { id: v.reviewId } }),
    victimSegments: ['id'],
  },
  {
    key: 'DELETE /api/v1/admin/open-calls/[id]',
    label: 'removes the victim call',
    personas: BOTH,
    expected: FORBIDDEN,
    attempt: (v) => ({ params: { id: v.callId } }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/admin/users/[id]/role',
    label: 'makes the victim captain an admin',
    personas: BOTH,
    expected: FORBIDDEN,
    attempt: (v) => ({
      params: { id: v.captain.id },
      json: { role: 'admin', totpCode: '123456' },
    }),
    victimSegments: ['id'],
  },
  {
    key: 'PATCH /api/v1/admin/users/[id]/deactivate',
    label: 'deactivates the victim captain',
    personas: BOTH,
    expected: FORBIDDEN,
    attempt: (v) => ({
      params: { id: v.captain.id },
      json: { deactivated: true, totpCode: '123456' },
    }),
    victimSegments: ['id'],
  },
];

/**
 * Id-bearing routes deliberately outside this sweep. The path segment is a bearer capability or
 * the resource is public by design, so "another user succeeds" is the specified behavior.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  'GET /api/v1/invites/[code]':
    'the invite code is the credential; anyone holding it may preview (matrix §3.3 footnote 28)',
  'POST /api/v1/invites/[code]/accept':
    'the invite code is the credential; any verified user holding it may join (footnote 7)',
  'POST /api/v1/open-calls/[id]/applications':
    'open calls are public; applying as another team is the feature (matrix §3.5 footnote 20)',
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function insertMatchRow(
  teamId: string,
  status: 'open' | 'locked' | 'played',
  venueText: string,
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
      venueText,
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

async function insertVenue(
  name: string,
  values: { verified: boolean; createdBy: string | null },
): Promise<{ id: string; slug: string }> {
  const suffix = randomBytes(4).toString('hex');
  const [row] = await t.db
    .insert(venues)
    .values({
      name: `${name} ${suffix}`,
      slug: `gizli-saha-${suffix}`,
      searchName: `${name.toLowerCase()} ${suffix}`,
      districtId: t.districtId,
      point: { lng: 29.03, lat: 40.99 },
      phone: '+90 216 111 11 11',
      verified: values.verified,
      createdBy: values.createdBy,
    })
    .returning({ id: venues.id, slug: venues.slug });
  if (row === undefined) {
    throw new Error('venue insert returned no row');
  }
  return row;
}

async function buildVictim(): Promise<Victim> {
  const marker = randomBytes(4).toString('hex');
  const teamName = `Gizli Takim ${marker}`;
  const venueText = `Gizli Saha Adresi ${marker}`;
  const applicationMessage = `Gizli basvuru notu ${marker}`;
  const captain = await account(t);
  const coCaptain = await account(t);
  const player = await account(t);
  const applicant = await account(t);
  const teamId = await insertTeam(t, captain.id, { name: teamName });
  await addMember(t, teamId, coCaptain.id, 'co_captain');
  await addMember(t, teamId, player.id, 'player');
  const invite = await insertInvite(t, teamId);

  const openMatchId = await insertMatchRow(teamId, 'open', venueText);
  const lockedMatchId = await insertMatchRow(teamId, 'locked', venueText);
  const playedMatchId = await insertMatchRow(teamId, 'played', venueText);
  for (const matchId of [lockedMatchId, playedMatchId]) {
    for (const userId of [captain.id, player.id]) {
      await t.db.insert(matchRsvps).values({ matchId, userId, status: 'in' });
    }
  }
  const callId = await insertCall(openMatchId);
  const [application] = await t.db
    .insert(openCallApplications)
    .values({ openCallId: callId, userId: applicant.id, message: applicationMessage })
    .returning({ id: openCallApplications.id });

  const uploadId = newId();
  const uploadKey = `avatars/${captain.id}/${uploadId}`;
  await t.db.insert(uploads).values({
    id: uploadId,
    userId: captain.id,
    kind: 'avatar',
    contentType: 'image/png',
    contentLength: 1_000,
    status: 'pending',
    key: uploadKey,
    createdAt: t.harness.runtime.now(),
  });

  const hiddenVenueName = `Gizli Saha ${marker}`;
  const hidden = await insertVenue(hiddenVenueName, { verified: false, createdBy: captain.id });
  const reviewed = await insertVenue(`Acik Saha ${marker}`, { verified: true, createdBy: null });
  const [review] = await t.db
    .insert(venueReviews)
    .values({ venueId: reviewed.id, userId: captain.id, rating: 4, text: `Yorum ${marker}` })
    .returning({ id: venueReviews.id });
  const [venueImport] = await t.db
    .insert(venueImports)
    .values({ createdBy: captain.id, csv: 'name,il,ilce,latitude,longitude,indoor\n' })
    .returning({ id: venueImports.id });

  if (application === undefined || review === undefined || venueImport === undefined) {
    throw new Error('victim fixture insert returned no row');
  }
  return {
    teamId,
    teamName,
    captain,
    coCaptain,
    player,
    applicant,
    inviteId: invite.id,
    openMatchId,
    lockedMatchId,
    playedMatchId,
    callId,
    applicationId: application.id,
    uploadId,
    uploadKey,
    hiddenVenueId: hidden.id,
    hiddenVenueSlug: hidden.slug,
    hiddenVenueName,
    reviewedVenueId: reviewed.id,
    reviewId: review.id,
    importId: venueImport.id,
    venueText,
    applicationMessage,
  };
}

async function buildAttacker(persona: Persona): Promise<Attacker> {
  const attacker = await account(t);
  if (persona === 'stranger') {
    return { persona, account: attacker };
  }
  const teamId = await insertTeam(t, attacker.id);
  const openMatchId = await insertMatchRow(teamId, 'open', 'Kendi Sahasi');
  const lockedMatchId = await insertMatchRow(teamId, 'locked', 'Kendi Sahasi');
  await t.db
    .insert(matchRsvps)
    .values({ matchId: lockedMatchId, userId: attacker.id, status: 'in' });
  const callId = await insertCall(openMatchId);
  return { persona, account: attacker, own: { teamId, openMatchId, lockedMatchId, callId } };
}

/** Every victim row an attempt could touch, in a stable order. */
async function victimSnapshot(v: Victim): Promise<unknown> {
  const matchIds = [v.openMatchId, v.lockedMatchId, v.playedMatchId];
  const victimUsers = [v.captain.id, v.coCaptain.id, v.player.id, v.applicant.id];
  return {
    team: await t.db.select().from(teams).where(eq(teams.id, v.teamId)),
    members: await t.db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.teamId, v.teamId))
      .orderBy(asc(teamMembers.userId)),
    invites: await t.db
      .select()
      .from(teamInvites)
      .where(eq(teamInvites.teamId, v.teamId))
      .orderBy(asc(teamInvites.id)),
    matches: await t.db
      .select()
      .from(matches)
      .where(eq(matches.teamId, v.teamId))
      .orderBy(asc(matches.id)),
    rsvps: await t.db
      .select()
      .from(matchRsvps)
      .where(inArray(matchRsvps.matchId, matchIds))
      .orderBy(asc(matchRsvps.id)),
    votes: await t.db.select().from(mvpVotes).where(inArray(mvpVotes.matchId, matchIds)),
    calls: await t.db
      .select()
      .from(openCalls)
      .where(inArray(openCalls.matchId, matchIds))
      .orderBy(asc(openCalls.id)),
    applications: await t.db
      .select()
      .from(openCallApplications)
      .where(eq(openCallApplications.openCallId, v.callId))
      .orderBy(asc(openCallApplications.id)),
    upload: await t.db.select().from(uploads).where(eq(uploads.id, v.uploadId)),
    venues: await t.db
      .select()
      .from(venues)
      .where(inArray(venues.id, [v.hiddenVenueId, v.reviewedVenueId]))
      .orderBy(asc(venues.id)),
    reviews: await t.db
      .select()
      .from(venueReviews)
      .where(inArray(venueReviews.venueId, [v.hiddenVenueId, v.reviewedVenueId]))
      .orderBy(asc(venueReviews.id)),
    venueImport: await t.db.select().from(venueImports).where(eq(venueImports.id, v.importId)),
    users: await t.db
      .select({
        id: users.id,
        role: users.role,
        displayName: users.displayName,
        deactivatedAt: users.deactivatedAt,
      })
      .from(users)
      .where(inArray(users.id, victimUsers))
      .orderBy(asc(users.id)),
  };
}

/** Strings that only the victim's own reads may return. */
function victimMarkers(v: Victim): string[] {
  return [
    v.teamId,
    v.teamName,
    v.captain.id,
    v.coCaptain.id,
    v.player.id,
    v.applicant.id,
    v.inviteId,
    v.openMatchId,
    v.lockedMatchId,
    v.playedMatchId,
    v.callId,
    v.applicationId,
    v.uploadId,
    v.uploadKey,
    v.hiddenVenueId,
    v.hiddenVenueSlug,
    v.hiddenVenueName,
    v.reviewId,
    v.importId,
    v.venueText,
    v.applicationMessage,
  ];
}

// ---------------------------------------------------------------------------
// Requests and the denial check
// ---------------------------------------------------------------------------

interface Answer {
  readonly status: number;
  readonly contentType: string | null;
  readonly text: string;
}

async function send(
  handler: RouteHandler,
  key: string,
  headers: Record<string, string>,
  attempt: Attempt,
): Promise<Answer> {
  const [method, pattern] = key.split(' ') as [string, string];
  let pathname = pattern;
  for (const [name, value] of Object.entries(attempt.params)) {
    pathname = pathname.replace(`[${name}]`, encodeURIComponent(value));
  }
  const response = await call(handler, {
    method,
    path: pathname,
    headers,
    params: attempt.params,
    ...(attempt.json === undefined ? {} : { json: attempt.json }),
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    text: await response.text(),
  };
}

function unknownValue(segment: string): string {
  return segment === 'slug' ? `bilinmeyen-saha-${randomBytes(4).toString('hex')}` : newId();
}

/** The same attempt with every victim-addressing segment replaced by an id nobody owns. */
function unknownTwin(attempt: Attempt, segments: readonly string[]): Attempt {
  const params = { ...attempt.params };
  for (const segment of segments) {
    params[segment] = unknownValue(segment);
  }
  return { ...attempt, params };
}

function comparableBody(text: string): unknown {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const { requestId: _requestId, ...rest } = parsed;
    return rest;
  } catch {
    return `<non-json> ${text}`;
  }
}

/**
 * Everything wrong with one denied attempt, as readable lines (empty = the denial is correct).
 * Kept pure so the negative control can feed it a deliberately permissive answer.
 */
function denialProblems(
  expected: Expected,
  victimAnswer: Answer,
  unknownAnswer: Answer,
  markers: readonly string[],
): string[] {
  const problems: string[] = [];
  const body = comparableBody(victimAnswer.text) as { code?: unknown };
  if (victimAnswer.status >= 200 && victimAnswer.status < 300) {
    problems.push(`answered ${victimAnswer.status} on a resource it must not reach`);
  }
  if (victimAnswer.status !== expected.status || body.code !== expected.code) {
    problems.push(
      `expected ${expected.status} ${expected.code}, got ${victimAnswer.status} ${String(body.code)}`,
    );
  }
  if (victimAnswer.contentType !== 'application/problem+json') {
    problems.push(`content-type ${String(victimAnswer.contentType)}`);
  }
  for (const marker of markers) {
    if (victimAnswer.text.includes(marker)) {
      problems.push(`response leaks victim data "${marker}"`);
    }
  }
  if (victimAnswer.status !== unknownAnswer.status) {
    problems.push(
      `victim id answers ${victimAnswer.status} but an unknown id answers ${unknownAnswer.status}`,
    );
  }
  if (
    JSON.stringify(comparableBody(victimAnswer.text)) !==
    JSON.stringify(comparableBody(unknownAnswer.text))
  ) {
    problems.push(
      `body differs from the unknown-id body: ${victimAnswer.text} vs ${unknownAnswer.text}`,
    );
  }
  return problems;
}

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
  t = await setupTeamsHarness('web_attack_tenant_bola');
  routes = new Map((await loadRoutes()).map((entry) => [entry.key, entry]));
});

afterAll(async () => {
  await t.database.dispose();
});

describe('cross-user and cross-team BOLA sweep (registry driven)', () => {
  for (const testCase of CASES) {
    for (const persona of testCase.personas) {
      it(`${testCase.key} as ${persona}: ${testCase.label} → ${testCase.expected.status}`, async () => {
        t.harness.setNow(new Date());
        const victim = await buildVictim();
        const attacker = await buildAttacker(persona);
        const handler = handlerFor(testCase.key);
        const before = await victimSnapshot(victim);

        const attempt = testCase.attempt(victim, attacker);
        const victimAnswer = await send(handler, testCase.key, attacker.account.headers, attempt);
        const unknownAnswer = await send(
          handler,
          testCase.key,
          attacker.account.headers,
          unknownTwin(attempt, testCase.victimSegments),
        );

        expect(
          denialProblems(testCase.expected, victimAnswer, unknownAnswer, victimMarkers(victim)),
        ).toEqual([]);
        expect(await victimSnapshot(victim)).toEqual(before);
      });
    }
  }
});

describe('BOLA sweep coverage', () => {
  it('has a case or a reasoned exemption for every id-bearing route', () => {
    const idBearing = [...routes.values()]
      .filter((entry) => dynamicSegments(entry.spec.path).length > 0)
      .map((entry) => entry.key);
    expect(idBearing.length).toBeGreaterThan(30);
    const covered = new Set(CASES.map((testCase) => testCase.key));
    const missing = idBearing.filter((key) => !covered.has(key) && EXEMPT[key] === undefined);
    expect(missing).toEqual([]);
    const unknownKeys = [...covered, ...Object.keys(EXEMPT)].filter((key) => !routes.has(key));
    expect(unknownKeys).toEqual([]);
    // Every victim segment named by a case is a real dynamic segment of its route.
    for (const testCase of CASES) {
      for (const segment of testCase.victimSegments) {
        expect(dynamicSegments(testCase.key.split(' ')[1] ?? '')).toContain(segment);
      }
    }
  });
});

describe('negative control: the sweep detects a permissive handler', () => {
  /**
   * A route built with the real `route()` wrapper whose handler authorizes only "is signed in" and
   * then loads the team by bare id: the classic BOLA bug. The sweep's checks must flag it.
   */
  const permissiveGetTeam = route({
    path: '/api/v1/teams/[id]',
    method: 'GET',
    auth: 'required',
    params: teamParamsSchema,
    query: ENDPOINTS.getTeam.query,
    body: ENDPOINTS.getTeam.body,
    handler: async ({ params, ctx }) => {
      await ctx.authorize('me.read');
      const [row] = await t.db.select().from(teams).where(eq(teams.id, params.id));
      if (row === undefined) {
        return json({ type: 'about:blank', code: 'not_found' }, { status: 404 });
      }
      return json({ id: row.id, name: row.name });
    },
  });

  it('flags the leak, the 2xx, and the unknown-id difference', async () => {
    t.harness.setNow(new Date());
    const victim = await buildVictim();
    const attacker = await buildAttacker('stranger');
    const key = 'GET /api/v1/teams/[id]';
    const attempt: Attempt = { params: { id: victim.teamId } };
    const victimAnswer = await send(permissiveGetTeam, key, attacker.account.headers, attempt);
    const unknownAnswer = await send(
      permissiveGetTeam,
      key,
      attacker.account.headers,
      unknownTwin(attempt, ['id']),
    );
    expect(victimAnswer.status).toBe(200);
    const problems = denialProblems(NOT_FOUND, victimAnswer, unknownAnswer, victimMarkers(victim));
    expect(problems).toEqual(
      expect.arrayContaining([
        'answered 200 on a resource it must not reach',
        `response leaks victim data "${victim.teamName}"`,
        'victim id answers 200 but an unknown id answers 404',
      ]),
    );
    // The real handler, same attacker and ids, passes the identical checks.
    const real = handlerFor(key);
    expect(
      denialProblems(
        NOT_FOUND,
        await send(real, key, attacker.account.headers, attempt),
        await send(real, key, attacker.account.headers, unknownTwin(attempt, ['id'])),
        victimMarkers(victim),
      ),
    ).toEqual([]);
  });
});
