import { type PushSendJob } from '@kadro/contracts';
import {
  COALESCED_PUSH_TYPES,
  type CoalescedPushType,
  type Database,
  lockPushResend,
  pushResends,
  setLockTimeout,
} from '@kadro/db';
import { and, eq, lte } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';

import { MINUTE_MS } from '../clock.js';
import { bossExecutor, enqueue } from '../enqueue.js';
import { type JobContext } from '../job-runner.js';

/**
 * Re-send of a coalesced push after an active delivery (ADR-0044).
 *
 * The `exclusive` policy drops a coalesced enqueue while a job with the same key is queued,
 * retrying or active. The web producer then records the change in `push_resends` under the key's
 * advisory lock. The handler reads the row's `version` before it reads the state it renders, and
 * after delivery completes its own job inside one transaction that takes the same lock: a row
 * whose version is still the one read was covered by this delivery and is deleted; a newer one
 * came after the state read and becomes the next window's job. Completing the job in that
 * transaction is what lets the follow-up job take the same coalescing key, and the lock means a
 * producer either commits its row before the check or finds the job completed and enqueues itself.
 */

const SEND_QUEUE = 'push.send';

/** Delay of a coalesced notification (ADR-0031), as in the web producer. */
export const COALESCE_DELAY_MS = 10 * MINUTE_MS;

export interface CoalescedJob {
  readonly type: CoalescedPushType;
  readonly singletonKey: string;
}

/** The coalescing key of a coalesced push job, or `null` for every other push. */
export function coalescedJob(job: PushSendJob, context: JobContext): CoalescedJob | null {
  const type = COALESCED_PUSH_TYPES.find((candidate) => candidate === job.type);
  const key = context.singletonKey;
  if (type === undefined || key === null || key === job.idempotencyKey) {
    return null;
  }
  return { type, singletonKey: key };
}

/** Epoch milliseconds of the window a coalesced job delivers (`<singletonKey>:<ms>`), or 0. */
function windowOpenedAt(job: PushSendJob, coalesced: CoalescedJob): number {
  const prefix = `${coalesced.singletonKey}:`;
  if (!job.idempotencyKey.startsWith(prefix)) {
    return 0;
  }
  const opened = Number(job.idempotencyKey.slice(prefix.length));
  return Number.isSafeInteger(opened) ? opened : 0;
}

/** Version of the pending row before the state is read; `0` when there is none. */
export async function readResendVersion(db: Database, singletonKey: string): Promise<number> {
  const [row] = await db
    .select({ version: pushResends.version })
    .from(pushResends)
    .where(eq(pushResends.singletonKey, singletonKey));
  return row?.version ?? 0;
}

export type SettleResult =
  /** No change was dropped after the state read. */
  | 'covered'
  /** A change came after the state read; the next window's job was enqueued. */
  | 'resent'
  /** This attempt no longer holds the job (expired and retried); that attempt settles. */
  | 'claim_lost';

/**
 * Completes the job and carries a later change forward, in one transaction under the key's lock.
 * `seenVersion` is what {@link readResendVersion} returned before the state was read.
 */
export async function settleCoalesced(
  dependencies: {
    readonly db: Database;
    readonly boss: PgBoss;
    readonly now: Date;
    /** Lock wait bound; defaults to the database package's `LOCK_TIMEOUT_MS`. */
    readonly lockTimeoutMs?: number;
  },
  job: PushSendJob,
  coalesced: CoalescedJob,
  context: JobContext,
  outcome: string,
  seenVersion: number,
): Promise<{ readonly result: SettleResult; readonly nextJobId?: string | null }> {
  const { db, boss, now, lockTimeoutMs } = dependencies;
  return db.transaction(async (tx) => {
    await setLockTimeout(tx, lockTimeoutMs);
    await lockPushResend(tx, coalesced.singletonKey);
    const completion = await boss.complete(
      SEND_QUEUE,
      [{ id: context.jobId, retryCount: context.retryCount }],
      { outcome },
      { db: bossExecutor(tx) },
    );
    if ((completion as { readonly affected?: number }).affected !== 1) {
      return { result: 'claim_lost' } as const;
    }

    const covered = await tx
      .delete(pushResends)
      .where(
        and(
          eq(pushResends.singletonKey, coalesced.singletonKey),
          lte(pushResends.version, seenVersion),
        ),
      )
      .returning({ id: pushResends.id });
    const [pending] = await tx
      .select({
        id: pushResends.id,
        userId: pushResends.userId,
        refId: pushResends.refId,
        requestedAt: pushResends.requestedAt,
      })
      .from(pushResends)
      .where(eq(pushResends.singletonKey, coalesced.singletonKey));
    if (pending === undefined) {
      context.logger.debug({ coveredChanges: covered.length > 0 }, 'coalesced push settled');
      return { result: 'covered' } as const;
    }

    // The next window opens now (never before the change, never at this job's window), so two
    // deliveries of one key stay at least the coalescing delay apart and the delivery key is new.
    const opened = new Date(
      Math.max(now.getTime(), pending.requestedAt.getTime(), windowOpenedAt(job, coalesced) + 1),
    );
    const nextJobId = await enqueue(
      boss,
      SEND_QUEUE,
      {
        type: coalesced.type,
        userId: pending.userId,
        refId: pending.refId,
        idempotencyKey: `${coalesced.singletonKey}:${opened.getTime()}`,
      },
      {
        tx,
        singletonKey: coalesced.singletonKey,
        startAfter: new Date(opened.getTime() + COALESCE_DELAY_MS),
      },
    );
    if (nextJobId !== null) {
      // Otherwise a queued job already holds the key and claims the row when it runs.
      await tx.delete(pushResends).where(eq(pushResends.id, pending.id));
    }
    context.logger.info(
      { childQueue: SEND_QUEUE, childJobId: nextJobId },
      'coalesced push re-send enqueued',
    );
    return { result: 'resent', nextJobId } as const;
  });
}
