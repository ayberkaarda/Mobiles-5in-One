import { PgBoss } from 'pg-boss';

import { type Logger } from '../logging';
import { safeLog } from '../safe-log';

/**
 * Send-only pg-boss client of the web process (ADR-0028). The worker owns the `pgboss` schema,
 * runs its migrations and creates the queues; the web side only inserts jobs. Every session of
 * this client runs as `kadro_app`, whose grants (migrations 0010, 0011) allow exactly that:
 * `SELECT` on `pgboss.version` and `pgboss.queue`, `INSERT` plus `SELECT (id, start_after)` on the
 * job table. It cannot fetch, complete, delete or read jobs.
 */

/** pg-boss schema created by migration 0010 and owned by `kadro_worker`. */
export const PG_BOSS_SCHEMA = 'pgboss';
/** Group role of the web/API process (migration 0010). */
export const WEB_DB_ROLE = 'kadro_app';

/** libpq startup option that makes every session of the client run as `role`. */
export function sessionRoleOption(role: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new RangeError('invalid database role name');
  }
  return `-c role=${role}`;
}

export interface SendOnlyClientOptions {
  readonly connectionString: string;
  readonly logger: Logger;
  /** Defaults to `kadro_app`. */
  readonly role?: string;
}

export interface SendOnlyClient {
  /** The started client; started once on first use, retried after a failed start. */
  boss(): Promise<PgBoss>;
  /** Stops the client if it was started (tests, graceful shutdown of a custom host). */
  close(): Promise<void>;
}

export function createSendOnlyClient(options: SendOnlyClientOptions): SendOnlyClient {
  let started: Promise<PgBoss> | undefined;

  const start = async (): Promise<PgBoss> => {
    const boss = new PgBoss({
      connectionString: options.connectionString,
      options: sessionRoleOption(options.role ?? WEB_DB_ROLE),
      schema: PG_BOSS_SCHEMA,
      application_name: 'kadro-web-jobs',
      // Send only: no maintenance, no cron loop, no schema changes (the worker owns them).
      supervise: false,
      schedule: false,
      migrate: false,
      createSchema: false,
      max: 2,
    });
    boss.on('error', (error) => {
      safeLog(() => options.logger.error({ err: error }, 'job queue client error'));
    });
    await boss.start();
    return boss;
  };

  return {
    boss() {
      if (started === undefined) {
        const attempt = start();
        attempt.catch(() => {
          if (started === attempt) {
            started = undefined;
          }
        });
        started = attempt;
      }
      return started;
    },
    async close() {
      const current = started;
      started = undefined;
      if (current !== undefined) {
        const boss = await current.catch(() => null);
        await boss?.stop({ graceful: false });
      }
    },
  };
}
