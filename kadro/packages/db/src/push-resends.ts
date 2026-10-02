import { eq, sql } from 'drizzle-orm';

import { type Database, type Transaction } from './client.js';
import { type CoalescedPushType, pushResends, users } from './schema/index.js';

/**
 * Pending re-sends of coalesced pushes (ADR-0044). The web producer and the worker both serialize
 * on one transaction-scoped advisory lock per coalescing key: the producer around its enqueue and
 * the row it writes when the enqueue is dropped, the worker around the completion of the job and
 * the check of that row. Either the producer's row is visible to the completing worker, or the job
 * has completed before the producer enqueues and the enqueue is no longer dropped.
 */

type Executor = Database | Transaction;

/** Takes the per-key lock until the end of the caller's transaction. */
export async function lockPushResend(tx: Executor, singletonKey: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`push-resend:${singletonKey}`}, 0))`,
  );
}

export interface PushResendRequest {
  readonly singletonKey: string;
  readonly type: CoalescedPushType;
  readonly userId: string;
  readonly refId: string;
  /** Moment of the dropped change. */
  readonly requestedAt: Date;
}

function recipientLockKey(userId: string) {
  return `push-recipient:${userId}`;
}

/**
 * Account hard delete (ADR-0032, ADR-0044): the first statement of the deletion transaction. Waits
 * for producers that are recording a change for this user, and makes later ones skip until the
 * deletion has committed or rolled back. Taken before any other lock, so it never waits while
 * holding one.
 */
export async function lockPushRecipientForDeletion(tx: Executor, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${recipientLockKey(userId)}, 0))`,
  );
}

/**
 * Records a dropped change unless its recipient is gone or being deleted (ADR-0044). The shared
 * recipient lock is only tried, never waited for, so a producer holding domain locks cannot wait
 * on a deletion that holds them too; failing to get it means a deletion is running. Under the
 * shared lock the user row is still there exactly when no deletion has committed, and a deletion
 * that starts later waits for this transaction and then deletes the row recorded here. Returns
 * whether the change was recorded.
 */
export async function recordPushResendForRecipient(
  tx: Executor,
  request: PushResendRequest,
): Promise<boolean> {
  const locked = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock_shared(hashtextextended(${recipientLockKey(request.userId)}, 0)) as locked`,
  );
  if (locked.rows[0]?.locked !== true) {
    return false;
  }
  const [recipient] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, request.userId));
  if (recipient === undefined) {
    return false;
  }
  await recordPushResend(tx, request);
  return true;
}

/**
 * Records a dropped change. A pending row keeps its first `requested_at` and `ref_id` and counts
 * the change in `version`.
 */
export async function recordPushResend(tx: Executor, request: PushResendRequest): Promise<void> {
  await tx
    .insert(pushResends)
    .values({ ...request })
    .onConflictDoUpdate({
      target: pushResends.singletonKey,
      set: { version: sql`${pushResends.version} + 1`, updatedAt: sql`now()` },
    });
}
