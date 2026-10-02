import { fileURLToPath } from 'node:url';

import { loadDatabaseEnv } from '@kadro/config';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/**
 * Migration runner, exposed as the `@kadro/db/migrate` subpath. It resolves the SQL files on disk
 * relative to this module, so it is meant for CLIs, workers and tests, never for bundled route
 * handlers; the root `@kadro/db` entry does not import it.
 */

/** Absolute path of the committed SQL migrations shipped with this package. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Arbitrary constant key for the session-level advisory lock that serializes migrators. */
const MIGRATION_LOCK_KEY = 4_729_118_305;

/**
 * Applies pending migrations from {@link MIGRATIONS_FOLDER} on a dedicated connection. A
 * PostgreSQL advisory lock makes concurrent invocations (several containers booting) wait
 * instead of racing. The role needs privileges to create the PostGIS extension on first run.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString, application_name: 'kadro-migrate' });
  await client.connect();
  try {
    const db = drizzle({ client });
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    try {
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Applies migrations to the database named by the database-only configuration
 * (`loadDatabaseEnv`: `NODE_ENV`, `APP_ENV`, `DATABASE_URL`). Used by the `db:migrate` CLI; needs no
 * worker, web, email or push settings.
 */
export async function migrateFromEnv(): Promise<void> {
  await runMigrations(loadDatabaseEnv().DATABASE_URL);
}
