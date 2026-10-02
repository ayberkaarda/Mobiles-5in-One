import { PRO_STATUSES, type SubscriptionReconcileJob } from '@kadro/contracts';
import { type Database, subscriptions, upsertSubscriptionIfNotStale, users } from '@kadro/db';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';
import { type Logger } from 'pino';

import { type Clock, MINUTE_MS } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { type JobContext, TransientJobError } from '../job-runner.js';
import { userReconcileKey } from './process.js';
import { type RevenueCatClient, RevenueCatApiError } from './revenuecat-client.js';
import { proProductOf } from './status.js';

/**
 * `subscription.reconcile` (ADR-0063): reads each subscriber from RevenueCat and corrects
 * `subscriptions`. The snapshot is written with its read time as the event time and no event id,
 * so it never overwrites a webhook event that is newer than the read. A Pro row the provider no
 * longer reports (purchases transferred away, subscription removed, unknown subscriber) is written
 * as `expired` under the same rule. Without an API key (`client: null`) the run is skipped and
 * logged.
 *
 * The nightly run (`userId: null`) walks every non-deleted user with a subscription row in
 * batches. A user whose read fails transiently is handed to a per-user job a few minutes later;
 * any other per-user failure is counted, logged and skipped; only a rejected key stops the run,
 * since every further read would fail too. A run that expires restarts from the first user.
 */

export const RECONCILE_BATCH = 100;
/** Delay of the per-user retry job enqueued for a user whose nightly read failed. */
export const RECONCILE_RETRY_DELAY_MS = 5 * MINUTE_MS;

export interface ReconcileDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly clock: Clock;
  /** `null` when `REVENUECAT_API_KEY` is not configured. */
  readonly client: RevenueCatClient | null;
}

export interface UserReconcileResult {
  /** Subscription rows written from the snapshot. */
  readonly applied: number;
  /** Rows left alone because a newer webhook event decided them. */
  readonly stale: number;
  /** Snapshot entries outside Kadro Pro. */
  readonly skipped: number;
  /** Pro rows the snapshot no longer contains, written as `expired`. */
  readonly expired: number;
  /** RevenueCat does not know the user. */
  readonly notFound: boolean;
}

export async function reconcileUser(
  dependencies: ReconcileDependencies & { readonly client: RevenueCatClient },
  userId: string,
  signal?: AbortSignal,
): Promise<UserReconcileResult> {
  const { db, clock } = dependencies;
  const snapshot = await dependencies.client.getSubscriber(userId, signal);
  const readAt = snapshot?.readAt ?? clock.now();
  let applied = 0;
  let stale = 0;
  let skipped = 0;
  let expired = 0;
  const reported = new Set<string>();
  for (const entry of snapshot?.subscriptions ?? []) {
    const productId = proProductOf(entry.productId);
    if (productId === null) {
      skipped += 1;
      continue;
    }
    reported.add(`${productId}|${entry.environment}`);
    const result = await upsertSubscriptionIfNotStale(db, {
      userId,
      productId,
      environment: entry.environment,
      status: entry.status,
      expiresAt: entry.expiresAt,
      store: entry.store,
      eventAt: readAt,
      eventId: null,
    });
    if (result.applied) {
      applied += 1;
    } else {
      stale += 1;
    }
  }

  const granting = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...PRO_STATUSES])));
  for (const row of granting) {
    if (reported.has(`${row.productId}|${row.environment}`)) {
      continue;
    }
    const result = await upsertSubscriptionIfNotStale(db, {
      userId,
      productId: row.productId,
      environment: row.environment,
      status: 'expired',
      expiresAt: row.expiresAt,
      store: row.store,
      eventAt: readAt,
      eventId: null,
    });
    if (result.applied) {
      expired += 1;
    } else {
      stale += 1;
    }
  }
  return { applied, stale, skipped, expired, notFound: snapshot === null };
}

/** Non-deleted user ids with at least one subscription row, after `after`, in id order. */
async function subscribedUsers(db: Database, after: string | null): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: subscriptions.userId })
    .from(subscriptions)
    .innerJoin(users, eq(users.id, subscriptions.userId))
    .where(
      and(
        eq(users.isTombstone, false),
        after === null ? undefined : gt(subscriptions.userId, after),
      ),
    )
    .orderBy(asc(subscriptions.userId))
    .limit(RECONCILE_BATCH);
  return rows.map((row) => row.userId);
}

export interface NightlyReconcileResult {
  readonly users: number;
  readonly applied: number;
  readonly stale: number;
  readonly expired: number;
  readonly notFound: number;
  /** Users handed to a per-user retry job. */
  readonly deferred: number;
  /** Users skipped after a non-transient error other than a rejected key. */
  readonly failed: number;
}

export async function reconcileAll(
  dependencies: ReconcileDependencies & { readonly client: RevenueCatClient },
  logger: Logger,
  signal?: AbortSignal,
): Promise<NightlyReconcileResult> {
  const { db, boss, clock } = dependencies;
  const totals = {
    users: 0,
    applied: 0,
    stale: 0,
    expired: 0,
    notFound: 0,
    deferred: 0,
    failed: 0,
  };
  let after: string | null = null;
  for (;;) {
    const batch = await subscribedUsers(db, after);
    for (const userId of batch) {
      if (signal?.aborted) {
        throw new TransientJobError('reconciliation interrupted');
      }
      totals.users += 1;
      try {
        const result = await reconcileUser(dependencies, userId, signal);
        totals.applied += result.applied;
        totals.stale += result.stale;
        totals.expired += result.expired;
        totals.notFound += result.notFound ? 1 : 0;
      } catch (error) {
        if (!(error instanceof RevenueCatApiError) || error.reason === 'unauthorized') {
          throw error;
        }
        if (!error.transient) {
          totals.failed += 1;
          logger.warn(
            {
              reason: error.reason,
              ...(error.status === undefined ? {} : { status: error.status }),
            },
            'subscriber reconciliation skipped',
          );
          continue;
        }
        const now = clock.now();
        await enqueue(
          boss,
          'subscription.reconcile',
          { userId, idempotencyKey: userReconcileKey(userId, now) },
          { startAfter: new Date(now.getTime() + RECONCILE_RETRY_DELAY_MS) },
        );
        totals.deferred += 1;
      }
    }
    if (batch.length < RECONCILE_BATCH) {
      return totals;
    }
    after = batch[batch.length - 1] ?? null;
  }
}

export function createSubscriptionReconcileHandler(dependencies: ReconcileDependencies) {
  return async (job: SubscriptionReconcileJob, context: JobContext): Promise<string> => {
    const { client } = dependencies;
    if (client === null) {
      context.logger.info({ reason: 'no_api_key' }, 'subscription reconciliation skipped');
      return 'skipped_no_api_key';
    }
    const withClient = { ...dependencies, client };
    try {
      if (job.userId === null) {
        const result = await reconcileAll(withClient, context.logger, context.signal);
        context.logger.info(result, 'subscriptions reconciled');
        return 'reconciled';
      }
      const result = await reconcileUser(withClient, job.userId, context.signal);
      context.logger.info(result, 'subscriber reconciled');
      return result.notFound ? 'not_found' : 'reconciled';
    } catch (error) {
      if (error instanceof RevenueCatApiError) {
        if (error.transient) {
          throw new TransientJobError(error.message, { cause: error });
        }
        // Wrong key or an unexpected answer: retrying cannot help, so the job completes.
        context.logger.error(
          { reason: error.reason, ...(error.status === undefined ? {} : { status: error.status }) },
          'subscription reconciliation failed',
        );
        return `failed_${error.reason}`;
      }
      throw error;
    }
  };
}
