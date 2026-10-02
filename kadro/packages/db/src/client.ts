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
   * Called when an idle pooled connection fails (for example a server restart). Without a
   * handler the error is raised on the pool and terminates the process.
   */
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
  if (options.onIdleClientError) {
    pool.on('error', options.onIdleClientError);
  }
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
