import { type MeStatsResponse } from '@kadro/contracts';
import { matches, matchRsvps, mvpVotes } from '@kadro/db';
import { and, count, eq, gt, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type ServerRuntime } from '../runtime';

/**
 * `GET me/stats` (spec §3 items 9 and 10, authorization matrix §7, ADR-0063 decision 8,
 * ADR-0065). Every value is computed from stored rows in one query. The tier follows the caller's
 * entitlement at request time, loaded with the principal: `basic` (matches played, MVP count) for
 * everyone, `full` with the `advanced` block only for Pro.
 *
 * - Played match: `matches.status = 'played'` with the caller's RSVP `in`.
 * - MVP: a played match whose vote window has closed and whose highest vote count (above zero)
 *   names the caller; ties count for every winner, as in the match projection (ADR-0036).
 * - Last 30 days: played matches whose `starts_at` lies within 30 days before `now`.
 * - Attendance: the caller's `in` rows among all of the caller's RSVP rows on played matches.
 */

const DAY_MS = 86_400_000;
const RECENT_DAYS = 30;

const ownVote = alias(mvpVotes, 'own_vote');
const anyVote = alias(mvpVotes, 'any_vote');

interface StatsRow {
  readonly played: number;
  readonly rsvpRows: number;
  readonly playedRecent: number;
  readonly mvp: number;
  readonly venues: number;
  readonly teams: number;
}

async function loadStatsRow(runtime: ServerRuntime, userId: string, now: Date): Promise<StatsRow> {
  const since = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const confirmed = eq(matchRsvps.status, 'in');
  // Votes for the caller on the match, compared with the count of every votee on it.
  const ownVotes = sql`(${runtime.db
    .select({ votes: count() })
    .from(ownVote)
    .where(and(eq(ownVote.matchId, matches.id), eq(ownVote.voteeId, userId)))})`;
  const everyVotee = runtime.db
    .select({ votes: count() })
    .from(anyVote)
    .where(eq(anyVote.matchId, matches.id))
    .groupBy(anyVote.voteeId);
  const isMvp = sql`${lte(matches.mvpVoteClosesAt, now)} and ${ownVotes} > 0 and ${ownVotes} >= all (${everyVotee})`;
  const [row] = await runtime.db
    .select({
      played: sql<number>`count(*) filter (where ${confirmed})`.mapWith(Number),
      rsvpRows: sql<number>`count(*)`.mapWith(Number),
      playedRecent:
        sql<number>`count(*) filter (where ${confirmed} and ${gt(matches.startsAt, since)})`.mapWith(
          Number,
        ),
      mvp: sql<number>`count(*) filter (where ${confirmed} and ${isMvp})`.mapWith(Number),
      venues: sql<number>`count(distinct ${matches.venueId}) filter (where ${confirmed})`.mapWith(
        Number,
      ),
      teams: sql<number>`count(distinct ${matches.teamId}) filter (where ${confirmed})`.mapWith(
        Number,
      ),
    })
    .from(matchRsvps)
    .innerJoin(matches, eq(matches.id, matchRsvps.matchId))
    .where(and(eq(matchRsvps.userId, userId), eq(matches.status, 'played')));
  return row ?? { played: 0, rsvpRows: 0, playedRecent: 0, mvp: 0, venues: 0, teams: 0 };
}

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.min(1, part / whole);
}

/** The caller's statistics; `isPro` is the principal's entitlement at request time. */
export async function readMyStats(
  runtime: ServerRuntime,
  userId: string,
  isPro: boolean,
): Promise<MeStatsResponse> {
  const row = await loadStatsRow(runtime, userId, runtime.now());
  const basic = { matchesPlayed: row.played, mvpCount: row.mvp };
  if (!isPro) {
    return { tier: 'basic', ...basic };
  }
  return {
    tier: 'full',
    ...basic,
    advanced: {
      matchesPlayedLast30Days: row.playedRecent,
      mvpRate: ratio(row.mvp, row.played),
      attendanceRate: ratio(row.played, row.rsvpRows),
      distinctVenues: row.venues,
      distinctTeams: row.teams,
    },
  };
}
