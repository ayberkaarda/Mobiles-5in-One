import { type MvpVoteRequest, type MvpVoteResponse } from '@kadro/contracts';
import { matches, matchRsvps, mvpVotes, users } from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { loadMatchRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { actorIdOf } from '../teams/context';
import { lockMatch, type MatchRequest } from './context';

/**
 * `POST matches/:id/mvp-vote` (every participant; authorization matrix footnote 17, ADR-0036).
 * Order: participant scope (404) → `mvp.vote` → match `played` and `now < mvp_vote_closes_at`
 * (409 `mvp_vote_closed`) → voter confirmed on the match (409 `player_not_confirmed`) → votee
 * another confirmed, live participant (409 `invalid_votee`) → one final vote per voter (409
 * `already_voted`, also the unique index under a race). The response confirms the actor's own
 * vote only; tallies stay hidden until the window closes.
 */
export async function voteMvp(
  { ctx, runtime }: MatchRequest,
  matchId: string,
  body: MvpVoteRequest,
): Promise<MvpVoteResponse> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const relation = await loadMatchRelation(tx, actorId, matchId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('mvp.vote', relation.facts);
    const [match] = await tx
      .select({ status: matches.status, closesAt: matches.mvpVoteClosesAt })
      .from(matches)
      .where(eq(matches.id, relation.matchId));
    const now = runtime.now();
    if (
      match?.status !== 'played' ||
      match.closesAt === null ||
      now.getTime() >= match.closesAt.getTime()
    ) {
      throw new ApiError('mvp_vote_closed');
    }
    if (relation.rsvpStatus !== 'in') {
      throw new ApiError('player_not_confirmed');
    }
    if (body.voteeId.toLowerCase() === actorId.toLowerCase()) {
      throw new ApiError('invalid_votee');
    }
    const [votee] = await tx
      .select({ userId: matchRsvps.userId })
      .from(matchRsvps)
      .innerJoin(users, eq(users.id, matchRsvps.userId))
      .where(
        and(
          eq(matchRsvps.matchId, relation.matchId),
          eq(matchRsvps.userId, body.voteeId),
          eq(matchRsvps.status, 'in'),
          eq(users.isTombstone, false),
        ),
      )
      .limit(1);
    if (votee === undefined) {
      throw new ApiError('invalid_votee');
    }
    const [existing] = await tx
      .select({ id: mvpVotes.id })
      .from(mvpVotes)
      .where(and(eq(mvpVotes.matchId, relation.matchId), eq(mvpVotes.voterId, actorId)))
      .limit(1);
    if (existing !== undefined) {
      throw new ApiError('already_voted');
    }
    await tx
      .insert(mvpVotes)
      .values({ matchId: relation.matchId, voterId: actorId, voteeId: votee.userId });
    return { matchId: relation.matchId, voteeId: votee.userId };
  });
}
