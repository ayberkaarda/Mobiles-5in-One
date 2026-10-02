import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PG_INSUFFICIENT_PRIVILEGE,
  type TestDatabase,
  createMigratedDatabase,
  expectPgError,
} from './support.js';

const SCHEMA = 'pgboss';
const QUEUE = 'email.send';

/** Connects as the test superuser and switches the session to a group role. */
function asRole(role: 'kadro_app' | 'kadro_worker'): string {
  return `-c role=${role}`;
}

let testDb: TestDatabase;
let worker: PgBoss;
let app: PgBoss;
let appSql: pg.Client;

beforeAll(async () => {
  testDb = await createMigratedDatabase('kadro_pgboss');

  // The worker owns the pgboss schema: it runs pg-boss migrations and creates the queue.
  worker = new PgBoss({
    connectionString: testDb.url,
    options: asRole('kadro_worker'),
    schema: SCHEMA,
    supervise: false,
    schedule: false,
    // Migration 0010 created the schema and handed it to kadro_worker.
    createSchema: false,
  });
  worker.on('error', () => undefined);
  await worker.start();
  // Same policy as the worker's source queues (singletonKey de-duplicates queued jobs).
  await worker.createQueue(QUEUE, { policy: 'exclusive' });
  const workerSql = new pg.Client({
    connectionString: testDb.url,
    options: asRole('kadro_worker'),
  });
  await workerSql.connect();
  try {
    await workerSql.query('select public.kadro_grant_pgboss_send_access()');
  } finally {
    await workerSql.end();
  }

  app = new PgBoss({
    connectionString: testDb.url,
    options: asRole('kadro_app'),
    schema: SCHEMA,
    supervise: false,
    schedule: false,
    migrate: false,
    createSchema: false,
  });
  app.on('error', () => undefined);
  appSql = new pg.Client({ connectionString: testDb.url, options: asRole('kadro_app') });
  await appSql.connect();
});

afterAll(async () => {
  await appSql.end();
  await app.stop({ graceful: false }).catch(() => undefined);
  await worker.stop({ graceful: false }).catch(() => undefined);
  await testDb.dispose();
});

describe('kadro_app as a send-only pg-boss client (handoff worker-to-db-001)', () => {
  it('starts and sends, with singleton de-duplication, and the worker receives the job', async () => {
    await app.start();
    const id = await app.send(QUEUE, { userId: 'u1' }, { singletonKey: 'email:verify:u1:r1' });
    expect(id).toEqual(expect.any(String));
    const duplicate = await app.send(
      QUEUE,
      { userId: 'u1' },
      { singletonKey: 'email:verify:u1:r1' },
    );
    expect(duplicate).toBeNull();

    const [job] = await worker.fetch(QUEUE);
    expect(job?.id).toBe(id);
    expect(job?.data).toEqual({ userId: 'u1' });
  });

  it('enqueues inside the caller transaction and rolls back with it', async () => {
    await appSql.query('begin');
    const id = await app.send(
      QUEUE,
      { userId: 'u2' },
      { db: { executeSql: (text, values) => appSql.query(text, values) } },
    );
    await appSql.query('rollback');
    expect(id).toEqual(expect.any(String));
    expect(await worker.getJobById(QUEUE, id ?? '')).toBeNull();
  });

  it('cannot fetch, complete, read payloads or write any other pg-boss table', async () => {
    await expectPgError(app.fetch(QUEUE), PG_INSUFFICIENT_PRIVILEGE);
    const id = (await app.send(QUEUE, { userId: 'u3' })) ?? '';
    await expectPgError(app.complete(QUEUE, id), PG_INSUFFICIENT_PRIVILEGE);
    await expectPgError(app.deleteJob(QUEUE, id), PG_INSUFFICIENT_PRIVILEGE);
    await expectPgError(app.createQueue('other.queue'), PG_INSUFFICIENT_PRIVILEGE);

    for (const statement of [
      'select data from pgboss.job',
      "update pgboss.job set state = 'completed'",
      'delete from pgboss.job',
      "update pgboss.queue set retry_limit = 0 where name = 'email.send'",
      'select * from pgboss.schedule',
      'delete from pgboss.version',
      "insert into job_receipts (id, queue, idempotency_key) values (gen_random_uuid(), 'q', 'k')",
    ]) {
      await expectPgError(appSql.query(statement), PG_INSUFFICIENT_PRIVILEGE);
    }
  });

  it('holds exactly the minimal grant set inside the pgboss schema', async () => {
    const { rows } = await appSql.query<{ grant: string }>(
      `select c.relname || ':' || p.privilege as grant
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
        where n.nspname = 'pgboss' and c.relkind in ('r', 'p')
          and has_table_privilege('kadro_app', c.oid, p.privilege)
        order by 1`,
    );
    const { rows: partitions } = await appSql.query<{ relname: string }>(
      "select c.relname from pg_partition_tree('pgboss.job') t join pg_class c on c.oid = t.relid order by 1",
    );
    const expected = [
      'queue:SELECT',
      'version:SELECT',
      ...partitions.map((row) => `${row.relname}:INSERT`),
    ].sort();
    expect(rows.map((row) => row.grant).sort()).toEqual(expected);
  });
});
