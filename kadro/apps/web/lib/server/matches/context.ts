import { type Transaction, matches, teamMembers } from '@kadro/db';
import { and, eq, inArray } from 'drizzle-orm';

import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';
import { lockTeam } from '../teams/context';

/** What every match, RSVP, lineup, payment and MVP service receives from its Route Handler. */
export interface MatchRequest {
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Row locks of a match write, in the order every team and match mutation uses: the team row first
 * (`lockTeam`, as membership changes do), then the match row. Holding both serializes RSVPs,
 * lineups, payment marks, votes, status changes and member removals of the same team, so the
 * relationship facts loaded afterwards, the state checks and the write see one consistent state
 * (ADR-0035: no over-booking, deterministic promotion). `team_id` of a match is immutable, so
 * reading it before the locks is safe. A malformed or unknown id locks nothing; the relation
 * loader then answers `null` and the caller 404.
 */
export async function lockMatch(tx: Transaction, matchId: string): Promise<void> {
  if (!isUuid(matchId)) {
    return;
  }
  const [row] = await tx
    .select({ teamId: matches.teamId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (row === undefined) {
    return;
  }
  await lockTeam(tx, row.teamId);
  await tx.select({ id: matches.id }).from(matches).where(eq(matches.id, matchId)).for('update');
}

/** Captain and co-captains of a team: recipients of `rsvp.changed` (ADR-0031). */
export async function teamStaffIds(tx: Transaction, teamId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(
      and(eq(teamMembers.teamId, teamId), inArray(teamMembers.role, ['captain', 'co_captain'])),
    );
  return rows.map((row) => row.userId);
}
