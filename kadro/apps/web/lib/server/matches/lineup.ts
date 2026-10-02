import { type LineupResponse, type LineupSide, type SetLineupRequest } from '@kadro/contracts';
import { matchRsvps } from '@kadro/db';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';

import { loadLineupRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { actorIdOf } from '../teams/context';
import { lockMatch, type MatchRequest } from './context';

/**
 * `PUT matches/:id/lineup` (captain, co-captain; authorization matrix footnote 15, ADR-0035). The
 * body replaces the whole lineup in one transaction under the team and match locks: listed players
 * get their side, every other confirmed player's side is cleared. Order of checks: participant
 * scope (404) → `lineup.set` (403 for players and guests) → match `open` or `locked` (409
 * `match_state_conflict`) → every user confirmed (`in`) and not a deleted account (409
 * `lineup_invalid_player`) → at most `ceil(slots / 2)` per side (409 `lineup_side_full`).
 */
export async function setLineup(
  { ctx, runtime }: MatchRequest,
  matchId: string,
  body: SetLineupRequest,
): Promise<LineupResponse> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const relation = await loadLineupRelation(tx, actorId, matchId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('lineup.set', relation.facts);
    if (relation.status !== 'open' && relation.status !== 'locked') {
      throw new ApiError('match_state_conflict');
    }
    const eligible = new Set(
      relation.confirmed.filter((player) => !player.isTombstone).map((player) => player.userId),
    );
    if (!body.sides.every((assignment) => eligible.has(assignment.userId))) {
      throw new ApiError('lineup_invalid_player');
    }
    const bySide = (side: LineupSide): string[] =>
      body.sides.filter((assignment) => assignment.side === side).map((item) => item.userId);
    const sideA = bySide('A');
    const sideB = bySide('B');
    if (sideA.length > relation.maxPerSide || sideB.length > relation.maxPerSide) {
      throw new ApiError('lineup_side_full');
    }

    const now = runtime.now();
    await tx
      .update(matchRsvps)
      .set({ side: null, updatedAt: now })
      .where(and(eq(matchRsvps.matchId, relation.matchId), isNotNull(matchRsvps.side)));
    for (const [side, userIds] of [
      ['A', sideA],
      ['B', sideB],
    ] as const) {
      if (userIds.length === 0) {
        continue;
      }
      const updated = await tx
        .update(matchRsvps)
        .set({ side, updatedAt: now })
        .where(
          and(
            eq(matchRsvps.matchId, relation.matchId),
            eq(matchRsvps.status, 'in'),
            inArray(matchRsvps.userId, userIds),
          ),
        )
        .returning({ id: matchRsvps.id });
      if (updated.length !== userIds.length) {
        // The roster was read under the same locks, so this is a server bug, never client input.
        throw new Error('lineup update did not match the confirmed roster');
      }
    }

    const stored = await tx
      .select({ userId: matchRsvps.userId, side: matchRsvps.side })
      .from(matchRsvps)
      .where(and(eq(matchRsvps.matchId, relation.matchId), isNotNull(matchRsvps.side)))
      .orderBy(asc(matchRsvps.createdAt), asc(matchRsvps.id));
    return {
      matchId: relation.matchId,
      sides: stored.flatMap((row) =>
        row.side === null ? [] : [{ userId: row.userId, side: row.side }],
      ),
    };
  });
}
