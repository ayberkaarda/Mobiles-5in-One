import { createHash, randomBytes } from 'node:crypto';

import pg from 'pg';
import { expect, inject } from 'vitest';

import { type DbClient, createDbClient } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';

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

/**
 * Creates an empty database from `template0` (no extensions preinstalled) so every test file is
 * isolated and migrations are proven to bootstrap PostGIS themselves.
 */
export async function createEmptyDatabase(prefix: string): Promise<{
  url: string;
  drop: () => Promise<void>;
}> {
  const name = `${prefix}_${randomBytes(4).toString('hex')}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`invalid test database name ${name}`);
  }
  await admin((client) =>
    client.query(`create database ${client.escapeIdentifier(name)} template template0`),
  );
  return {
    url: withDatabase(inject('adminDatabaseUrl'), name),
    drop: () =>
      admin(async (client) => {
        await client.query(`drop database if exists ${client.escapeIdentifier(name)} with (force)`);
      }),
  };
}

/** Empty database with all migrations applied and a pooled Drizzle client. */
export async function createMigratedDatabase(prefix: string): Promise<TestDatabase> {
  const { url, drop } = await createEmptyDatabase(prefix);
  await runMigrations(url);
  const client = createDbClient({ connectionString: url, maxConnections: 4 });
  return {
    url,
    client,
    dispose: async () => {
      await client.close();
      await drop();
    },
  };
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function uniqueSuffix(): string {
  return randomBytes(5).toString('hex');
}

interface PgErrorLike {
  readonly code: string;
  readonly constraint?: string;
}

function findPgError(error: unknown): PgErrorLike | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    // Duck-typed so errors raised through another copy of `pg` (for example inside pg-boss)
    // are recognized as well.
    const candidate = current as { code?: unknown; severity?: unknown; constraint?: unknown };
    if (
      typeof candidate.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(candidate.code) &&
      typeof candidate.severity === 'string'
    ) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      };
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';
export const PG_INSUFFICIENT_PRIVILEGE = '42501';

/** Asserts that the promise rejects with the given PostgreSQL SQLSTATE (and constraint name). */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason ?? new Error('rejected without reason'),
  );
  expect(error, 'expected the statement to fail').toBeDefined();
  const pgError = findPgError(error);
  expect(pgError?.code).toBe(code);
  if (constraint !== undefined) {
    expect(pgError?.constraint).toBe(constraint);
  }
}
