import { loadDatabaseEnv } from '@kadro/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type DbSchema = typeof schema;

/** Typed Drizzle database bound to the Kadro schema (relational queries enabled). */
export type Database = NodePgDatabase<DbSchema>;

/** Transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbClientOptions {
  /** postgres:// connection URL. Obtain it from `@kadro/config`, never from `process.env`. */
  readonly connectionString: string;
  /** Pool size. Defaults to 10. */
  readonly maxConnections?: number;
  /** Reported in `pg_stat_activity.application_name`. */
  readonly applicationName?: string;
  /** Server-side statement timeout in milliseconds. Defaults to 15 000. */
  readonly statementTimeoutMs?: number;
  /**
   * Called when any pooled connection fails outside a query's own promise: while idle, or while
   * checked out (a transaction, a running statement) when the socket drops. The failing query
   * itself still rejects. Without a listener Node would terminate the process on the client's
   * `error` event, so one is always installed; this callback only adds logging.
   */
  readonly onClientError?: (error: Error) => void;
  /** @deprecated Alias of `onClientError`, kept for existing callers. */
  readonly onIdleClientError?: (error: Error) => void;
}

export interface DbClient {
  readonly db: Database;
  readonly pool: pg.Pool;
  /** Drains the pool. Call once during graceful shutdown. */
  close(): Promise<void>;
}

const DEFAULT_MAX_CONNECTIONS = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;

export function createDbClient(options: DbClientOptions): DbClient {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    application_name: options.applicationName ?? 'kadro',
    statement_timeout: options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  });
  const reportClientError = (error: Error): void => {
    // A logging failure must never turn into an uncaught exception.
    try {
      (options.onClientError ?? options.onIdleClientError)?.(error);
    } catch {
      // ignored
    }
  };
  // Idle clients: pg-pool forwards their errors here and discards the connection.
  pool.on('error', reportClientError);
  // Checked-out clients (transactions, running statements): pg-pool removes its own listener
  // while a client is borrowed, so without this a dropped socket is an unhandled 'error' event.
  // pg rejects the in-flight query and releases the broken client, which drops it from the pool.
  pool.on('connect', (client) => {
    client.on('error', reportClientError);
  });
  const db = drizzle({ client: pool, schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

/**
 * Creates a client from the database-only configuration (`loadDatabaseEnv`: `NODE_ENV`, `APP_ENV`,
 * `DATABASE_URL`). Configuration is read exclusively through `@kadro/config`; no app secrets or
 * transport keys are required.
 */
export function createDbClientFromEnv(
  options: Omit<DbClientOptions, 'connectionString'> = {},
): DbClient {
  const env = loadDatabaseEnv();
  return createDbClient({ ...options, connectionString: env.DATABASE_URL });
}
