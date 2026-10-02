import { type RevenueCatProcessJob, idSchema } from '@kadro/contracts';
import {
  type Database,
  type Transaction,
  markWebhookEventProcessed,
  upsertSubscriptionIfNotStale,
  users,
  webhookEvents,
} from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';

import { type Clock, MINUTE_MS } from '../clock.js';
import { enqueue } from '../enqueue.js';
import { type JobContext } from '../job-runner.js';
import { eventEffect, proProductOf } from './status.js';

/**
 * `webhook.revenuecat.process` (ADR-0063): applies one stored delivery to `subscriptions`. The
 * event row is locked, applied and marked processed in one transaction, so a re-run (retry,
 * replayed job) finds it processed and changes nothing. Deliveries are not ordered: the
 * subscription write goes through `upsertSubscriptionIfNotStale`, which keeps a newer event's state
 * and keeps the first of two events with an equal time.
 *
 * An event that needs a subscriber read (`TRANSFER`) while reconciliation is not configured is
 * left unprocessed with the outcome `deferred_no_api_key`, so it stays visible and can be replayed
 * once a key exists, instead of being recorded as handled.
 */

export interface ProcessDependencies {
  readonly db: Database;
  readonly boss: PgBoss;
  readonly clock: Clock;
  /** True when `subscription.reconcile` can read RevenueCat (`REVENUECAT_API_KEY` is set). */
  readonly reconcileAvailable: boolean;
}

export type ProcessOutcome =
  /** The subscription row now reflects this event. */
  | 'applied'
  /** A newer (or equal-time earlier) event already decided the row; nothing changed. */
  | 'stale'
  /** A per-user reconciliation was enqueued (`TRANSFER`). */
  | 'reconcile_enqueued'
  /** Needs a subscriber read but no API key is configured; the event stays unprocessed. */
  | 'deferred_no_api_key'
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

async function lockEvent(tx: Transaction, id: string) {
  const [row] = await tx
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id))
    .limit(1)
    .for('update');
  return row;
}

export async function processRevenueCatEvent(
  dependencies: ProcessDependencies,
  webhookEventId: string,
): Promise<ProcessOutcome> {
  const { db, boss, clock } = dependencies;
  return db.transaction(async (tx): Promise<ProcessOutcome> => {
    // A concurrent run of the same event waits on this lock and then sees it processed.
    const event = await lockEvent(tx, webhookEventId);
    if (event === undefined) {
      return 'missing_event';
    }
    if (event.processedAt !== null) {
      return 'already_processed';
    }
    const now = clock.now();
    const done = async (outcome: ProcessOutcome): Promise<ProcessOutcome> => {
      await markWebhookEventProcessed(tx, event.id, now);
      return outcome;
    };

    const userId = idSchema.safeParse(event.appUserId);
    if (
      event.outcome !== 'accepted' ||
      event.eventType === null ||
      event.eventAt === null ||
      !userId.success
    ) {
      return done('not_applicable');
    }
    if (!(await isKnownUser(tx, userId.data))) {
      return done('unknown_user');
    }

    const effect = eventEffect(event.eventType, event.eventAt, event.expiresAt);
    switch (effect.kind) {
      case 'none':
        return done('not_applicable');
      case 'reconcile':
        if (!dependencies.reconcileAvailable) {
          return 'deferred_no_api_key';
        }
        await enqueue(
          boss,
          'subscription.reconcile',
          { userId: userId.data, idempotencyKey: userReconcileKey(userId.data, now) },
          { tx },
        );
        return done('reconcile_enqueued');
      case 'write': {
        const productId = proProductOf(event.productId);
        if (productId === null || event.environment === null) {
          return done('not_applicable');
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
        return done(result.applied ? 'applied' : 'stale');
      }
    }
  });
}

export function createRevenueCatProcessHandler(dependencies: ProcessDependencies) {
  return async (job: RevenueCatProcessJob, context: JobContext): Promise<string> => {
    const outcome = await processRevenueCatEvent(dependencies, job.webhookEventId);
    if (
      outcome === 'missing_event' ||
      outcome === 'unknown_user' ||
      outcome === 'deferred_no_api_key'
    ) {
      context.logger.warn({ outcome }, 'revenuecat event not applied');
    }
    return outcome;
  };
}
