import {
  type MatchDetail,
  type MatchFormat,
  type MatchGuestView,
  type MatchMemberView,
  type MatchMvp,
  type MatchSummary,
  type OwnRsvp,
  type RsvpCounts,
} from '@kadro/contracts';
import {
  type LineupSide,
  type MatchStatus,
  matches,
  matchRsvps,
  mvpVotes,
  type RsvpStatus,
  teams,
  users,
  venues,
} from '@kadro/db';
import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type DbReader } from '../domain/relations';
import { type MediaUrlOf } from '../uploads/urls';

/**
 * Read projections of matches (authorization matrix §6, footnote 11; ADR-0036). Team members get
 * the member view with `paid` flags and the fee total; match guests get the guest view: date,
 * venue, format, own RSVP, lineup sides, the per-player share and the other participants' card
 * fields only. MVP tallies are never returned: while the window is open only the actor's own
 * vote, afterwards only the winners. Callers have already authorized the actor.
 */

export type Projection = 'member' | 'guest';

/** Base share of ADR-0036: `floor(fee / confirmed)`; `null` while nobody is confirmed. */
export function baseShare(feeTotalMinor: number, confirmed: number): number | null {
  return confirmed === 0 ? null : Math.floor(feeTotalMinor / confirmed);
}

/**
 * The actor's exact share of ADR-0036: the base share plus one kuruş of the remainder
 * `fee mod confirmed` for the first confirmed players in RSVP order (`confirmedIds` is in that
 * order, ties by id). `null` when the actor is not confirmed.
 */
export function exactShare(
  feeTotalMinor: number,
  confirmedIds: readonly string[],
  actorId: string,
): number | null {
  const position = confirmedIds.indexOf(actorId);
  const base = baseShare(feeTotalMinor, confirmedIds.length);
  if (position < 0 || base === null) {
    return null;
  }
  return base + (position < feeTotalMinor % confirmedIds.length ? 1 : 0);
}

const ownRsvp = alias(matchRsvps, 'own_rsvp');
const countedRsvp = alias(matchRsvps, 'counted_rsvp');

function rsvpCount(db: DbReader, status: RsvpStatus): SQL<number> {
  return sql<number>`(${db
    .select({ n: count() })
    .from(countedRsvp)
    .where(and(eq(countedRsvp.matchId, matches.id), eq(countedRsvp.status, status)))})`.mapWith(
    Number,
  );
}

/** Columns of a match summary for a select from `matches` joined to `venues` and `own_rsvp`. */
export function matchSummaryColumns(db: DbReader) {
  return {
    id: matches.id,
    teamId: matches.teamId,
    venueId: venues.id,
    venueName: venues.name,
    venueSlug: venues.slug,
    venueText: matches.venueText,
    startsAt: matches.startsAt,
    format: matches.format,
    feeTotalMinor: matches.feeTotalMinor,
    slots: matches.slots,
    status: matches.status,
    lockedAt: matches.lockedAt,
    mvpVoteClosesAt: matches.mvpVoteClosesAt,
    createdAt: matches.createdAt,
    inCount: rsvpCount(db, 'in'),
    maybeCount: rsvpCount(db, 'maybe'),
    outCount: rsvpCount(db, 'out'),
    waitlistCount: rsvpCount(db, 'waitlist'),
    myRsvp: ownRsvp.status,
  };
}

/** Join of the actor's own RSVP for {@link matchSummaryColumns}. */
export function ownRsvpJoin(actorId: string): SQL {
  return and(eq(ownRsvp.matchId, matches.id), eq(ownRsvp.userId, actorId)) ?? sql`false`;
}

export { ownRsvp as ownRsvpTable };

export interface MatchSummaryRow {
  readonly id: string;
  readonly teamId: string;
  readonly venueId: string | null;
  readonly venueName: string | null;
  readonly venueSlug: string | null;
  readonly venueText: string | null;
  readonly startsAt: Date;
  readonly format: MatchFormat;
  readonly feeTotalMinor: number;
  readonly slots: number;
  readonly status: MatchStatus;
  readonly lockedAt: Date | null;
  readonly mvpVoteClosesAt: Date | null;
  readonly createdAt: Date;
  readonly inCount: number;
  readonly maybeCount: number;
  readonly outCount: number;
  readonly waitlistCount: number;
  readonly myRsvp: RsvpStatus | null;
}

function venueOf(row: {
  venueId: string | null;
  venueName: string | null;
  venueSlug: string | null;
}): MatchSummary['venue'] {
  return row.venueId === null || row.venueName === null || row.venueSlug === null
    ? null
    : { id: row.venueId, name: row.venueName, slug: row.venueSlug };
}

export function toMatchSummary(row: MatchSummaryRow): MatchSummary {
  const counts: RsvpCounts = {
    in: row.inCount,
    maybe: row.maybeCount,
    out: row.outCount,
    waitlist: row.waitlistCount,
  };
  return {
    id: row.id,
    teamId: row.teamId,
    venue: venueOf(row),
    venueText: row.venueText,
    startsAt: row.startsAt.toISOString(),
    format: row.format,
    feeTotalMinor: row.feeTotalMinor,
    slots: row.slots,
    status: row.status,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    mvpVoteClosesAt: row.mvpVoteClosesAt?.toISOString() ?? null,
    counts,
    myRsvp: row.myRsvp,
    createdAt: row.createdAt.toISOString(),
  };
}

interface ParticipantRow {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarKey: string | null;
  readonly position: MatchMemberView['participants'][number]['user']['position'];
  readonly level: MatchMemberView['participants'][number]['user']['level'];
  readonly isTombstone: boolean;
  readonly status: RsvpStatus;
  readonly side: LineupSide | null;
  readonly paid: boolean;
  readonly updatedAt: Date;
}

/** Every RSVP of the match with the participant's public fields, in RSVP order (ADR-0036). */
async function loadParticipants(db: DbReader, matchId: string): Promise<ParticipantRow[]> {
  return db
    .select({
      userId: users.id,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      position: users.position,
      level: users.level,
      isTombstone: users.isTombstone,
      status: matchRsvps.status,
      side: matchRsvps.side,
      paid: matchRsvps.paid,
      updatedAt: matchRsvps.updatedAt,
    })
    .from(matchRsvps)
    .innerJoin(users, eq(users.id, matchRsvps.userId))
    .where(eq(matchRsvps.matchId, matchId))
    .orderBy(asc(matchRsvps.createdAt), asc(matchRsvps.id));
}

/**
 * MVP state for the actor (ADR-0036): `null` before `played`; the own vote while the window is
 * open; the winners (all votees sharing the highest count, none without votes) after it closed.
 * Vote counts are compared here and never leave the server.
 */
export async function loadMvp(
  db: DbReader,
  match: { readonly id: string; readonly status: MatchStatus; readonly closesAt: Date | null },
  actorId: string,
  now: Date,
): Promise<MatchMvp | null> {
  if (match.status !== 'played' || match.closesAt === null) {
    return null;
  }
  const [own] = await db
    .select({ voteeId: mvpVotes.voteeId })
    .from(mvpVotes)
    .where(and(eq(mvpVotes.matchId, match.id), eq(mvpVotes.voterId, actorId)))
    .limit(1);
  if (now.getTime() < match.closesAt.getTime()) {
    return { myVoteeId: own?.voteeId ?? null, winnerIds: null };
  }
  const tally = await db
    .select({ voteeId: mvpVotes.voteeId, votes: count() })
    .from(mvpVotes)
    .where(eq(mvpVotes.matchId, match.id))
    .groupBy(mvpVotes.voteeId);
  const top = Math.max(0, ...tally.map((row) => row.votes));
  const winnerIds = tally
    .filter((row) => top > 0 && row.votes === top)
    .map((row) => row.voteeId)
    .sort();
  return { myVoteeId: own?.voteeId ?? null, winnerIds };
}

/**
 * `GET matches/:id` and the bodies of create / update: the member or guest view of `matchId` as
 * seen by `actorId`. Throws when the match vanished, which cannot happen for an authorized
 * caller inside the same transaction.
 */
export async function loadMatchDetail(
  db: DbReader,
  matchId: string,
  actorId: string,
  projection: Projection,
  now: Date,
  media: MediaUrlOf,
): Promise<MatchDetail> {
  const [row] = await db
    .select({
      ...matchSummaryColumns(db),
      teamName: teams.name,
    })
    .from(matches)
    .innerJoin(teams, eq(teams.id, matches.teamId))
    .leftJoin(venues, eq(venues.id, matches.venueId))
    .leftJoin(ownRsvp, ownRsvpJoin(actorId))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (row === undefined) {
    throw new Error('authorized match is not visible');
  }
  const participants = await loadParticipants(db, matchId);
  const mvp = await loadMvp(
    db,
    { id: row.id, status: row.status, closesAt: row.mvpVoteClosesAt },
    actorId,
    now,
  );
  // Counts and share come from the participant rows themselves, so the share is always divided by
  // exactly the confirmed players the response lists (ADR-0036).
  const tally = (status: RsvpStatus): number =>
    participants.filter((participant) => participant.status === status).length;
  const counted: MatchSummaryRow = {
    ...row,
    inCount: tally('in'),
    maybeCount: tally('maybe'),
    outCount: tally('out'),
    waitlistCount: tally('waitlist'),
  };
  const share = baseShare(row.feeTotalMinor, counted.inCount);
  const myShare = exactShare(
    row.feeTotalMinor,
    participants.filter((participant) => participant.status === 'in').map((p) => p.userId),
    actorId,
  );
  const team = { id: row.teamId, name: row.teamName };

  if (projection === 'member') {
    const view: MatchMemberView = {
      projection: 'member',
      ...toMatchSummary(counted),
      team,
      sharePerPlayerMinor: share,
      myShareMinor: myShare,
      mvp,
      participants: participants.map((participant) => ({
        user: {
          id: participant.userId,
          displayName: participant.displayName,
          avatarUrl: participant.isTombstone ? null : media(participant.avatarKey),
          position: participant.position,
          level: participant.level,
        },
        status: participant.status,
        side: participant.side,
        paid: participant.paid,
      })),
    };
    return view;
  }

  const own = participants.find((participant) => participant.userId === actorId);
  if (own === undefined) {
    // A guest is defined by an RSVP on the match (matrix §1.3).
    throw new Error('match guest without an RSVP');
  }
  const myRsvp: OwnRsvp = {
    matchId: row.id,
    status: own.status,
    side: own.side,
    updatedAt: own.updatedAt.toISOString(),
  };
  const view: MatchGuestView = {
    projection: 'guest',
    id: row.id,
    team,
    venue: venueOf(row),
    venueText: row.venueText,
    startsAt: row.startsAt.toISOString(),
    format: row.format,
    status: row.status,
    mvpVoteClosesAt: row.mvpVoteClosesAt?.toISOString() ?? null,
    sharePerPlayerMinor: share,
    myShareMinor: myShare,
    myRsvp,
    mvp,
    participants: participants.map((participant) => ({
      user: {
        id: participant.userId,
        displayName: participant.displayName,
        avatarUrl: participant.isTombstone ? null : media(participant.avatarKey),
        position: participant.position,
      },
      status: participant.status,
      side: participant.side,
    })),
  };
  return view;
}
