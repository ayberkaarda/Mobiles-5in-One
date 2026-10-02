import {
  type Database,
  deletionRequests,
  emailTokens,
  jobReceipts,
  pushResends,
  pushTokens,
  rateLimitBuckets,
  refreshTokens,
} from '@kadro/db';
import { type SQL, and, asc, inArray, isNull, lt, or } from 'drizzle-orm';
import { type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { type PgBoss } from 'pg-boss';

import { type Clock, DAY_MS, HOUR_MS } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { type JobContext } from '../job-runner.js';
import { type Buckets, type ObjectStorage } from '../storage/storage.js';
import { sweepOrphanMedia } from '../uploads/orphans.js';
import { closeStuckUploads, expireStaleUploads } from '../uploads/process.js';

/** Rows deleted per statement; each step loops until a statement deletes fewer. */
export const SWEEP_BATCH = 5_000;
const MAX_ROUNDS = 200;

export const RETENTION = {
  /** Revoked or expired refresh tokens (docs/ops/worker.md). */
  refreshTokensMs: 30 * DAY_MS,
  rateLimitWindowsMs: 2 * DAY_MS,
  jobReceiptsMs: 30 * DAY_MS,
  /**
   * Pending push re-sends (ADR-0044). A row lives until the job holding its key completes, minutes
   * later; one this old was left by a dead-lettered job, and its push would be stale (6 h) anyway.
   */
  pushResendsMs: DAY_MS,
  /** Push tokens whose app has not checked in (ADR-0031). */
  pushTokensUnseenMs: 60 * DAY_MS,
  /** Deletion requests overdue by this much are re-queued (ADR-0028, ADR-0032). */
  overdueDeletionMs: HOUR_MS,
} as const;

export interface SweepDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly clock: Clock;
  readonly storage: ObjectStorage;
  readonly buckets: Buckets;
}

export interface SweepResult {
  readonly emailTokens: number;
  readonly refreshTokens: number;
  readonly rateLimitBuckets: number;
  readonly jobReceipts: number;
  readonly pushResends: number;
  readonly pushTokens: number;
  readonly deletionsRequeued: number;
  readonly uploadsExpired: number;
  /** Uploads stuck in `processing` without a live job (ADR-0030). */
  readonly uploadsClosed: number;
  readonly uploadsRetired: number;
  readonly mediaObjectsDeleted: number;
}

async function deleteInBatches(
  db: Database,
  table: PgTable,
  id: PgColumn,
  condition: SQL | undefined,
): Promise<number> {
  let total = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const candidates = db.select({ id }).from(table).where(condition).limit(SWEEP_BATCH);
    const deleted = await db.delete(table).where(inArray(id, candidates)).returning({ id });
    total += deleted.length;
    if (deleted.length < SWEEP_BATCH) {
      break;
    }
  }
  return total;
}

/** `account.hard_delete` key, identical to the one the web app uses (ADR-0032). */
export function hardDeleteIdempotencyKey(deletionRequestId: string): string {
  return `delete:${deletionRequestId}`;
}

/**
 * `maintenance.sweep` (ADR-0028): removes expired or retired rows and re-queues overdue account
 * deletions, expires uploads left `pending` for an hour and removes orphan media objects (ADR-0030).
 */
export async function sweep(dependencies: SweepDependencies): Promise<SweepResult> {
  const { db, boss, clock } = dependencies;
  const now = clock.now().getTime();
  const before = (ms: number): Date => new Date(now - ms);

  const emailTokenRows = await deleteInBatches(
    db,
    emailTokens,
    emailTokens.id,
    lt(emailTokens.expiresAt, new Date(now)),
  );
  const refreshTokenRows = await deleteInBatches(
    db,
    refreshTokens,
    refreshTokens.id,
    or(
      lt(refreshTokens.revokedAt, before(RETENTION.refreshTokensMs)),
      lt(refreshTokens.expiresAt, before(RETENTION.refreshTokensMs)),
    ),
  );
  const bucketRows = await deleteInBatches(
    db,
    rateLimitBuckets,
    rateLimitBuckets.id,
    lt(rateLimitBuckets.windowStart, before(RETENTION.rateLimitWindowsMs)),
  );
  const receiptRows = await deleteInBatches(
    db,
    jobReceipts,
    jobReceipts.id,
    lt(jobReceipts.createdAt, before(RETENTION.jobReceiptsMs)),
  );
  const resendRows = await deleteInBatches(
    db,
    pushResends,
    pushResends.id,
    lt(pushResends.requestedAt, before(RETENTION.pushResendsMs)),
  );
  const pushTokenRows = await deleteInBatches(
    db,
    pushTokens,
    pushTokens.id,
    lt(pushTokens.lastSeenAt, before(RETENTION.pushTokensUnseenMs)),
  );

  const overdue = await db
    .select({ id: deletionRequests.id })
    .from(deletionRequests)
    .where(
      and(
        isNull(deletionRequests.completedAt),
        lt(deletionRequests.graceUntil, before(RETENTION.overdueDeletionMs)),
      ),
    )
    .orderBy(asc(deletionRequests.graceUntil))
    .limit(SWEEP_BATCH);
  let requeued = 0;
  for (const request of overdue) {
    const jobId = await enqueue(boss, 'account.hard_delete', {
      deletionRequestId: request.id,
      idempotencyKey: hardDeleteIdempotencyKey(request.id),
    });
    if (jobId !== null) {
      requeued += 1;
    }
  }

  const uploadsExpired = await expireStaleUploads({
    db,
    storage: dependencies.storage,
    buckets: dependencies.buckets,
    clock,
  });
  const uploadsClosed = await closeStuckUploads({
    db,
    storage: dependencies.storage,
    buckets: dependencies.buckets,
    clock,
  });
  const orphans = await sweepOrphanMedia({
    db,
    storage: dependencies.storage,
    buckets: dependencies.buckets,
    now: new Date(now),
  });

  return {
    uploadsExpired,
    uploadsClosed,
    uploadsRetired: orphans.uploadsRetired,
    mediaObjectsDeleted: orphans.objectsDeleted,
    emailTokens: emailTokenRows,
    refreshTokens: refreshTokenRows,
    rateLimitBuckets: bucketRows,
    jobReceipts: receiptRows,
    pushResends: resendRows,
    pushTokens: pushTokenRows,
    deletionsRequeued: requeued,
  };
}

export function createSweepHandler(dependencies: SweepDependencies) {
  return async (_job: unknown, context: JobContext): Promise<string> => {
    const result = await sweep(dependencies);
    context.logger.info(result, 'maintenance sweep finished');
    return 'swept';
  };
}
