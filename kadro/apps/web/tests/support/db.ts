import { randomBytes } from 'node:crypto';

import { createDbClient, type DbClient } from '@kadro/db';
import { runMigrations } from '@kadro/db/migrate';
import pg from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  readonly url: string;
  readonly client: DbClient;
  /** Closes the pool and drops the database. */
  dispose(): Promise<void>;
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function admin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject('adminDatabaseUrl') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Fresh database with every migration applied, isolated per test file. */
export async function createMigratedDatabase(prefix: string): Promise<TestDatabase> {
  const name = `${prefix}_${randomBytes(4).toString('hex')}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`invalid test database name ${name}`);
  }
  await admin((client) =>
    client.query(`create database ${client.escapeIdentifier(name)} template template0`),
  );
  const url = withDatabase(inject('adminDatabaseUrl'), name);
  await runMigrations(url);
  const client = createDbClient({ connectionString: url, maxConnections: 4 });
  return {
    url,
    client,
    dispose: async () => {
      await client.close();
      await admin(async (adminClient) => {
        await adminClient.query(
          `drop database if exists ${adminClient.escapeIdentifier(name)} with (force)`,
        );
      });
    },
  };
}
