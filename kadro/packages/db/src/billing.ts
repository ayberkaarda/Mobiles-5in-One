import { and, eq, isNull, sql } from 'drizzle-orm';

import { type Database, type Transaction } from './client.js';
import {
  type StoredWebhookOutcome,
  type SubscriptionEnvironment,
  type SubscriptionStatus,
  type SubscriptionStore,
  type WebhookProvider,
  subscriptions,
  webhookEvents,
} from './schema/index.js';
import type { Subscription, WebhookEvent } from './types.js';

/**
 * Persistence of the RevenueCat webhook and of the subscription state it drives (ADR-0063). The
 * web route inserts the event, the worker applies it; both are idempotent, so a replayed delivery
 * or a re-run job changes nothing.
 */

type Executor = Database | Transaction;

export interface WebhookEventInput {
  readonly provider?: WebhookProvider;
  /** Provider event id; unique per provider. */
  readonly eventId: string;
  /** Lowercase hex SHA-256 of the raw request body. */
  readonly payloadHash: string;
  readonly eventType: string;
  /** `app_user_id` as sent, or `null` when the event has none. */
  readonly appUserId: string | null;
  readonly productId: string | null;
  readonly store: SubscriptionStore | null;
  readonly environment: SubscriptionEnvironment | null;
  /** Provider event time. */
  readonly eventAt: Date;
  readonly expiresAt: Date | null;
  readonly outcome: StoredWebhookOutcome;
  /** Required exactly when `outcome` is `ignored`. */
  readonly ignoredReason: string | null;
}

export type WebhookInsertResult =
  { readonly inserted: true; readonly id: string } | { readonly inserted: false };

/**
 * Stores a delivery unless its `(provider, event_id)` is already stored. `inserted: false` is the
 * `duplicate` outcome: nothing is written and nothing should be enqueued.
 */
export async function insertWebhookEventIfNew(
  db: Executor,
  input: WebhookEventInput,
): Promise<WebhookInsertResult> {
  const { provider = 'revenuecat', ...columns } = input;
  const [row] = await db
    .insert(webhookEvents)
    .values({ provider, ...columns })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
    .returning({ id: webhookEvents.id });
  return row === undefined ? { inserted: false } : { inserted: true, id: row.id };
}

export async function getWebhookEvent(db: Executor, id: string): Promise<WebhookEvent | undefined> {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id));
  return row;
}

/**
 * Marks an event as processed. Returns `false` when it was already processed or does not exist, so
 * a re-run job can tell that its work is done.
 */
export async function markWebhookEventProcessed(
  db: Executor,
  id: string,
  at: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(webhookEvents)
    .set({ processedAt: at, updatedAt: at })
    .where(and(eq(webhookEvents.id, id), isNull(webhookEvents.processedAt)))
    .returning({ id: webhookEvents.id });
  return rows.length > 0;
}

export interface SubscriptionWrite {
  readonly userId: string;
  readonly productId: string;
  readonly environment: SubscriptionEnvironment;
  readonly status: SubscriptionStatus;
  readonly expiresAt: Date | null;
  readonly store: SubscriptionStore | null;
  /**
   * Provider time of the change. For a webhook event its `event_at`; for a reconciliation the time
   * the provider state was read, so a newer event is never overwritten by an older snapshot.
   */
  readonly eventAt: Date;
  /** Event id of a webhook write, `null` for a reconciliation. */
  readonly eventId: string | null;
}

export type SubscriptionWriteResult =
  { readonly applied: true; readonly subscription: Subscription } | { readonly applied: false };

/**
 * Creates or updates the subscription of `(user, product, environment)`. The row is overwritten
 * only when it has never recorded an event, when its last event is strictly older than this one,
 * or when it is a replay of the same event id (idempotent). Two different events with an equal
 * time are decided by arrival: the first stays and the second is not applied, so a re-run cannot
 * flip the state. A reconciliation (null event id) applies only when the time it read the
 * provider is strictly newer than the last event. `applied: false`
 * means a newer event already decided the state. The RevenueCat app user id is the user id.
 */
export async function upsertSubscriptionIfNotStale(
  db: Executor,
  write: SubscriptionWrite,
): Promise<SubscriptionWriteResult> {
  const now = new Date();
  const [row] = await db
    .insert(subscriptions)
    .values({
      userId: write.userId,
      rcAppUserId: write.userId,
      productId: write.productId,
      environment: write.environment,
      status: write.status,
      expiresAt: write.expiresAt,
      store: write.store,
      lastEventAt: write.eventAt,
      lastEventId: write.eventId,
    })
    .onConflictDoUpdate({
      target: [subscriptions.userId, subscriptions.productId, subscriptions.environment],
      set: {
        status: write.status,
        expiresAt: write.expiresAt,
        store: write.store,
        lastEventAt: write.eventAt,
        lastEventId: write.eventId,
        updatedAt: now,
      },
      setWhere: sql`${subscriptions.lastEventAt} is null or ${subscriptions.lastEventAt} < excluded.last_event_at or ${subscriptions.lastEventId} = excluded.last_event_id`,
    })
    .returning();
  return row === undefined ? { applied: false } : { applied: true, subscription: row };
}
