import {
  matches,
  matchRsvps,
  openCallApplications,
  openCalls,
  teamMembers,
  type Transaction,
} from '@kadro/db';
import { and, count, eq, inArray } from 'drizzle-orm';

import { type DbReader } from '../domain/relations';
import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';
import { lockTeam } from '../teams/context';

export { actorIdOf } from '../teams/context';

/**
 * Shared plumbing of the open-call and application services (product spec §3 story 6,
 * authorization matrix §3.5, ADR-0003, ADR-0037).
 *
 * Lock order. Every write that touches a call takes row locks in one fixed order: the team row,
 * then the match row, then the open-call row, then the application row. Team and member
 * mutations lock the team row before match rows (lib/server/teams), so the two families can never
 * wait on each other in opposite orders. Holding the team row also serializes the "applicant is
 * not a member" check of ADR-0003 against a concurrent invite acceptance.
 */

/** What every open-call service receives from its Route Handler. */
export interface CallRequest {
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

/** Immutable ids of the match and team a call belongs to (server-only columns, never rewritten). */
export interface CallChain {
  readonly openCallId: string;
  readonly matchId: string;
  readonly teamId: string;
}

/**
 * Ids of the match and team behind a call, read without locks only to know which rows to lock.
 * `null` for an unknown call; authorization happens on the facts loaded under the locks.
 */
export async function callChain(db: DbReader, openCallId: string): Promise<CallChain | null> {
  const [row] = await db
    .select({ openCallId: openCalls.id, matchId: matches.id, teamId: matches.teamId })
    .from(openCalls)
    .innerJoin(matches, eq(matches.id, openCalls.matchId))
    .where(eq(openCalls.id, openCallId))
    .limit(1);
  return row ?? null;
}

/** Team id of a match, read without locks only to know which team row to lock first. */
export async function matchTeamId(db: DbReader, matchId: string): Promise<string | null> {
  const [row] = await db
    .select({ teamId: matches.teamId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  return row?.teamId ?? null;
}

/** Team row, then match row (`SELECT … FOR UPDATE`). */
export async function lockMatch(tx: Transaction, teamId: string, matchId: string): Promise<void> {
  await lockTeam(tx, teamId);
  await tx.select({ id: matches.id }).from(matches).where(eq(matches.id, matchId)).for('update');
}

/** Team row, match row, then the call row. */
export async function lockCall(tx: Transaction, chain: CallChain): Promise<void> {
  await lockMatch(tx, chain.teamId, chain.matchId);
  await tx
    .select({ id: openCalls.id })
    .from(openCalls)
    .where(eq(openCalls.id, chain.openCallId))
    .for('update');
}

/** Application row inside its call (the caller already holds the call chain locks). */
export async function lockApplication(
  tx: Transaction,
  openCallId: string,
  applicationId: string,
): Promise<void> {
  await tx
    .select({ id: openCallApplications.id })
    .from(openCallApplications)
    .where(
      and(
        eq(openCallApplications.id, applicationId),
        eq(openCallApplications.openCallId, openCallId),
      ),
    )
    .for('update');
}

/** Captain and co-captains of a team: recipients of `application.received` (ADR-0031). */
export async function teamStaffIds(db: DbReader, teamId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), inArray(teamMembers.role, ['captain', 'co_captain'])),
    );
  return rows.map((row) => row.userId);
}

/** Confirmed (`in`) players of a match. */
export async function confirmedCount(db: DbReader, matchId: string): Promise<number> {
  const [row] = await db
    .select({ players: count() })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.status, 'in')));
  return row?.players ?? 0;
}

/** Whether `userId` is a member of the team or holds any RSVP on the match (ADR-0003 rule 4). */
export async function isParticipant(
  db: DbReader,
  teamId: string,
  matchId: string,
  userId: string,
): Promise<boolean> {
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  if (member !== undefined) {
    return true;
  }
  const [rsvp] = await db
    .select({ id: matchRsvps.id })
    .from(matchRsvps)
    .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, userId)))
    .limit(1);
  return rsvp !== undefined;
}
