import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';

import { deletionRequests, subscriptions, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHardDeleteHandler,
  subscriberDeleteIdempotencyKey,
} from '../src/accounts/hard-delete.js';
import { createRevenueCatRestClient } from '../src/billing/revenuecat-client.js';
import {
  createSubscriberDeleteHandler,
  deleteSubscriberWithRetry,
} from '../src/billing/subscriber-delete.js';
import { DAY_MS, systemClock } from '../src/clock.js';
import { enqueue } from '../src/enqueue.js';
import { type JobContext } from '../src/job-runner.js';
import { hardDeleteIdempotencyKey } from '../src/maintenance/sweep.js';
import {
  type FakeProvider,
  Fixtures,
  MetricsRecorder,
  RESEND_PATH,
  TEST_INCOMING_BUCKET,
  TEST_MEDIA_BUCKET,
  type TestDatabase,
  type TestWorker,
  captureLogs,
  createTestDatabase,
  jobsIn,
  newId,
  startFakeProvider,
  startTestWorker,
  waitFor,
  waitForJobState,
} from './support.js';

/**
 * ADR-0082: RevenueCat subscriber deletion at hard delete, against a real database, real pg-boss
 * and the real REST client talking to a local fake RevenueCat server. Nothing here proves the
 * behaviour of the real RevenueCat API (no account, no key).
 */

interface RcRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
}

/** Fake RevenueCat REST API: answers each request with the next scripted status (default 200). */
class FakeRevenueCatServer {
  readonly requests: RcRequest[] = [];
  script: number[] = [];
  fallback = 200;
  origin = '';
  #server = createServer((request: IncomingMessage, response: ServerResponse) => {
    this.requests.push({
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      authorization: request.headers.authorization,
    });
    const status = this.script.shift() ?? this.fallback;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(status === 200 ? JSON.stringify({ app_user_id: 'x' }) : '{}');
  });

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    this.origin = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  deletesOf(userId: string): RcRequest[] {
    return this.requests.filter(
      (request) => request.method === 'DELETE' && request.path === `/v1/subscribers/${userId}`,
    );
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.#server.closeAllConnections();
      this.#server.close(() => resolve());
    });
  }
}

const API_KEY = 'not-a-real-revenuecat-key';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;
const rc = new FakeRevenueCatServer();

function restClient(timeoutMs?: number) {
  return createRevenueCatRestClient({
    apiKey: API_KEY,
    baseUrl: rc.origin,
    fetch: globalThis.fetch,
    clock: systemClock,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

beforeAll(async () => {
  await rc.start();
  database = await createTestDatabase('worker_rc_delete');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, {
    queueOverrides: {
      'account.hard_delete': { retryLimit: 1, retryDelaySeconds: 1, retryBackoff: false },
      'revenuecat.subscriber_delete': {
        retryLimit: 3,
        retryDelaySeconds: 1,
        retryBackoff: false,
      },
    },
    extra: {
      revenueCatClient: restClient(),
      revenueCatDeleteRetry: { attempts: 3, baseDelayMs: 20 },
    },
  });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
  await rc.close();
});

beforeEach(() => {
  rc.requests.length = 0;
  rc.script = [];
  rc.fallback = 200;
  provider.responders.set(RESEND_PATH, () => ({ status: 200, body: { id: newId() } }));
});

const db = () => database.admin.db;

/** A deactivated account whose deletion request is due now. */
async function dueDeletion(): Promise<{ userId: string; requestId: string }> {
  const user = await fixtures.user({ deactivatedAt: new Date(Date.now() - 8 * DAY_MS) });
  const graceUntil = new Date(Date.now() - 60_000);
  const [row] = await db()
    .insert(deletionRequests)
    .values({
      userId: user.id,
      requestedAt: new Date(graceUntil.getTime() - 7 * DAY_MS),
      graceUntil,
    })
    .returning({ id: deletionRequests.id });
  if (!row) throw new Error('deletion request insert failed');
  return { userId: user.id, requestId: row.id };
}

async function runDeletion(requestId: string) {
  const jobId = await enqueue(worker.runtime.boss, 'account.hard_delete', {
    deletionRequestId: requestId,
    idempotencyKey: `${hardDeleteIdempotencyKey(requestId)}:${newId()}`,
  });
  return waitForJobState(database, 'account.hard_delete', jobId ?? '', ['completed'], 30_000);
}

async function requestRow(requestId: string) {
  const [row] = await db()
    .select()
    .from(deletionRequests)
    .where(eq(deletionRequests.id, requestId));
  return row;
}

async function userGone(userId: string): Promise<boolean> {
  return (await db().select().from(users).where(eq(users.id, userId))).length === 0;
}

function deletionLog(userCount: number) {
  return worker.logs
    .entries()
    .filter((entry) => entry.msg === 'account deleted')
    .at(userCount);
}

async function followUps(requestId: string) {
  return (await jobsIn(database, 'revenuecat.subscriber_delete')).filter(
    (job) => job.data.deletionRequestId === requestId,
  );
}

function context(): JobContext {
  return {
    jobId: newId(),
    queue: 'revenuecat.subscriber_delete',
    retryCount: 0,
    createdOn: new Date(),
    singletonKey: null,
    logger: captureLogs().logger,
    signal: new AbortController().signal,
  };
}

describe('account.hard_delete with a RevenueCat key (ADR-0082)', () => {
  it('deletes the subscriber by account id before committing and leaves nothing pending', async () => {
    const { userId, requestId } = await dueDeletion();
    const logsBefore = worker.logs.entries().filter((e) => e.msg === 'account deleted').length;
    const job = await runDeletion(requestId);

    expect(job.output).toEqual({ outcome: 'deleted' });
    expect(rc.deletesOf(userId)).toEqual([
      { method: 'DELETE', path: `/v1/subscribers/${userId}`, authorization: `Bearer ${API_KEY}` },
    ]);
    expect(await userGone(userId)).toBe(true);
    const request = await requestRow(requestId);
    expect(request?.completedAt).not.toBeNull();
    expect(request?.externalPending).toEqual([]);
    expect(await followUps(requestId)).toEqual([]);
    expect(deletionLog(logsBefore)).toMatchObject({ revenueCat: 'deleted' });
    // The API key never reaches the log.
    expect(worker.logs.lines.some((line) => line.includes(API_KEY))).toBe(false);
  });

  it('treats 404 as already deleted', async () => {
    const { userId, requestId } = await dueDeletion();
    rc.script = [404];
    const logsBefore = worker.logs.entries().filter((e) => e.msg === 'account deleted').length;
    await runDeletion(requestId);

    expect(rc.deletesOf(userId)).toHaveLength(1);
    expect((await requestRow(requestId))?.externalPending).toEqual([]);
    expect(await followUps(requestId)).toEqual([]);
    expect(deletionLog(logsBefore)).toMatchObject({ revenueCat: 'not_found' });
  });

  it('retries 5xx and 429 with backoff inside the job and succeeds', async () => {
    const { userId, requestId } = await dueDeletion();
    rc.script = [503, 429];
    await runDeletion(requestId);

    expect(rc.deletesOf(userId)).toHaveLength(3);
    expect((await requestRow(requestId))?.externalPending).toEqual([]);
    expect(await followUps(requestId)).toEqual([]);
  });

  it('never blocks the deletion: a persistent failure is recorded and handed to the follow-up job', async () => {
    const { userId, requestId } = await dueDeletion();
    rc.fallback = 500;
    const failedBefore = worker.metrics.count('revenuecat_delete_failed', { stage: 'hard_delete' });
    const job = await runDeletion(requestId);

    // The database deletion completed in the first run, whatever RevenueCat answered.
    expect(job.output).toEqual({ outcome: 'deleted' });
    expect(job.retryCount).toBe(0);
    expect(await userGone(userId)).toBe(true);
    expect(rc.deletesOf(userId).length).toBeGreaterThanOrEqual(3);
    const request = await requestRow(requestId);
    expect(request?.completedAt).not.toBeNull();
    expect(request?.externalPending).toEqual(['revenuecat']);
    expect(worker.metrics.count('revenuecat_delete_failed', { stage: 'hard_delete' })).toBe(
      failedBefore + 1,
    );
    expect(
      worker.metrics.recorded
        .filter(
          (metric) =>
            metric.name === 'revenuecat_delete_failed' && metric.labels.stage === 'hard_delete',
        )
        .at(-1)?.labels,
    ).toEqual({ stage: 'hard_delete', reason: 'http_status', status: 500, attempts: 3 });

    const [followUp] = await followUps(requestId);
    expect(followUp?.data).toEqual({
      deletionRequestId: requestId,
      appUserId: userId,
      idempotencyKey: subscriberDeleteIdempotencyKey(requestId),
    });

    // RevenueCat recovers: the follow-up retries with the queue's backoff and clears the record.
    rc.fallback = 200;
    const done = await waitForJobState(
      database,
      'revenuecat.subscriber_delete',
      followUp?.id ?? '',
      ['completed'],
      30_000,
    );
    expect(done.output).toEqual({ outcome: 'deleted' });
    expect((await requestRow(requestId))?.externalPending).toEqual([]);
    expect(rc.deletesOf(userId).at(-1)?.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('dead-letters the follow-up after its last retry so the operator sees it', async () => {
    const { userId, requestId } = await dueDeletion();
    rc.fallback = 503;
    await runDeletion(requestId);
    const [followUp] = await followUps(requestId);
    const failed = await waitForJobState(
      database,
      'revenuecat.subscriber_delete',
      followUp?.id ?? '',
      ['failed'],
      40_000,
    );
    expect(failed.output).toMatchObject({ errorType: 'TransientJobError' });
    await waitFor(
      async () =>
        (await jobsIn(database, 'revenuecat.subscriber_delete.dead')).find(
          (job) => job.data.deletionRequestId === requestId,
        ),
      { label: 'dead letter', timeoutMs: 20_000 },
    );
    expect((await requestRow(requestId))?.externalPending).toEqual(['revenuecat']);
    expect(await userGone(userId)).toBe(true);
    expect(
      worker.metrics.count('revenuecat_delete_failed', { stage: 'follow_up' }),
    ).toBeGreaterThan(0);
  });

  it('does not retry a rejected key inside the job', async () => {
    const { userId, requestId } = await dueDeletion();
    rc.script = [401];
    rc.fallback = 200;
    await runDeletion(requestId);
    expect(rc.deletesOf(userId).length).toBeGreaterThanOrEqual(1);
    // The inline call is not retried (attempts 1); a later DELETE comes from the follow-up job.
    const metric = worker.metrics.recorded
      .filter((m) => m.name === 'revenuecat_delete_failed' && m.labels.stage === 'hard_delete')
      .at(-1);
    expect(metric?.labels).toEqual({
      stage: 'hard_delete',
      reason: 'unauthorized',
      status: 401,
      attempts: 1,
    });
    const [followUp] = await followUps(requestId);
    await waitForJobState(database, 'revenuecat.subscriber_delete', followUp?.id ?? '', [
      'completed',
    ]);
    expect((await requestRow(requestId))?.externalPending).toEqual([]);
  });
});

describe('without a RevenueCat key', () => {
  it('skips the call and records the cleanup owed only for an account with a subscription', async () => {
    const metrics = new MetricsRecorder();
    const handler = createHardDeleteHandler({
      db: worker.runtime.db,
      boss: worker.runtime.boss,
      storage: {
        head: () => Promise.resolve(null),
        read: () => Promise.resolve(null),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        list: () => Promise.resolve({ objects: [] }),
      },
      buckets: { incoming: TEST_INCOMING_BUCKET, media: TEST_MEDIA_BUCKET },
      emailTransport: { name: 'log', send: () => Promise.resolve() },
      webOrigin: 'http://localhost:3000',
      clock: systemClock,
      metrics,
      revenueCat: { client: null },
    });
    const subscribed = await dueDeletion();
    await db().insert(subscriptions).values({
      userId: subscribed.userId,
      rcAppUserId: subscribed.userId,
      productId: 'kadro_pro_monthly',
      status: 'active',
      environment: 'production',
    });
    const plain = await dueDeletion();
    const run = (requestId: string) =>
      handler(
        { deletionRequestId: requestId, idempotencyKey: hardDeleteIdempotencyKey(requestId) },
        { ...context(), queue: 'account.hard_delete' },
      );

    expect(await run(subscribed.requestId)).toBe('deleted');
    expect(await run(plain.requestId)).toBe('deleted');
    expect((await requestRow(subscribed.requestId))?.externalPending).toEqual(['revenuecat']);
    expect((await requestRow(plain.requestId))?.externalPending).toEqual([]);
    expect(rc.requests).toEqual([]);
    expect(await followUps(subscribed.requestId)).toEqual([]);
    expect(metrics.count('revenuecat_delete_failed')).toBe(0);
  });

  it('completes a follow-up as skipped', async () => {
    const handler = createSubscriberDeleteHandler({
      db: worker.runtime.db,
      clock: systemClock,
      metrics: new MetricsRecorder(),
      client: null,
    });
    expect(
      await handler(
        { deletionRequestId: newId(), appUserId: newId(), idempotencyKey: `rc-delete:${newId()}` },
        context(),
      ),
    ).toBe('skipped_unconfigured');
    expect(rc.requests).toEqual([]);
  });
});

describe('revenuecat.subscriber_delete guards', () => {
  function handler() {
    return createSubscriberDeleteHandler({
      db: worker.runtime.db,
      clock: systemClock,
      metrics: new MetricsRecorder(),
      client: restClient(),
    });
  }

  it('never deletes the subscriber of an account that still exists', async () => {
    const { userId, requestId } = await dueDeletion();
    await db()
      .update(deletionRequests)
      .set({ completedAt: new Date(), externalPending: ['revenuecat'] })
      .where(eq(deletionRequests.id, requestId));
    const outcome = await handler()(
      { deletionRequestId: requestId, appUserId: userId, idempotencyKey: `rc-delete:${requestId}` },
      context(),
    );
    expect(outcome).toBe('skipped_account_exists');
    expect(rc.requests).toEqual([]);
  });

  it('skips unknown, unfinished and already cleared requests', async () => {
    const unknown = await handler()(
      { deletionRequestId: newId(), appUserId: newId(), idempotencyKey: `rc-delete:${newId()}` },
      context(),
    );
    expect(unknown).toBe('skipped_missing');
    const { requestId } = await dueDeletion();
    const pendingRun = await handler()(
      {
        deletionRequestId: requestId,
        appUserId: newId(),
        idempotencyKey: `rc-delete:${requestId}`,
      },
      context(),
    );
    expect(pendingRun).toBe('skipped_not_completed');
    await db()
      .update(deletionRequests)
      .set({ completedAt: new Date() })
      .where(eq(deletionRequests.id, requestId));
    const cleared = await handler()(
      {
        deletionRequestId: requestId,
        appUserId: newId(),
        idempotencyKey: `rc-delete:${requestId}`,
      },
      context(),
    );
    expect(cleared).toBe('skipped_done');
    expect(rc.requests).toEqual([]);
  });
});

describe('REST DELETE /v1/subscribers/{app_user_id}', () => {
  it('maps statuses and stops retrying on permanent errors', async () => {
    const client = restClient();
    const fast = { attempts: 4, baseDelayMs: 1 };
    const id = newId();

    rc.script = [200];
    expect(await deleteSubscriberWithRetry(client, id, fast)).toEqual({
      ok: true,
      outcome: 'deleted',
      attempts: 1,
    });
    rc.script = [500, 502, 429, 404];
    expect(await deleteSubscriberWithRetry(client, id, fast)).toEqual({
      ok: true,
      outcome: 'not_found',
      attempts: 4,
    });
    rc.script = [503, 503, 503, 503, 200];
    expect(await deleteSubscriberWithRetry(client, id, fast)).toEqual({
      ok: false,
      reason: 'http_status',
      status: 503,
      attempts: 4,
    });
    rc.script = [403];
    expect(await deleteSubscriberWithRetry(client, id, fast)).toEqual({
      ok: false,
      reason: 'unauthorized',
      status: 403,
      attempts: 1,
    });
    rc.script = [400];
    expect(await deleteSubscriberWithRetry(client, id, fast)).toEqual({
      ok: false,
      reason: 'http_status',
      status: 400,
      attempts: 1,
    });
    expect(rc.requests.every((request) => request.method === 'DELETE')).toBe(true);
    expect(rc.requests).toHaveLength(1 + 4 + 4 + 1 + 1);
  });

  it('reports an unreachable API as a transient network failure', async () => {
    const client = createRevenueCatRestClient({
      apiKey: API_KEY,
      baseUrl: 'http://127.0.0.1:1',
      fetch: globalThis.fetch,
      clock: systemClock,
    });
    expect(
      await deleteSubscriberWithRetry(client, newId(), { attempts: 2, baseDelayMs: 1 }),
    ).toEqual({ ok: false, reason: 'network', attempts: 2 });
  });
});
