import { sql } from 'drizzle-orm';

import { type Database, type Transaction } from './client.js';
import { type CoalescedPushType, pushResends } from './schema/index.js';

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
