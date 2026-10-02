import { type RegisterPushTokenRequest } from '@kadro/contracts';
import { pushTokens, type Transaction } from '@kadro/db';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';
import { actorIdOf } from '../teams/context';

/**
 * `POST me/push-tokens` (authorization matrix §3.2, ADR-0031). The owner is always the session's
 * user. The body schema accepts only the Expo token format (`ExponentPushToken[…]` /
 * `ExpoPushToken[…]`, at most 256 characters); anything else is 400 before this code runs.
 *
 * - A token already stored for the caller is refreshed (`platform`, `last_seen_at`): the app calls
 *   this on every start, and `maintenance.sweep` removes tokens unseen for 60 days.
 * - A token bound to another user is re-bound to the caller (the device changed hands): the old
 *   binding disappears, it is never shared.
 * - A user keeps at most {@link MAX_PUSH_TOKENS_PER_USER} devices; registering one more removes
 *   the least recently seen.
 *
 * The token value is never logged and never written to the audit trail.
 */

export const MAX_PUSH_TOKENS_PER_USER = 10;

export interface AccountRequest {
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

/** Serializes the token writes of one user, so the device cap holds under concurrency. */
async function lockUserTokens(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`push-tokens:${userId}`}, 0))`,
  );
}

export async function registerPushToken(
  { ctx, runtime }: AccountRequest,
  body: RegisterPushTokenRequest,
): Promise<void> {
  await ctx.authorize('pushToken.register');
  const actorId = actorIdOf(ctx);
  await runtime.db.transaction(async (tx) => {
    const now = runtime.now();
    await lockUserTokens(tx, actorId);
    const [previous] = await tx
      .select({ id: pushTokens.id, userId: pushTokens.userId })
      .from(pushTokens)
      .where(eq(pushTokens.expoToken, body.expoToken))
      .for('update');
    const [stored] = await tx
      .insert(pushTokens)
      .values({
        userId: actorId,
        expoToken: body.expoToken,
        platform: body.platform,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pushTokens.expoToken,
        set: { userId: actorId, platform: body.platform, lastSeenAt: now, updatedAt: now },
      })
      .returning({ id: pushTokens.id });
    if (stored === undefined) {
      throw new Error('push token upsert returned no row');
    }

    const keep = await tx
      .select({ id: pushTokens.id })
      .from(pushTokens)
      .where(eq(pushTokens.userId, actorId))
      .orderBy(desc(pushTokens.lastSeenAt), desc(pushTokens.id))
      .limit(MAX_PUSH_TOKENS_PER_USER);
    const evicted = await tx
      .delete(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, actorId),
          notInArray(
            pushTokens.id,
            keep.map((row) => row.id),
          ),
        ),
      )
      .returning({ id: pushTokens.id });

    const rebound = previous !== undefined && previous.userId !== actorId;
    if (previous === undefined || rebound || evicted.length > 0) {
      await recordAudit(tx, runtime.keyedHash, {
        actorId,
        action: 'pushToken.register',
        targetType: 'push_token',
        targetId: stored.id,
        ip: ctx.ip,
        metadata: { platform: body.platform, rebound, evicted: evicted.length },
      });
    }
  });
}
