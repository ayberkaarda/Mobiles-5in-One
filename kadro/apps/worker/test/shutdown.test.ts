import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId } from '@kadro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { enqueue } from '../src/enqueue.js';
import { HEALTH_MAX_AGE_MS, HealthReporter, readHealth } from '../src/health.js';
import {
  type FakeProvider,
  Fixtures,
  RESEND_PATH,
  type TestDatabase,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitFor,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let fixtures: Fixtures;

beforeAll(async () => {
  database = await createTestDatabase('worker_shutdown');
  provider = await startFakeProvider();
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await provider.close();
  await database.dispose();
});

async function verifyJob(userId: string) {
  const idempotencyKey = `email:verify:${userId}:${newId()}`;
  const jobId = await enqueue(
    // Any started instance can send; the queue already exists after the first worker started.
    sender,
    'email.send',
    { kind: 'verify_email', userId, requestId: 'req_shutdown', idempotencyKey },
  );
  return { jobId: jobId ?? '', idempotencyKey };
}

let sender: Parameters<typeof enqueue>[0];

/** Short retry delay so the hand-over to the next instance is observable within the test. */
const queueOverrides = {
  'email.send': { retryDelaySeconds: 1, retryBackoff: false },
} as const;

async function stateOf(jobId: string): Promise<string | undefined> {
  return (await jobsIn(database, 'email.send')).find((job) => job.id === jobId)?.state;
}

describe('graceful shutdown (ADR-0028)', () => {
  it('lets an active job finish, then stops fetching and closes', async () => {
    const worker = await startTestWorker(database, provider, {
      shutdownTimeoutMs: 10_000,
      queueOverrides,
    });
    sender = worker.runtime.boss;
    provider.responders.set(RESEND_PATH, () => ({
      status: 200,
      body: { id: newId() },
      delayMs: 1_500,
    }));
    const user = await fixtures.user({ verified: false });
    const { jobId } = await verifyJob(user.id);
    await waitFor(async () => provider.requests.some((r) => r.path === RESEND_PATH));
    expect(await stateOf(jobId)).toBe('active');

    const started = Date.now();
    await worker.runtime.stop();
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(await stateOf(jobId)).toBe('completed');
    expect(worker.runtime.health.status).toBe('stopped');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary status file of this test
    expect(existsSync(worker.runtime.health.file)).toBe(false);
  });

  it('hands a job that outlives the deadline back for retry by the next instance', async () => {
    const worker = await startTestWorker(database, provider, {
      shutdownTimeoutMs: 300,
      queueOverrides,
    });
    sender = worker.runtime.boss;
    provider.responders.set(RESEND_PATH, () => ({
      status: 200,
      body: { id: newId() },
      delayMs: 4_000,
    }));
    const user = await fixtures.user({ verified: false });
    const { jobId } = await verifyJob(user.id);
    await waitFor(async () => (await stateOf(jobId)) === 'active');

    const started = Date.now();
    await worker.runtime.stop();
    expect(Date.now() - started).toBeLessThan(3_500);
    expect(await stateOf(jobId)).toBe('retry');

    const next = await startTestWorker(database, provider, { queueOverrides });
    try {
      provider.responders.set(RESEND_PATH, () => ({ status: 200, body: { id: newId() } }));
      await waitFor(async () => (await stateOf(jobId)) === 'completed', { timeoutMs: 30_000 });
    } finally {
      await next.runtime.stop();
    }
  });

  it('fetches nothing after stop', async () => {
    const worker = await startTestWorker(database, provider, { queueOverrides });
    const user = await fixtures.user({ verified: false });
    await worker.runtime.stop();

    const second = await startTestWorker(database, provider, { queueOverrides });
    // Enqueue through a live instance, but stop it before its first poll can claim the job.
    await second.runtime.boss.offWork('email.send');
    sender = second.runtime.boss;
    const { jobId } = await verifyJob(user.id);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await stateOf(jobId)).toBe('created');
    await second.runtime.stop();
  });
});

describe('health signal', () => {
  it('reports ready only while fresh, and unhealthy for any other state', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'kadro-health-')), 'health.json');
    const at = new Date('2031-02-01T10:00:00.000Z');
    const reporter = new HealthReporter(file, () => at);
    expect(await readHealth(file, at)).toEqual({ healthy: false, reason: 'no status file' });
    await reporter.set('starting');
    expect((await readHealth(file, at)).healthy).toBe(false);
    await reporter.set('ready');
    expect(await readHealth(file, at)).toEqual({ healthy: true });
    expect((await readHealth(file, new Date(at.getTime() + HEALTH_MAX_AGE_MS + 1))).healthy).toBe(
      false,
    );
    await reporter.set('stopping');
    expect((await readHealth(file, at)).healthy).toBe(false);
    await reporter.clear();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- temporary status file of this test
    expect(existsSync(file)).toBe(false);
  });
});
