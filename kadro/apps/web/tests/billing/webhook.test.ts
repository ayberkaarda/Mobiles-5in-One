import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { LIMITS, revenueCatWebhookResponseSchema } from '@kadro/contracts';
import { users, webhookEvents } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/webhooks/revenuecat/route';
import { processJobKey, verifyRevenueCatRequest } from '../../lib/server/billing/webhook';
import { json, route } from '../../lib/server/http';
import { noParams, noQuery } from '../../lib/server/validate';
import { installServerRuntime } from '../../lib/server/runtime';
import { type JobsHarness, setupJobsHarness } from '../jobs/support';
import { call, expectProblem } from '../support/http';
import { storedJobs } from '../support/jobs';
import { installTestRuntime } from '../support/runtime';

/**
 * `POST webhooks/revenuecat` (ADR-0063) against a real database and the send-only job client.
 * The deliveries are fixtures shaped like RevenueCat's documented webhook body; nothing here
 * proves a delivery from a real RevenueCat project.
 */

const SECRET = randomBytes(32).toString('base64url');
const PATH = '/api/v1/webhooks/revenuecat';
const QUEUE = 'webhook.revenuecat.process';

let jobs: JobsHarness;

beforeAll(async () => {
  jobs = await setupJobsHarness('web_webhook', { REVENUECAT_WEBHOOK_SECRET: SECRET });
});

afterAll(async () => {
  await jobs.dispose();
});

let counter = 0;
async function newUser(): Promise<string> {
  counter += 1;
  const [row] = await jobs.database.client.db
    .insert(users)
    .values({ email: `abone${counter}-${Date.now()}@example.test`, displayName: 'Abone Oyuncu' })
    .returning({ id: users.id });
  if (row === undefined) throw new Error('user insert returned no row');
  return row.id;
}

const EVENT_MS = Date.parse('2031-03-10T10:00:00.000Z');
const EXPIRY_MS = Date.parse('2031-04-10T10:00:00.000Z');

function delivery(event: Record<string, unknown>): Record<string, unknown> {
  return {
    api_version: '1.0',
    event: {
      id: randomUUID().toUpperCase(),
      type: 'INITIAL_PURCHASE',
      event_timestamp_ms: EVENT_MS,
      product_id: 'kadro_pro_monthly',
      period_type: 'NORMAL',
      purchased_at_ms: EVENT_MS,
      expiration_at_ms: EXPIRY_MS,
      environment: 'PRODUCTION',
      store: 'APP_STORE',
      entitlement_ids: ['pro'],
      transaction_id: '1000000000000001',
      original_transaction_id: '1000000000000001',
      // Fields the server does not read are accepted and never stored.
      country_code: 'TR',
      currency: 'TRY',
      price: 99.99,
      subscriber_attributes: { $email: { value: 'abone@example.test', updated_at_ms: EVENT_MS } },
      ...event,
    },
  };
}

function post(
  body: string,
  authorization: string | null = SECRET,
  extra: Record<string, string> = {},
) {
  return call(POST, {
    method: 'POST',
    path: PATH,
    headers: {
      'content-type': 'application/json',
      ...(authorization === null ? {} : { authorization }),
      ...extra,
    },
    body,
  });
}

async function expectOutcome(response: Response, status: string): Promise<void> {
  const text = await response.text();
  expect(response.status, text).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(revenueCatWebhookResponseSchema.parse(JSON.parse(text))).toEqual({ status });
}

async function storedEvent(eventId: string) {
  const rows = await jobs.database.client.db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.eventId, eventId));
  return rows;
}

async function jobsFor(webhookEventId: string) {
  return (await storedJobs(jobs.database.url, QUEUE)).filter(
    (job) => job.data.webhookEventId === webhookEventId,
  );
}

function eventIdOf(body: Record<string, unknown>): string {
  return (body.event as { id: string }).id;
}

describe('POST webhooks/revenuecat: authentication', () => {
  it('answers 401 without, or with a wrong, Authorization header and stores nothing', async () => {
    const body = delivery({ app_user_id: await newUser() });
    const raw = JSON.stringify(body);
    for (const header of [null, '', 'Bearer', `${SECRET}x`, SECRET.slice(1), `Basic ${SECRET}`]) {
      await expectProblem(await post(raw, header), 401, 'unauthenticated');
    }
    expect(await storedEvent(eventIdOf(body))).toEqual([]);
  });

  it('checks the secret before the body, so a stranger learns nothing about validation', async () => {
    await expectProblem(await post('{"not":"a delivery"}', 'wrong'), 401, 'unauthenticated');
    await expectProblem(await post('not json', null), 401, 'unauthenticated');
  });

  it('answers 503 when no secret is configured (fail closed)', async () => {
    const unconfigured = await installTestRuntime({
      db: jobs.app.db,
      env: { DATABASE_URL: jobs.logins.appUrl },
    });
    try {
      expect(unconfigured.env.REVENUECAT_WEBHOOK_SECRET).toBeUndefined();
      const raw = JSON.stringify(delivery({ app_user_id: await newUser() }));
      await expectProblem(await post(raw), 503, 'service_unavailable');
    } finally {
      installServerRuntime(jobs.harness.runtime);
    }
  });

  it('allows a request check only on routes without user authentication', () => {
    expect(() =>
      route({
        path: '/api/v1/sample',
        method: 'POST',
        auth: 'required',
        params: noParams,
        query: noQuery,
        body: noQuery,
        verifyRequest: verifyRevenueCatRequest,
        handler: () => json({}),
      }),
    ).toThrow(TypeError);
  });

  it('needs no x-kadro-client and ignores user credentials', async () => {
    const body = delivery({ app_user_id: await newUser() });
    const response = await post(JSON.stringify(body), SECRET, {
      cookie: '__Host-kadro_session=forged',
    });
    await expectOutcome(response, 'accepted');
  });
});

describe('POST webhooks/revenuecat: validation', () => {
  it('rejects a body outside the strict envelope with 400', async () => {
    const user = await newUser();
    const extraTopLevel = { ...delivery({ app_user_id: user }), extra: true };
    await expectProblem(await post(JSON.stringify(extraTopLevel)), 400, 'validation_failed');
    const noId = delivery({ app_user_id: user, id: undefined });
    await expectProblem(await post(JSON.stringify(noId)), 400, 'validation_failed');
    const badVersion = { ...delivery({ app_user_id: user }), api_version: 'v1' };
    await expectProblem(await post(JSON.stringify(badVersion)), 400, 'validation_failed');
    const badTime = delivery({ app_user_id: user, event_timestamp_ms: -1 });
    await expectProblem(await post(JSON.stringify(badTime)), 400, 'validation_failed');
    await expectProblem(await post('{"api_version":'), 400, 'validation_failed');
  });

  it('enforces the JSON media type and the 1 MiB body limit', async () => {
    const raw = JSON.stringify(delivery({ app_user_id: await newUser() }));
    const response = await call(POST, {
      method: 'POST',
      path: PATH,
      headers: { 'content-type': 'text/plain', authorization: SECRET },
      body: raw,
    });
    await expectProblem(response, 415, 'unsupported_media_type');
    const oversized = JSON.stringify(
      delivery({ padding: 'x'.repeat(LIMITS.jsonBodyMaxBytes), app_user_id: await newUser() }),
    );
    await expectProblem(await post(oversized), 413, 'payload_too_large');
  });
});

describe('POST webhooks/revenuecat: outcomes', () => {
  it('stores an applicable delivery with its normalized columns and enqueues processing', async () => {
    const user = await newUser();
    const body = delivery({ app_user_id: user });
    const raw = JSON.stringify(body);
    await expectOutcome(await post(raw, `Bearer ${SECRET}`), 'accepted');

    const [row] = await storedEvent(eventIdOf(body));
    expect(row).toMatchObject({
      provider: 'revenuecat',
      payloadHash: createHash('sha256').update(raw, 'utf8').digest('hex'),
      eventType: 'INITIAL_PURCHASE',
      appUserId: user,
      productId: 'kadro_pro_monthly',
      store: 'app_store',
      environment: 'production',
      eventAt: new Date(EVENT_MS),
      expiresAt: new Date(EXPIRY_MS),
      outcome: 'accepted',
      ignoredReason: null,
      processedAt: null,
    });
    const queued = await jobsFor(row?.id ?? '');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      state: 'created',
      singletonKey: `revenuecat:${eventIdOf(body)}`,
      data: { webhookEventId: row?.id, idempotencyKey: `revenuecat:${eventIdOf(body)}` },
    });
    // Unknown event fields are not stored anywhere in the row.
    expect(JSON.stringify(row)).not.toContain('abone@example.test');
  });

  it('answers duplicate for a replayed event id and enqueues nothing more', async () => {
    const body = delivery({ app_user_id: await newUser() });
    const raw = JSON.stringify(body);
    await expectOutcome(await post(raw), 'accepted');
    await expectOutcome(await post(raw), 'duplicate');
    // A retry with a changed body but the same id is still the same event.
    const changed = JSON.stringify({ ...body, event: { ...(body.event as object), price: 1 } });
    await expectOutcome(await post(changed), 'duplicate');
    const rows = await storedEvent(eventIdOf(body));
    expect(rows).toHaveLength(1);
    expect(await jobsFor(rows[0]?.id ?? '')).toHaveLength(1);
  });

  it('stores but does not apply deliveries it cannot attribute or does not handle', async () => {
    const user = await newUser();
    const cases: [Record<string, unknown>, string][] = [
      [{ app_user_id: randomUUID() }, 'unknown_user'],
      [{ app_user_id: 'customer-42' }, 'unknown_user'],
      [{ app_user_id: '$RCAnonymousID:8d2f2a0c5b5e4b0f9d1d3e1f2a3b4c5d' }, 'anonymous_app_user_id'],
      [{ app_user_id: undefined }, 'missing_app_user_id'],
      [{ app_user_id: user, type: 'TEST' }, 'test_event'],
      [{ app_user_id: user, type: 'SUBSCRIBER_ALIAS' }, 'unhandled_event_type'],
      [{ app_user_id: user, product_id: 'other_app_coins' }, 'foreign_product'],
      [{ app_user_id: user, environment: undefined }, 'missing_environment'],
    ];
    for (const [event, reason] of cases) {
      const body = delivery(event);
      await expectOutcome(await post(JSON.stringify(body)), 'ignored');
      const [row] = await storedEvent(eventIdOf(body));
      expect(row, reason).toMatchObject({ outcome: 'ignored', ignoredReason: reason });
      expect(await jobsFor(row?.id ?? ''), reason).toEqual([]);
    }
    // A replay of an ignored delivery is a duplicate.
    const replay = delivery({ app_user_id: randomUUID() });
    await expectOutcome(await post(JSON.stringify(replay)), 'ignored');
    await expectOutcome(await post(JSON.stringify(replay)), 'duplicate');
  });

  it('treats a deleted account as unknown', async () => {
    const user = await newUser();
    await jobs.database.client.db
      .update(users)
      .set({ isTombstone: true, deactivatedAt: new Date(), passwordHash: null })
      .where(eq(users.id, user));
    const body = delivery({ app_user_id: user });
    await expectOutcome(await post(JSON.stringify(body)), 'ignored');
    expect((await storedEvent(eventIdOf(body)))[0]?.ignoredReason).toBe('unknown_user');
  });

  it('attributes a transfer to the receiving account and accepts Play Store base plans', async () => {
    const from = await newUser();
    const to = await newUser();
    const transfer = delivery({
      type: 'TRANSFER',
      app_user_id: undefined,
      product_id: null,
      transferred_from: [from],
      transferred_to: ['$RCAnonymousID:00000000000000000000000000000000', to],
    });
    await expectOutcome(await post(JSON.stringify(transfer)), 'accepted');
    expect((await storedEvent(eventIdOf(transfer)))[0]?.appUserId).toBe(to);

    const play = delivery({
      app_user_id: to,
      product_id: 'kadro_pro_yearly:annual',
      store: 'PLAY_STORE',
      environment: 'SANDBOX',
    });
    await expectOutcome(await post(JSON.stringify(play)), 'accepted');
    expect((await storedEvent(eventIdOf(play)))[0]).toMatchObject({
      productId: 'kadro_pro_yearly:annual',
      store: 'play_store',
      environment: 'sandbox',
    });
  });

  it('keeps job keys inside the key alphabet', () => {
    const id = randomUUID().toUpperCase();
    expect(processJobKey(id)).toBe(`revenuecat:${id}`);
    expect(processJobKey('id with spaces')).toMatch(/^revenuecat:[0-9a-f]{64}$/);
    expect(processJobKey('x'.repeat(128))).toMatch(/^revenuecat:[0-9a-f]{64}$/);
  });
});
