import { randomBytes } from 'node:crypto';

import { JOB_QUEUES, type JobQueue } from '@kadro/contracts';
import pg from 'pg';
import { PgBoss } from 'pg-boss';

import { PG_BOSS_SCHEMA, sessionRoleOption } from '../../lib/server/jobs/client';

/**
 * Prepares a test database the way the worker does at start (ADR-0028, apps/worker `boss.ts`):
 * pg-boss tables created by `kadro_worker` (owner of the `pgboss` schema), every queue of the
 * contract with the `exclusive` policy and its `<queue>.dead` queue, then the send-only grants of
 * migrations 0010/0011 for `kadro_app`. Runs with the superuser URL of the test database.
 */
export async function bootstrapJobQueues(adminUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: adminUrl,
    options: sessionRoleOption('kadro_worker'),
    schema: PG_BOSS_SCHEMA,
    createSchema: false,
    supervise: false,
    schedule: false,
    max: 2,
  });
  boss.on('error', () => undefined);
  await boss.start();
  try {
    for (const queue of JOB_QUEUES) {
      const dead = `${queue}.dead`;
      if ((await boss.getQueue(dead)) === null) {
        await boss.createQueue(dead, { policy: 'standard', retryLimit: 0 });
      }
      if ((await boss.getQueue(queue)) === null) {
        await boss.createQueue(queue, { policy: 'exclusive', deadLetter: dead });
      }
    }
  } finally {
    await boss.stop({ graceful: false });
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('select public.kadro_grant_pgboss_send_access()');
  } finally {
    await admin.end();
  }
}

export interface StoredJob {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly singletonKey: string | null;
  readonly startAfter: Date;
  readonly data: Record<string, unknown>;
}

/** Jobs of a queue as stored by pg-boss, oldest first (superuser read; the web role cannot). */
export async function storedJobs(adminUrl: string, queue: JobQueue): Promise<StoredJob[]> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const result = await admin.query<{
      id: string;
      name: string;
      state: string;
      singleton_key: string | null;
      start_after: Date;
      data: Record<string, unknown>;
    }>(
      'select id, name, state, singleton_key, start_after, data from pgboss.job where name = $1 order by created_on, id',
      [queue],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      singletonKey: row.singleton_key,
      startAfter: row.start_after,
      data: row.data,
    }));
  } finally {
    await admin.end();
  }
}

/** Marks jobs completed so a later `storedJobs(..., 'created')` filter skips them. */
export async function completeJobs(adminUrl: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      "update pgboss.job set state = 'completed', completed_on = now() where id = any($1::uuid[])",
      [ids],
    );
  } finally {
    await admin.end();
  }
}

export interface RoleLogins {
  /** Login that is a member of `kadro_app` (the web role). */
  readonly appUrl: string;
  /** Login that is a member of `kadro_worker` (the worker role). */
  readonly workerUrl: string;
  /** Drops both logins (after the database's own connections are closed). */
  drop(): Promise<void>;
}

/**
 * One login per application role for the test database, with passwords generated at run time,
 * as operators create them per environment (migration 0010 creates only the NOLOGIN groups).
 */
export async function createRoleLogins(adminUrl: string): Promise<RoleLogins> {
  const suffix = randomBytes(4).toString('hex');
  const appLogin = `web_app_${suffix}`;
  const workerLogin = `web_worker_${suffix}`;
  const appPassword = randomBytes(18).toString('base64url');
  const workerPassword = randomBytes(18).toString('base64url');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(
      `create role ${admin.escapeIdentifier(appLogin)} login password ${admin.escapeLiteral(appPassword)} in role kadro_app`,
    );
    await admin.query(
      `create role ${admin.escapeIdentifier(workerLogin)} login password ${admin.escapeLiteral(workerPassword)} in role kadro_worker`,
    );
  } finally {
    await admin.end();
  }
  const withLogin = (login: string, password: string): string => {
    const url = new URL(adminUrl);
    url.username = login;
    url.password = password;
    return url.toString();
  };
  return {
    appUrl: withLogin(appLogin, appPassword),
    workerUrl: withLogin(workerLogin, workerPassword),
    drop: async () => {
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      try {
        for (const login of [appLogin, workerLogin]) {
          await client.query(`drop owned by ${client.escapeIdentifier(login)}`);
          await client.query(`drop role if exists ${client.escapeIdentifier(login)}`);
        }
      } finally {
        await client.end();
      }
    },
  };
}
