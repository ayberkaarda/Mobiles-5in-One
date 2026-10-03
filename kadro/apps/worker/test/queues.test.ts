import {
  BILLING_JOB_QUEUES,
  COST_GUARD_CRON,
  JOB_PAYLOAD_SCHEMAS,
  JOB_QUEUES,
  SUBSCRIPTION_RECONCILE_CRON,
} from '@kadro/contracts';
import { emailTokens, newId } from '@kadro/db';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sessionRoleOption } from '../src/boss.js';
import {
  COMPLETED_RETENTION_SECONDS,
  DEAD_LETTER_RETENTION_SECONDS,
  PG_BOSS_SCHEMA,
  QUEUE_DEFINITIONS,
  SCHEDULE_TIME_ZONE,
  allQueueNames,
} from '../src/queues.js';
import {
  type FakeProvider,
  Fixtures,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitFor,
  waitForJobState,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;

beforeAll(async () => {
  database = await createTestDatabase('worker_queues');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider);
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

describe('queue bootstrap (ADR-0028)', () => {
  it('creates every queue of the contract and its dead-letter queue', async () => {
    const queues = await worker.runtime.boss.getQueues();
    const names = queues.map((queue) => queue.name).sort();
    expect(names).toEqual(allQueueNames().sort());
    expect(JOB_QUEUES).toHaveLength(12);
  });

  it('applies the retry, backoff, expiry and dead-letter table of ADR-0028', async () => {
    for (const name of JOB_QUEUES) {
      const definition = QUEUE_DEFINITIONS[name];
      const queue = await worker.runtime.boss.getQueue(name);
      expect(queue, name).toMatchObject({
        policy: 'exclusive',
        retryLimit: definition.retryLimit,
        retryDelay: definition.retryDelaySeconds,
        retryBackoff: definition.retryBackoff,
        expireInSeconds: definition.expireInSeconds,
        deleteAfterSeconds: COMPLETED_RETENTION_SECONDS,
        deadLetter: `${name}.dead`,
      });
      const dead = await worker.runtime.boss.getQueue(`${name}.dead`);
      expect(dead, `${name}.dead`).toMatchObject({
        policy: 'standard',
        retryLimit: 0,
        retentionSeconds: DEAD_LETTER_RETENTION_SECONDS,
      });
    }
    expect(QUEUE_DEFINITIONS['email.send']).toMatchObject({
      retryLimit: 5,
      retryDelaySeconds: 30,
      retryBackoff: true,
      localConcurrency: 4,
    });
    for (const name of BILLING_JOB_QUEUES) {
      expect(QUEUE_DEFINITIONS[name], name).toMatchObject({ name, stage: 'active' });
    }
    expect(QUEUE_DEFINITIONS['account.hard_delete']).toMatchObject({
      retryLimit: 10,
      retryDelaySeconds: 300,
      retryBackoff: true,
      expireInSeconds: 600,
    });
  });

  it('registers the hourly schedules in Europe/Istanbul and the nightly reconciliation in UTC', async () => {
    const schedules = await worker.runtime.boss.getSchedules();
    const byName = Object.fromEntries(schedules.map((schedule) => [schedule.name, schedule]));
    expect(byName['opencall.expire']).toMatchObject({
      cron: '5 * * * *',
      timezone: SCHEDULE_TIME_ZONE,
      data: { idempotencyKey: 'schedule:opencall.expire' },
    });
    expect(byName['maintenance.sweep']).toMatchObject({
      cron: '35 * * * *',
      timezone: SCHEDULE_TIME_ZONE,
    });
    expect(byName['subscription.reconcile']).toMatchObject({
      cron: SUBSCRIPTION_RECONCILE_CRON,
      timezone: 'UTC',
      data: { userId: null, idempotencyKey: 'schedule:subscription.reconcile' },
    });
    expect(byName['cost.guard']).toMatchObject({
      cron: COST_GUARD_CRON,
      timezone: 'UTC',
      data: { idempotencyKey: 'schedule:cost.guard' },
    });
    expect(COST_GUARD_CRON).toBe('*/15 * * * *');
    expect(Object.keys(byName).sort()).toEqual([
      'cost.guard',
      'maintenance.sweep',
      'opencall.expire',
      'subscription.reconcile',
    ]);
    // The scheduled payload satisfies the strict job contract.
    expect(
      JOB_PAYLOAD_SCHEMAS['subscription.reconcile'].safeParse(
        byName['subscription.reconcile']?.data,
      ).success,
    ).toBe(true);
    expect(SUBSCRIPTION_RECONCILE_CRON).toBe('17 3 * * *');
  });

  it('runs every worker session as kadro_worker, which owns the pg-boss tables', async () => {
    const owners = await database.admin.pool.query<{ owner: string }>(
      "select distinct tableowner as owner from pg_tables where schemaname = 'pgboss'",
    );
    expect(owners.rows).toEqual([{ owner: 'kadro_worker' }]);
    const sessions = await database.admin.pool.query<{ role: string }>(
      "select distinct usename as role from pg_stat_activity where datname = $1 and application_name = 'kadro-worker'",
      [database.name],
    );
    expect(sessions.rows.length).toBeGreaterThan(0);
    expect(sessions.rows.every((row) => row.role.startsWith('worker_'))).toBe(true);
  });

  it('is idempotent when a second worker instance bootstraps the same database', async () => {
    const second = await startTestWorker(database, provider);
    try {
      const queues = await second.runtime.boss.getQueues();
      expect(queues).toHaveLength(allQueueNames().length);
      expect(await second.runtime.boss.getSchedules()).toHaveLength(4);
    } finally {
      await second.runtime.stop();
    }
  });
});

describe('web → worker path with database roles (ADR-0028)', () => {
  it('lets kadro_app enqueue inside its own transaction and kadro_worker process the job', async () => {
    const user = await fixtures.user({ verified: false });
    const appClient = new pg.Client({
      connectionString: database.appUrl,
      options: sessionRoleOption('kadro_app'),
    });
    await appClient.connect();
    const sendOnly = new PgBoss({
      connectionString: database.appUrl,
      options: sessionRoleOption('kadro_app'),
      schema: PG_BOSS_SCHEMA,
      supervise: false,
      schedule: false,
      migrate: false,
      createSchema: false,
    });
    sendOnly.on('error', () => undefined);
    let extraGrant = false;
    try {
      try {
        await sendOnly.start();
      } catch (error) {
        // Migration 0010's grant function does not cover the pg-boss version table that a
        // send-only client reads on start (handoff worker-to-db-001). Prove that this is the only
        // gap, then grant it the way the handoff proposes.
        expect((error as { code?: string }).code).toBe('42501');
        expect(String((error as Error).message)).toContain('version');
        await database.admin.pool.query('grant select on pgboss.version to kadro_app');
        extraGrant = true;
        await sendOnly.start();
      }

      const idempotencyKey = `email:verify:${user.id}:${newId()}`;
      const payload = {
        kind: 'verify_email',
        userId: user.id,
        requestId: 'req_app_role',
        idempotencyKey,
      };
      await appClient.query('begin');
      const jobId = await sendOnly.send('email.send', payload, {
        singletonKey: idempotencyKey,
        db: { executeSql: (text, values) => appClient.query(text, values) },
      });
      const duplicate = await sendOnly.send('email.send', payload, {
        singletonKey: idempotencyKey,
        db: { executeSql: (text, values) => appClient.query(text, values) },
      });
      await appClient.query('commit');
      expect(jobId).toEqual(expect.any(String));
      expect(duplicate).toBeNull();

      // Rolled back with the domain write: no job.
      await appClient.query('begin');
      await sendOnly.send(
        'email.send',
        { ...payload, idempotencyKey: `${idempotencyKey}-rolled-back` },
        {
          singletonKey: `${idempotencyKey}-rolled-back`,
          db: { executeSql: (text, values) => appClient.query(text, values) },
        },
      );
      await appClient.query('rollback');

      await waitForJobState(database, 'email.send', jobId ?? '', ['completed']);
      const tokens = await database.admin.db
        .select()
        .from(emailTokens)
        .where(eq(emailTokens.userId, user.id));
      expect(tokens).toHaveLength(1);
      const jobs = await jobsIn(database, 'email.send');
      expect(jobs.some((job) => job.singletonKey === `${idempotencyKey}-rolled-back`)).toBe(false);

      // The web role still cannot read job payloads or the worker's receipts.
      await expect(appClient.query('select data from pgboss.job limit 1')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(appClient.query('select * from job_receipts limit 1')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await appClient.end();
      await sendOnly.stop({ graceful: false }).catch(() => undefined);
      if (extraGrant) {
        await database.admin.pool.query('revoke select on pgboss.version from kadro_app');
      }
    }
  });

  it('reports ready through the health file once the handlers are registered', async () => {
    expect(worker.runtime.health.status).toBe('ready');
    await waitFor(async () => worker.logs.lines.some((line) => line.includes('worker ready')));
  });
});
