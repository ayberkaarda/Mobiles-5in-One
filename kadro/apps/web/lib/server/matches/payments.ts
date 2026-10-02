import { type MarkPaymentRequest, type PaymentResponse } from '@kadro/contracts';
import { matchRsvps } from '@kadro/db';
import { and, eq } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { loadPaymentTargetRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { actorIdOf } from '../teams/context';
import { lockMatch, type MatchRequest } from './context';

/**
 * `PATCH matches/:id/payments/:userId` (captain, co-captain; authorization matrix footnote 16,
 * ADR-0006, ADR-0013). Order: the match through the participant scope (404) → `payment.mark`
 * (players and guests 403, a co-captain on their own share 403) → the target's RSVP inside that
 * match (404) → match `locked` or `played` (409 `match_state_conflict`) → target confirmed (409
 * `player_not_confirmed`). Every successful call, setting or clearing, writes one `audit_logs`
 * row in the same transaction; when the audit insert fails the update rolls back with it.
 */
export async function markPayment(
  { ctx, runtime }: MatchRequest,
  matchId: string,
  userId: string,
  body: MarkPaymentRequest,
): Promise<PaymentResponse> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const relation = await loadPaymentTargetRelation(tx, actorId, matchId, userId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('payment.mark', relation.facts);
    const { target } = relation;
    if (target === null) {
      throw new ApiError('not_found');
    }
    if (relation.status !== 'locked' && relation.status !== 'played') {
      throw new ApiError('match_state_conflict');
    }
    if (!target.confirmed) {
      throw new ApiError('player_not_confirmed');
    }
    const [updated] = await tx
      .update(matchRsvps)
      .set({ paid: body.paid, updatedAt: runtime.now() })
      .where(
        and(
          eq(matchRsvps.matchId, relation.matchId),
          eq(matchRsvps.userId, target.userId),
          eq(matchRsvps.status, 'in'),
        ),
      )
      .returning({ id: matchRsvps.id, paid: matchRsvps.paid, updatedAt: matchRsvps.updatedAt });
    if (updated === undefined) {
      throw new Error('confirmed payment target disappeared under the match lock');
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'payment.mark',
      targetType: 'match_rsvp',
      targetId: updated.id,
      ip: ctx.ip,
      metadata: {
        matchId: relation.matchId,
        targetUserId: target.userId,
        paid: updated.paid,
        selfMark: relation.facts.isSelf,
      },
    });
    return {
      matchId: relation.matchId,
      userId: target.userId,
      paid: updated.paid,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}
