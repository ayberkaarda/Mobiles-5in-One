import { users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PG_BOSS_SCHEMA, sessionRoleOption } from '../../lib/server/jobs/client';
import { contentIdempotencyKey, JobContractError } from '../../lib/server/jobs/enqueue';
import { storedJobs } from '../support/jobs';
import { type JobsHarness, setupJobsHarness } from './support';

/**
 * ADR-0028 web → worker path with the real database roles: `kadro_app` inserts the job inside its
 * own domain transaction, `kadro_worker` can fetch and complete it, a rolled-back transaction
 * leaves no job, and a failed enqueue rolls the domain write back.
 */

let jobs: JobsHarness;
let database: JobsHarness['database'];
let logins: JobsHarness['logins'];
let app: JobsHarness['app'];
let harness: JobsHarness['harness'];

beforeAll(async () => {
  jobs = await setupJobsHarness('web_jobs_enqueue');
  ({ database, logins, app, harness } = jobs);
});

afterAll(async () => {
  await jobs.dispose();
});

let counter = 0;
function newUser() {
  counter += 1;
  return { email: `kuyruk${counter}-${Date.now()}@example.test`, displayName: 'Kuyruk Oyuncu' };
}

const REQUEST_ID = 'req_enqueue_test';

describe('transactional enqueue as kadro_app (ADR-0028)', () => {
  it('commits the job with the domain write, and kadro_worker can process it', async () => {
    const userId = await app.db.transaction(async (tx) => {
      const [row] = await tx.insert(users).values(newUser()).returning({ id: users.id });
      const id = row?.id ?? '';
      const jobId = await harness.runtime.jobs.enqueue(
        tx,
        'email.send',
        { kind: 'verify_email', userId: id, requestId: REQUEST_ID },
        { idempotencyKey: `email:verify:${id}:${REQUEST_ID}` },
      );
      expect(jobId).toEqual(expect.any(String));
      return id;
    });

    const [job] = (await storedJobs(database.url, 'email.send')).filter(
      (entry) => entry.singletonKey === `email:verify:${userId}:${REQUEST_ID}`,
    );
    expect(job).toMatchObject({
      state: 'created',
      data: {
        kind: 'verify_email',
        userId,
        requestId: REQUEST_ID,
        idempotencyKey: `email:verify:${userId}:${REQUEST_ID}`,
      },
    });

    const worker = new PgBoss({
      connectionString: logins.workerUrl,
      options: sessionRoleOption('kadro_worker'),
      schema: PG_BOSS_SCHEMA,
      supervise: false,
      schedule: false,
      migrate: false,
      createSchema: false,
    });
    worker.on('error', () => undefined);
    await worker.start();
    try {
      const fetched = await worker.fetch('email.send', { batchSize: 10 });
      const mine = fetched.find((entry) => entry.id === job?.id);
      expect(mine?.data).toEqual(job?.data);
      await worker.complete('email.send', mine?.id ?? '');
    } finally {
      await worker.stop({ graceful: false });
    }
    const [done] = (await storedJobs(database.url, 'email.send')).filter(
      (entry) => entry.id === job?.id,
    );
    expect(done?.state).toBe('completed');
  });

  it('leaves no job when the domain transaction rolls back', async () => {
    const key = `email:verify:rolled-back:${Date.now()}`;
    let insertedId = '';
    await expect(
      app.db.transaction(async (tx) => {
        const [row] = await tx.insert(users).values(newUser()).returning({ id: users.id });
        insertedId = row?.id ?? '';
        await harness.runtime.jobs.enqueue(
          tx,
          'email.send',
          { kind: 'verify_email', userId: insertedId, requestId: REQUEST_ID },
          { idempotencyKey: key },
        );
        throw new Error('domain rule failed after enqueue');
      }),
    ).rejects.toThrow('domain rule failed after enqueue');
    const jobs = await storedJobs(database.url, 'email.send');
    expect(jobs.some((job) => job.singletonKey === key)).toBe(false);
    expect(await app.db.select().from(users).where(eq(users.id, insertedId))).toEqual([]);
  });

  it('rolls the domain write back when the job cannot be enqueued', async () => {
    const values = newUser();
    await expect(
      app.db.transaction(async (tx) => {
        await tx.insert(users).values(values);
        // verify_email requires a user id: a contract violation aborts the transaction.
        await harness.runtime.jobs.enqueue(
          tx,
          'email.send',
          { kind: 'verify_email', userId: null, requestId: REQUEST_ID },
          { idempotencyKey: `email:verify:none:${Date.now()}` },
        );
      }),
    ).rejects.toBeInstanceOf(JobContractError);
    expect(await app.db.select().from(users).where(eq(users.email, values.email))).toEqual([]);
  });

  it('drops a duplicate key while the first job is queued, and counts that as success', async () => {
    const key = `email:reset:none:dup-${Date.now()}`;
    const ids = await app.db.transaction(async (tx) => {
      const first = await harness.runtime.jobs.enqueue(
        tx,
        'email.send',
        { kind: 'password_reset', userId: null, requestId: REQUEST_ID },
        { idempotencyKey: key },
      );
      const second = await harness.runtime.jobs.enqueue(
        tx,
        'email.send',
        { kind: 'password_reset', userId: null, requestId: REQUEST_ID },
        { idempotencyKey: key },
      );
      return [first, second];
    });
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBeNull();
    const second = await app.db.transaction((tx) =>
      harness.runtime.jobs.enqueue(
        tx,
        'email.send',
        { kind: 'password_reset', userId: null, requestId: 'req_other' },
        { idempotencyKey: key },
      ),
    );
    expect(second).toBeNull();
    const jobs = await storedJobs(database.url, 'email.send');
    expect(jobs.filter((job) => job.singletonKey === key)).toHaveLength(1);
  });

  it('honours startAfter', async () => {
    const startAfter = new Date(Date.now() + 3 * 3_600_000);
    const key = `upload:${crypto.randomUUID()}`;
    await app.db.transaction((tx) =>
      harness.runtime.jobs.enqueue(
        tx,
        'upload.process',
        { uploadId: '01920000-0000-7000-8000-000000000123' },
        { idempotencyKey: key, startAfter },
      ),
    );
    const [job] = (await storedJobs(database.url, 'upload.process')).filter(
      (entry) => entry.singletonKey === key,
    );
    expect(job?.startAfter.getTime()).toBe(startAfter.getTime());
  });
});

describe('payload contract (strict, ids only)', () => {
  const SENTINEL = 'payload-value-not-echoed';

  it('rejects unknown keys and personal data without echoing values', async () => {
    const error = await app.db
      .transaction((tx) =>
        harness.runtime.jobs.enqueue(
          tx,
          'email.send',
          {
            kind: 'password_reset',
            userId: null,
            requestId: REQUEST_ID,
            email: `${SENTINEL}@example.test`,
          } as never,
          { idempotencyKey: `email:reset:none:strict-${Date.now()}` },
        ),
      )
      .then(
        () => null,
        (reason: unknown) => reason,
      );
    expect(error).toBeInstanceOf(JobContractError);
    expect(String((error as Error).message)).not.toContain(SENTINEL);
  });

  it('rejects wrong types and malformed idempotency keys', async () => {
    const attempts = [
      () =>
        app.db.transaction((tx) =>
          harness.runtime.jobs.enqueue(
            tx,
            'push.send',
            { type: 'match.updated', userId: 'not-a-uuid', refId: 'x' } as never,
            { idempotencyKey: 'push:bad' },
          ),
        ),
      () =>
        app.db.transaction((tx) =>
          harness.runtime.jobs.enqueue(
            tx,
            'email.send',
            { kind: 'password_reset', userId: null, requestId: REQUEST_ID },
            { idempotencyKey: 'has spaces and ünicode' },
          ),
        ),
      () =>
        app.db.transaction((tx) =>
          harness.runtime.jobs.enqueue(
            tx,
            'email.send',
            { kind: 'password_reset', userId: null, requestId: REQUEST_ID },
            { idempotencyKey: 'k'.repeat(129) },
          ),
        ),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(JobContractError);
    }
  });

  it('derives a content key independent of property order', () => {
    const a = contentIdempotencyKey('push.send', { type: 'rsvp.changed', userId: 'u', refId: 'r' });
    const b = contentIdempotencyKey('push.send', { refId: 'r', userId: 'u', type: 'rsvp.changed' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(contentIdempotencyKey('email.send', { refId: 'r' })).not.toBe(a);
  });
});

describe('kadro_app is send-only', () => {
  it('cannot read job payloads or the worker receipts', async () => {
    await expect(app.pool.query('select data from pgboss.job limit 1')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(app.pool.query('select * from job_receipts limit 1')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
