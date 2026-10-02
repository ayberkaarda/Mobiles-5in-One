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

/** How long a worker transaction waits for a lock before failing with SQLSTATE 55P03. */
export const LOCK_TIMEOUT_MS = 5_000;

/**
 * Bounds every lock wait (row, advisory) of the caller's transaction to `timeoutMs`, so a blocked
 * lock fails fast with `lock_not_available` (55P03) instead of hanging a worker; the job is
 * retried. Transaction-local: it ends with the commit or rollback. Run it as the first statement.
 */
export async function setLockTimeout(
  tx: Transaction,
  timeoutMs: number = LOCK_TIMEOUT_MS,
): Promise<void> {
  await tx.execute(sql`select set_config('lock_timeout', ${String(Math.trunc(timeoutMs))}, true)`);
}

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
 * Account hard delete (ADR-0032, ADR-0044): the first lock of the deletion transaction (after `setLockTimeout`). Waits
 * until every producer transaction that recorded a change for this user has ended (a producer keeps
 * its shared lock until its commit or rollback), and makes later ones skip until the deletion has
 * committed or rolled back. Taken before any other lock, so it never waits while
 * holding one.
 */
export async function lockPushRecipientForDeletion(tx: Transaction, userId: string): Promise<void> {
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
 * whether the change was recorded. Takes a transaction only: on the pool each statement would
 * commit on its own and release the lock before the check and the insert.
 */
export async function recordPushResendForRecipient(
  tx: Transaction,
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
