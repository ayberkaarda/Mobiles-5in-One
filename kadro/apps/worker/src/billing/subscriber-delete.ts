import { setTimeout as sleep } from 'node:timers/promises';

import { type RevenueCatSubscriberDeleteJob } from '@kadro/contracts';
import { type Database, deletionRequests, users } from '@kadro/db';
import { eq, sql } from 'drizzle-orm';

import { type Clock } from '../clock.js';
import { insertReceipt } from '../idempotency.js';
import { type JobContext, TransientJobError } from '../job-runner.js';
import { type Metrics } from '../metrics.js';
import {
  type RevenueCatClient,
  RevenueCatApiError,
  type RevenueCatErrorReason,
  type SubscriberDeletion,
} from './revenuecat-client.js';

/**
 * RevenueCat subscriber deletion of an account hard delete (ADR-0082, ADR-0032 step 2). The hard
 * delete calls {@link deleteSubscriberWithRetry} under its locks; when that does not succeed it
 * still completes and enqueues `revenuecat.subscriber_delete`, handled below with the queue's
 * backoff. A RevenueCat failure never blocks or fails the database deletion.
 */

const QUEUE = 'revenuecat.subscriber_delete';

/** Bounded in-handler retry: transient failures (network, timeout, 429, 5xx) only. */
export interface SubscriberDeleteRetry {
  /** Total attempts, at least 1. */
  readonly attempts: number;
  /** Delay before the second attempt; doubles for each further attempt. */
  readonly baseDelayMs: number;
}

export const DEFAULT_SUBSCRIBER_DELETE_RETRY: SubscriberDeleteRetry = {
  attempts: 3,
  baseDelayMs: 1_000,
};

export type SubscriberDeleteResult =
  | { readonly ok: true; readonly outcome: SubscriberDeletion; readonly attempts: number }
  | {
      readonly ok: false;
      readonly reason: RevenueCatErrorReason | 'unknown';
      readonly status?: number;
      readonly attempts: number;
    };

function failureOf(error: unknown, attempts: number): SubscriberDeleteResult {
  if (error instanceof RevenueCatApiError) {
    return {
      ok: false,
      reason: error.reason,
      ...(error.status === undefined ? {} : { status: error.status }),
      attempts,
    };
  }
  return { ok: false, reason: 'unknown', attempts };
}

/** Deletes the subscriber; never throws. A permanent error (401/403, other 4xx) is not retried. */
export async function deleteSubscriberWithRetry(
  client: RevenueCatClient,
  userId: string,
  retry: SubscriberDeleteRetry,
  signal?: AbortSignal,
): Promise<SubscriberDeleteResult> {
  const attempts = Math.max(1, retry.attempts);
  for (let attempt = 1; ; attempt += 1) {
    try {
      const outcome = await client.deleteSubscriber(userId, signal);
      return { ok: true, outcome, attempts: attempt };
    } catch (error) {
      const transient = error instanceof RevenueCatApiError && error.transient;
      if (!transient || attempt >= attempts || signal?.aborted === true) {
        return failureOf(error, attempt);
      }
      const delayMs = retry.baseDelayMs * 2 ** (attempt - 1);
      try {
        await sleep(delayMs, undefined, signal ? { signal } : {});
      } catch {
        return failureOf(error, attempt);
      }
    }
  }
}

/** Metric labels of a failed deletion; the status is a number, never a body. */
export function failureLabels(
  result: Extract<SubscriberDeleteResult, { ok: false }>,
  stage: 'hard_delete' | 'follow_up',
): Record<string, string | number> {
  return {
    stage,
    reason: result.reason,
    attempts: result.attempts,
    ...(result.status === undefined ? {} : { status: result.status }),
  };
}

export interface SubscriberDeleteDependencies {
  readonly db: Database;
  readonly clock: Clock;
  readonly metrics: Metrics;
  /** `null` when `REVENUECAT_API_KEY` is not configured. */
  readonly client: RevenueCatClient | null;
}

/**
 * `revenuecat.subscriber_delete`: one deletion attempt per job run; a failure throws and the queue
 * retries with backoff (dead letter after the last retry). Runs only for a completed deletion
 * request that still records `revenuecat` as pending and whose account row is gone, so it can never
 * remove the subscriber of a live account. Success clears `revenuecat` from `external_pending`.
 */
export function createSubscriberDeleteHandler(dependencies: SubscriberDeleteDependencies) {
  const { db, clock, metrics, client } = dependencies;

  return async (job: RevenueCatSubscriberDeleteJob, context: JobContext): Promise<string> => {
    if (client === null) {
      context.logger.warn('revenuecat subscriber deletion skipped: no API key configured');
      return 'skipped_unconfigured';
    }
    const [request] = await db
      .select({
        completedAt: deletionRequests.completedAt,
        externalPending: deletionRequests.externalPending,
      })
      .from(deletionRequests)
      .where(eq(deletionRequests.id, job.deletionRequestId));
    if (request === undefined) {
      return 'skipped_missing';
    }
    if (request.completedAt === null) {
      return 'skipped_not_completed';
    }
    if (!request.externalPending.includes('revenuecat')) {
      return 'skipped_done';
    }
    const [account] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, job.appUserId));
    if (account !== undefined) {
      return 'skipped_account_exists';
    }

    const result = await deleteSubscriberWithRetry(
      client,
      job.appUserId,
      { attempts: 1, baseDelayMs: 0 },
      context.signal,
    );
    if (!result.ok) {
      metrics.increment('revenuecat_delete_failed', failureLabels(result, 'follow_up'));
      throw new TransientJobError(
        result.status === undefined
          ? `revenuecat delete ${result.reason}`
          : `revenuecat delete ${result.reason} ${result.status}`,
      );
    }

    const now = clock.now();
    await db.transaction(async (tx) => {
      await tx
        .update(deletionRequests)
        .set({
          externalPending: sql`array_remove(${deletionRequests.externalPending}, 'revenuecat')`,
          updatedAt: now,
        })
        .where(eq(deletionRequests.id, job.deletionRequestId));
      await insertReceipt(tx, QUEUE, job.idempotencyKey);
    });
    return result.outcome;
  };
}
