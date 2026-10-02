import { randomUUID } from 'node:crypto';

import {
  type SubscriptionStatus,
  type WebhookEventInput,
  insertWebhookEventIfNew,
  subscriptions,
  users,
  webhookEvents,
} from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { scheduledPayload } from '../src/boss.js';
import { MINUTE_MS } from '../src/clock.js';
import { enqueue } from '../src/enqueue.js';
import { processRevenueCatEvent, userReconcileKey } from '../src/billing/process.js';
import {
  RECONCILE_RETRY_DELAY_MS,
  type ReconcileDependencies,
  createSubscriptionReconcileHandler,
  reconcileAll,
} from '../src/billing/reconcile.js';
import {
  type RevenueCatClient,
  RevenueCatApiError,
  type SubscriberSnapshot,
  normalizeSubscriber,
} from '../src/billing/revenuecat-client.js';
import { eventEffect, proProductOf, subscriptionStoreOf } from '../src/billing/status.js';
import {
  type FakeProvider,
  Fixtures,
  MutableClock,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitForJobState,
} from './support.js';

/**
 * ADR-0063 billing jobs against a real database and pg-boss. RevenueCat itself is never called:
 * the reconciliation reads an in-memory fake client, and the REST response normalization is
 * checked on fixture bodies. Nothing here proves behavior against a real RevenueCat account.
 */

class FakeRevenueCat implements RevenueCatClient {
  readonly answers = new Map<string, SubscriberSnapshot | Error | null>();
  readonly calls: string[] = [];

  getSubscriber(userId: string): Promise<SubscriberSnapshot | null> {
    this.calls.push(userId);
    const answer = this.answers.get(userId);
    if (answer instanceof Error) {
      return Promise.reject(answer);
    }
    return Promise.resolve(answer ?? null);
  }
}

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;
const fake = new FakeRevenueCat();
const clock = new MutableClock(new Date('2031-03-10T12:00:00.000Z'));

beforeAll(async () => {
  database = await createTestDatabase('worker_billing');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, {
    clock,
    extra: { revenueCatClient: fake },
  });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

beforeEach(() => {
  fake.answers.clear();
  fake.calls.length = 0;
});

const T0 = new Date('2031-03-10T10:00:00.000Z');

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * MINUTE_MS);
}

/** Stores an accepted delivery the way the webhook route does and returns its row id. */
async function storedEvent(
  userId: string,
  values: Partial<WebhookEventInput> & { eventType: string; eventAt: Date },
): Promise<{ id: string; eventId: string }> {
  const eventId = values.eventId ?? randomUUID().toUpperCase();
  const result = await insertWebhookEventIfNew(database.admin.db, {
    eventId,
    payloadHash: 'a'.repeat(64),
    appUserId: userId,
    productId: 'kadro_pro_monthly',
    store: 'app_store',
    environment: 'production',
    expiresAt: null,
    outcome: 'accepted',
    ignoredReason: null,
    ...values,
  });
  if (!result.inserted) throw new Error('event already stored');
  return { id: result.id, eventId };
}

function deps() {
  return { db: worker.runtime.db, boss: worker.runtime.boss, clock };
}

async function subscriptionOf(userId: string, productId = 'kadro_pro_monthly') {
  const [row] = await database.admin.db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.productId, productId)));
  return row;
}

async function processedAt(id: string): Promise<Date | null> {
  const [row] = await database.admin.db
    .select({ processedAt: webhookEvents.processedAt })
    .from(webhookEvents)
    .where(eq(webhookEvents.id, id));
  return row?.processedAt ?? null;
}

describe('event mapping (ADR-0063)', () => {
  const future = at(60 * 24 * 30);
  const past = at(-1);

  it('keeps Pro while an announced end lies in the future', () => {
    const cases: [string, Date | null, SubscriptionStatus][] = [
      ['INITIAL_PURCHASE', future, 'active'],
      ['RENEWAL', future, 'active'],
      ['UNCANCELLATION', future, 'active'],
      ['NON_RENEWING_PURCHASE', null, 'active'],
      ['SUBSCRIPTION_EXTENDED', future, 'active'],
      ['TEMPORARY_ENTITLEMENT_GRANT', future, 'active'],
      ['CANCELLATION', future, 'active'],
      ['SUBSCRIPTION_PAUSED', future, 'active'],
      ['BILLING_ISSUE', future, 'grace_period'],
      ['EXPIRATION', future, 'expired'],
      ['RENEWAL', past, 'expired'],
      ['CANCELLATION', past, 'cancelled'],
      ['SUBSCRIPTION_PAUSED', past, 'paused'],
      ['BILLING_ISSUE', past, 'billing_issue'],
      ['EXPIRATION', past, 'expired'],
    ];
    for (const [type, expiresAt, status] of cases) {
      expect(eventEffect(type, T0, expiresAt), `${type} ${String(expiresAt)}`).toEqual({
        kind: 'write',
        status,
      });
    }
    expect(eventEffect('CANCELLATION', T0, T0)).toEqual({ kind: 'write', status: 'cancelled' });
  });

  it('reconciles product changes and transfers, and applies nothing for other types', () => {
    expect(eventEffect('PRODUCT_CHANGE', T0, future)).toEqual({ kind: 'reconcile' });
    expect(eventEffect('TRANSFER', T0, null)).toEqual({ kind: 'reconcile' });
    expect(eventEffect('TEST', T0, future)).toEqual({ kind: 'none' });
    expect(eventEffect('SOMETHING_NEW', T0, future)).toEqual({ kind: 'none' });
  });

  it('maps products and stores onto the closed sets', () => {
    expect(proProductOf('kadro_pro_monthly')).toBe('kadro_pro_monthly');
    expect(proProductOf('kadro_pro_yearly:annual-base')).toBe('kadro_pro_yearly');
    expect(proProductOf('other_product')).toBeNull();
    expect(proProductOf(null)).toBeNull();
    expect(subscriptionStoreOf('APP_STORE')).toBe('app_store');
    expect(subscriptionStoreOf('MAC_APP_STORE')).toBe('app_store');
    expect(subscriptionStoreOf('PLAY_STORE')).toBe('play_store');
    expect(subscriptionStoreOf('PROMOTIONAL')).toBe('promotional');
    expect(subscriptionStoreOf('STRIPE')).toBe('other');
    expect(subscriptionStoreOf(null)).toBeNull();
  });
});

describe('webhook.revenuecat.process', () => {
  it('applies an accepted delivery through the queue and marks it processed', async () => {
    const user = await fixtures.user();
    const expiresAt = at(60 * 24 * 30);
    const event = await storedEvent(user.id, {
      eventType: 'INITIAL_PURCHASE',
      eventAt: at(0),
      expiresAt,
    });
    const jobId = await enqueue(worker.runtime.boss, 'webhook.revenuecat.process', {
      webhookEventId: event.id,
      idempotencyKey: `revenuecat:${event.eventId}`,
    });
    const job = await waitForJobState(database, 'webhook.revenuecat.process', jobId ?? '', [
      'completed',
    ]);
    expect(job.output).toEqual({ outcome: 'applied' });
    expect(await subscriptionOf(user.id)).toMatchObject({
      status: 'active',
      expiresAt,
      store: 'app_store',
      environment: 'production',
      rcAppUserId: user.id,
      lastEventAt: at(0),
      lastEventId: event.eventId,
    });
    expect(await processedAt(event.id)).toEqual(clock.now());

    // A second run of the same delivery changes nothing.
    expect(await processRevenueCatEvent(deps(), event.id)).toBe('already_processed');
  });

  it('keeps the newer state when deliveries arrive out of order', async () => {
    const user = await fixtures.user();
    const expired = await storedEvent(user.id, {
      eventType: 'EXPIRATION',
      eventAt: at(20),
      expiresAt: at(20),
    });
    const renewal = await storedEvent(user.id, {
      eventType: 'RENEWAL',
      eventAt: at(10),
      expiresAt: at(60 * 24 * 30),
    });
    expect(await processRevenueCatEvent(deps(), expired.id)).toBe('applied');
    expect(await processRevenueCatEvent(deps(), renewal.id)).toBe('stale');
    expect(await subscriptionOf(user.id)).toMatchObject({
      status: 'expired',
      lastEventId: expired.eventId,
    });
    expect(await processedAt(renewal.id)).not.toBeNull();

    const later = await storedEvent(user.id, {
      eventType: 'RENEWAL',
      eventAt: at(30),
      expiresAt: at(60 * 24 * 30),
    });
    expect(await processRevenueCatEvent(deps(), later.id)).toBe('applied');
    expect((await subscriptionOf(user.id))?.status).toBe('active');
  });

  it('keeps the first of two different events with an equal time', async () => {
    const user = await fixtures.user();
    const first = await storedEvent(user.id, {
      eventType: 'BILLING_ISSUE',
      eventAt: at(5),
      expiresAt: at(60),
    });
    const second = await storedEvent(user.id, {
      eventType: 'EXPIRATION',
      eventAt: at(5),
      expiresAt: at(5),
    });
    expect(await processRevenueCatEvent(deps(), first.id)).toBe('applied');
    expect(await processRevenueCatEvent(deps(), second.id)).toBe('stale');
    expect(await subscriptionOf(user.id)).toMatchObject({
      status: 'grace_period',
      lastEventId: first.eventId,
    });
  });

  it('writes Play Store base-plan products under the Pro product id', async () => {
    const user = await fixtures.user();
    const event = await storedEvent(user.id, {
      eventType: 'RENEWAL',
      eventAt: at(0),
      expiresAt: at(60 * 24 * 365),
      productId: 'kadro_pro_yearly:annual',
      store: 'play_store',
      environment: 'sandbox',
    });
    expect(await processRevenueCatEvent(deps(), event.id)).toBe('applied');
    expect(await subscriptionOf(user.id, 'kadro_pro_yearly')).toMatchObject({
      status: 'active',
      store: 'play_store',
      environment: 'sandbox',
    });
  });

  it('enqueues a per-user reconciliation for a product change', async () => {
    const user = await fixtures.user();
    const event = await storedEvent(user.id, {
      eventType: 'PRODUCT_CHANGE',
      eventAt: at(0),
      expiresAt: at(60),
    });
    expect(await processRevenueCatEvent(deps(), event.id)).toBe('reconcile_enqueued');
    const key = userReconcileKey(user.id, clock.now());
    const jobs = await jobsIn(database, 'subscription.reconcile');
    expect(jobs.find((job) => job.singletonKey === key)?.data).toEqual({
      userId: user.id,
      idempotencyKey: key,
    });
    expect(await subscriptionOf(user.id)).toBeUndefined();
  });

  it('marks ignored rows and deleted accounts processed without writing', async () => {
    const user = await fixtures.user();
    const ignored = await storedEvent(user.id, {
      eventType: 'TEST',
      eventAt: at(0),
      outcome: 'ignored',
      ignoredReason: 'test_event',
    });
    expect(await processRevenueCatEvent(deps(), ignored.id)).toBe('not_applicable');
    expect(await processedAt(ignored.id)).not.toBeNull();

    const gone = await fixtures.user();
    const event = await storedEvent(gone.id, {
      eventType: 'RENEWAL',
      eventAt: at(0),
      expiresAt: at(60),
    });
    await database.admin.db
      .update(users)
      .set({
        isTombstone: true,
        passwordHash: null,
        deactivatedAt: new Date(),
        displayName: 'Silinmiş kullanıcı',
      })
      .where(eq(users.id, gone.id));
    expect(await processRevenueCatEvent(deps(), event.id)).toBe('unknown_user');
    expect(await subscriptionOf(gone.id)).toBeUndefined();
    expect(await processRevenueCatEvent(deps(), randomUUID())).toBe('missing_event');
  });
});

describe('subscription.reconcile', () => {
  function reconcileDeps(): ReconcileDependencies & { client: RevenueCatClient } {
    return { ...deps(), client: fake };
  }

  it('writes the subscriber snapshot for one user through the queue', async () => {
    const user = await fixtures.user();
    fake.answers.set(user.id, {
      readAt: at(0),
      subscriptions: [
        {
          productId: 'kadro_pro_monthly',
          status: 'active',
          expiresAt: at(60 * 24 * 30),
          store: 'app_store',
          environment: 'production',
        },
        {
          productId: 'unrelated_product',
          status: 'active',
          expiresAt: null,
          store: 'other',
          environment: 'production',
        },
      ],
    });
    const key = `reconcile:${user.id}:1`;
    const jobId = await enqueue(worker.runtime.boss, 'subscription.reconcile', {
      userId: user.id,
      idempotencyKey: key,
    });
    const job = await waitForJobState(database, 'subscription.reconcile', jobId ?? '', [
      'completed',
    ]);
    expect(job.output).toEqual({ outcome: 'reconciled' });
    expect(fake.calls).toContain(user.id);
    expect(await subscriptionOf(user.id)).toMatchObject({
      status: 'active',
      lastEventAt: at(0),
      lastEventId: null,
    });
    expect(await subscriptionOf(user.id, 'unrelated_product')).toBeUndefined();
  });

  it('never overwrites a webhook event newer than the snapshot', async () => {
    const user = await fixtures.user();
    const event = await storedEvent(user.id, {
      eventType: 'EXPIRATION',
      eventAt: at(30),
      expiresAt: at(30),
    });
    expect(await processRevenueCatEvent(deps(), event.id)).toBe('applied');
    fake.answers.set(user.id, {
      readAt: at(10),
      subscriptions: [
        {
          productId: 'kadro_pro_monthly',
          status: 'active',
          expiresAt: at(60),
          store: 'app_store',
          environment: 'production',
        },
      ],
    });
    const result = await reconcileAll(reconcileDeps());
    expect(result.stale).toBeGreaterThanOrEqual(1);
    expect((await subscriptionOf(user.id))?.status).toBe('expired');
  });

  it('walks every subscribed user nightly and defers transient failures', async () => {
    const corrected = await fixtures.user();
    const failing = await fixtures.user();
    for (const user of [corrected, failing]) {
      const event = await storedEvent(user.id, {
        eventType: 'INITIAL_PURCHASE',
        eventAt: at(-120),
        expiresAt: at(60),
      });
      await processRevenueCatEvent(deps(), event.id);
    }
    fake.answers.set(corrected.id, {
      readAt: at(0),
      subscriptions: [
        {
          productId: 'kadro_pro_monthly',
          status: 'expired',
          expiresAt: at(-1),
          store: 'app_store',
          environment: 'production',
        },
      ],
    });
    fake.answers.set(failing.id, new RevenueCatApiError('http_status', 503));

    const result = await reconcileAll(reconcileDeps());
    expect(fake.calls).toEqual(expect.arrayContaining([corrected.id, failing.id]));
    expect(result.deferred).toBe(1);
    expect((await subscriptionOf(corrected.id))?.status).toBe('expired');
    expect((await subscriptionOf(failing.id))?.status).toBe('active');

    const key = userReconcileKey(failing.id, clock.now());
    const retry = (await jobsIn(database, 'subscription.reconcile')).find(
      (job) => job.singletonKey === key,
    );
    expect(retry?.data).toEqual({ userId: failing.id, idempotencyKey: key });
    expect(retry?.startAfter.getTime()).toBeGreaterThanOrEqual(
      clock.now().getTime() + RECONCILE_RETRY_DELAY_MS - 1_000,
    );
  });

  it('completes the scheduled run without retry when the key is rejected', async () => {
    const user = await fixtures.user();
    const event = await storedEvent(user.id, {
      eventType: 'INITIAL_PURCHASE',
      eventAt: at(-10),
      expiresAt: at(60),
    });
    await processRevenueCatEvent(deps(), event.id);
    const unauthorized = new RevenueCatApiError('unauthorized', 401);
    const original = fake.getSubscriber.bind(fake);
    fake.getSubscriber = () => Promise.reject(unauthorized);
    try {
      const jobId = await worker.runtime.boss.send('subscription.reconcile', {
        ...scheduledPayload('subscription.reconcile'),
        userId: null,
      });
      const job = await waitForJobState(database, 'subscription.reconcile', jobId ?? '', [
        'completed',
      ]);
      expect(job.output).toEqual({ outcome: 'failed_unauthorized' });
      expect(job.retryCount).toBe(0);
    } finally {
      fake.getSubscriber = original;
    }
  });

  it('is skipped and logged without an API key', async () => {
    const disabled = await startTestWorker(database, provider, {
      clock,
      extra: { revenueCatClient: null },
    });
    await disabled.runtime.stop();
    expect(
      disabled.logs
        .entries()
        .some(
          (entry) => entry.msg === 'worker ready' && entry.revenueCatReconciliation === 'disabled',
        ),
    ).toBe(true);

    const handler = createSubscriptionReconcileHandler({ ...deps(), client: null });
    const outcome = await handler(
      { userId: null, idempotencyKey: 'schedule:subscription.reconcile' },
      {
        jobId: randomUUID(),
        queue: 'subscription.reconcile',
        retryCount: 0,
        createdOn: new Date(),
        singletonKey: null,
        logger: worker.logs.logger,
        signal: new AbortController().signal,
      },
    );
    expect(outcome).toBe('skipped_no_api_key');
    expect(
      worker.logs
        .entries()
        .some(
          (entry) =>
            entry.msg === 'subscription reconciliation skipped' && entry.reason === 'no_api_key',
        ),
    ).toBe(true);
  });
});

describe('RevenueCat REST snapshot normalization (fixtures only)', () => {
  const readAt = new Date('2031-03-10T12:00:00.000Z');

  it('derives status, store and environment per product from a v1 subscriber body', () => {
    const snapshot = normalizeSubscriber(
      {
        request_date: '2031-03-10T12:00:00Z',
        request_date_ms: readAt.getTime(),
        subscriber: {
          original_app_user_id: 'ignored',
          subscriptions: {
            kadro_pro_monthly: {
              expires_date: '2031-04-10T12:00:00Z',
              store: 'APP_STORE',
              is_sandbox: false,
              billing_issues_detected_at: null,
              unsubscribe_detected_at: '2031-03-01T00:00:00Z',
            },
            'kadro_pro_yearly:annual': {
              expires_date: '2031-03-01T00:00:00Z',
              store: 'PLAY_STORE',
              is_sandbox: true,
              billing_issues_detected_at: '2031-02-28T00:00:00Z',
              grace_period_expires_date: '2031-03-20T00:00:00Z',
            },
            old_product: {
              expires_date: '2030-01-01T00:00:00Z',
              store: 'STRIPE',
              refunded_at: '2029-12-01T00:00:00Z',
            },
          },
          unknown_member: { nested: true },
        },
      },
      new Date(0),
    );
    expect(snapshot.readAt).toEqual(readAt);
    expect(snapshot.subscriptions).toEqual([
      {
        productId: 'kadro_pro_monthly',
        status: 'active',
        expiresAt: new Date('2031-04-10T12:00:00Z'),
        store: 'app_store',
        environment: 'production',
      },
      {
        productId: 'kadro_pro_yearly:annual',
        status: 'grace_period',
        expiresAt: new Date('2031-03-01T00:00:00Z'),
        store: 'play_store',
        environment: 'sandbox',
      },
      {
        productId: 'old_product',
        status: 'cancelled',
        expiresAt: new Date('2030-01-01T00:00:00Z'),
        store: 'other',
        environment: 'production',
      },
    ]);
  });

  it('marks lapsed subscriptions and rejects a body without a subscriber', () => {
    const snapshot = normalizeSubscriber(
      {
        subscriber: {
          subscriptions: {
            kadro_pro_monthly: { expires_date: '2031-03-01T00:00:00Z', store: 'APP_STORE' },
            kadro_pro_yearly: {
              expires_date: '2031-03-01T00:00:00Z',
              store: 'APP_STORE',
              billing_issues_detected_at: '2031-02-27T00:00:00Z',
            },
          },
        },
      },
      readAt,
    );
    expect(snapshot.readAt).toEqual(readAt);
    expect(snapshot.subscriptions.map((entry) => entry.status)).toEqual([
      'expired',
      'billing_issue',
    ]);
    expect(() => normalizeSubscriber({ value: 1 }, readAt)).toThrow(RevenueCatApiError);
  });
});
