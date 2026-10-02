import { type RevenueCatProcessJob, idSchema } from '@kadro/contracts';
import {
  type Database,
  type Transaction,
  getWebhookEvent,
  markWebhookEventProcessed,
  upsertSubscriptionIfNotStale,
  users,
} from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';

import { type Clock, MINUTE_MS } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { type JobContext } from '../job-runner.js';
import { eventEffect, proProductOf } from './status.js';

/**
 * `webhook.revenuecat.process` (ADR-0063): applies one stored delivery to `subscriptions`. The
 * event row is marked processed in the same transaction as its effect, so a re-run (retry, replayed
 * job) finds it processed and changes nothing. Deliveries are not ordered: the subscription write
 * goes through `upsertSubscriptionIfNotStale`, which keeps a newer event's state and keeps the
 * first of two events with an equal time.
 */

export interface ProcessDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly clock: Clock;
}

export type ProcessOutcome =
  /** The subscription row now reflects this event. */
  | 'applied'
  /** A newer (or equal-time earlier) event already decided the row; nothing changed. */
  | 'stale'
  /** A per-user reconciliation was enqueued (`PRODUCT_CHANGE`, `TRANSFER`). */
  | 'reconcile_enqueued'
  | 'already_processed'
  | 'missing_event'
  /** Stored as `ignored` by the route, or carries nothing to apply. */
  | 'not_applicable'
  /** The account was deleted after the delivery was accepted. */
  | 'unknown_user';

/** `subscription.reconcile` key of a per-user run, one per user and minute. */
export function userReconcileKey(userId: string, at: Date): string {
  return `reconcile:${userId}:${Math.floor(at.getTime() / MINUTE_MS)}`;
}

async function isKnownUser(tx: Transaction, userId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isTombstone, false)))
    .limit(1);
  return rows.length > 0;
}

export async function processRevenueCatEvent(
  dependencies: ProcessDependencies,
  webhookEventId: string,
): Promise<ProcessOutcome> {
  const { db, boss, clock } = dependencies;
  return db.transaction(async (tx): Promise<ProcessOutcome> => {
    const event = await getWebhookEvent(tx, webhookEventId);
    if (event === undefined) {
      return 'missing_event';
    }
    const now = clock.now();
    // Locks the row: a concurrent run of the same event waits here and then sees it processed.
    if (!(await markWebhookEventProcessed(tx, event.id, now))) {
      return 'already_processed';
    }
    const userId = idSchema.safeParse(event.appUserId);
    if (
      event.outcome !== 'accepted' ||
      event.eventType === null ||
      event.eventAt === null ||
      !userId.success
    ) {
      return 'not_applicable';
    }
    if (!(await isKnownUser(tx, userId.data))) {
      return 'unknown_user';
    }

    const effect = eventEffect(event.eventType, event.eventAt, event.expiresAt);
    switch (effect.kind) {
      case 'none':
        return 'not_applicable';
      case 'reconcile':
        await enqueue(
          boss,
          'subscription.reconcile',
          { userId: userId.data, idempotencyKey: userReconcileKey(userId.data, now) },
          { tx },
        );
        return 'reconcile_enqueued';
      case 'write': {
        const productId = proProductOf(event.productId);
        if (productId === null || event.environment === null) {
          return 'not_applicable';
        }
        const result = await upsertSubscriptionIfNotStale(tx, {
          userId: userId.data,
          productId,
          environment: event.environment,
          status: effect.status,
          expiresAt: event.expiresAt,
          store: event.store,
          eventAt: event.eventAt,
          eventId: event.eventId,
        });
        return result.applied ? 'applied' : 'stale';
      }
    }
  });
}

export function createRevenueCatProcessHandler(dependencies: ProcessDependencies) {
  return async (job: RevenueCatProcessJob, context: JobContext): Promise<string> => {
    const outcome = await processRevenueCatEvent(dependencies, job.webhookEventId);
    if (outcome === 'missing_event' || outcome === 'unknown_user') {
      context.logger.warn({ outcome }, 'revenuecat event not applied');
    }
    return outcome;
  };
}
