import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate.js';
import { createEmptyDatabase } from './support.js';

/** Journal entries; reading them also fails if a referenced .sql file is missing. */
const MIGRATION_COUNT = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length;

/** Append-only tables that intentionally have no `updated_at` (ADR-0028). */
const IMMUTABLE_TABLES = new Set(['job_receipts']);

/**
 * Every table of product spec §5 (except `jobs`, which pg-boss manages in its own schema) plus
 * the Phase 2 tables `job_receipts` (ADR-0028) and `uploads` (ADR-0030).
 */
const SPEC_TABLES = [
  'users',
  'refresh_tokens',
  'email_tokens',
  'districts',
  'teams',
  'team_members',
  'team_invites',
  'venues',
  'venue_reviews',
  'matches',
  'match_rsvps',
  'open_calls',
  'open_call_applications',
  'mvp_votes',
  'push_tokens',
  'subscriptions',
  'webhook_events',
  'rate_limit_buckets',
  'audit_logs',
  'deletion_requests',
  'job_receipts',
  'uploads',
].sort();

describe('migrations', () => {
  let url: string;
  let drop: () => Promise<void>;
  let client: pg.Client;

  beforeAll(async () => {
    ({ url, drop } = await createEmptyDatabase('kadro_migrations'));
    await runMigrations(url);
    client = new pg.Client({ connectionString: url });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
    await drop();
  });

  it('installs PostGIS and pg_trgm on an empty database', async () => {
    const { rows } = await client.query<{ extname: string }>(
      "select extname from pg_extension where extname in ('postgis', 'pg_trgm') order by extname",
    );
    expect(rows).toEqual([{ extname: 'pg_trgm' }, { extname: 'postgis' }]);
  });

  it('creates every table from the data model', async () => {
    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'spatial_ref_sys' order by table_name",
    );
    expect(rows.map((row) => row.table_name)).toEqual(SPEC_TABLES);
  });

  it('gives every table a uuid primary key and the timestamp columns', async () => {
    const { rows } = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      "select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and column_name in ('id', 'created_at', 'updated_at') and table_name <> 'spatial_ref_sys'",
    );
    for (const table of SPEC_TABLES) {
      const columns = rows.filter((row) => row.table_name === table);
      expect(
        columns.map((column) => [column.column_name, column.data_type, column.is_nullable]).sort(),
      ).toEqual([
        ['created_at', 'timestamp with time zone', 'NO'],
        ['id', 'uuid', 'NO'],
        ...(IMMUTABLE_TABLES.has(table) ? [] : [['updated_at', 'timestamp with time zone', 'NO']]),
      ]);
    }
  });

  it('stores geography points with SRID 4326', async () => {
    const { rows } = await client.query<{
      f_table_name: string;
      f_geography_column: string;
      srid: number;
      type: string;
    }>(
      'select f_table_name, f_geography_column, srid, type from geography_columns order by f_table_name',
    );
    expect(rows).toEqual([
      { f_table_name: 'districts', f_geography_column: 'centroid', srid: 4326, type: 'Point' },
      { f_table_name: 'venues', f_geography_column: 'point', srid: 4326, type: 'Point' },
    ]);
  });

  it('keeps secrets only as SHA-256 hashes (no plaintext token or code columns)', async () => {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('refresh_tokens', 'email_tokens', 'team_invites') and (column_name like '%token%' or column_name like '%code%') order by table_name, column_name",
    );
    expect(rows).toEqual([
      { table_name: 'email_tokens', column_name: 'token_hash' },
      { table_name: 'refresh_tokens', column_name: 'token_hash' },
      { table_name: 'team_invites', column_name: 'code_hash' },
    ]);
  });

  it('records every committed migration file and is a no-op when re-run', async () => {
    expect(MIGRATION_COUNT).toBe(12);
    const countApplied = async (): Promise<number> => {
      const { rows } = await client.query<{ count: string }>(
        'select count(*)::text as count from drizzle.__drizzle_migrations',
      );
      return Number(rows[0]?.count);
    };
    expect(await countApplied()).toBe(MIGRATION_COUNT);
    await runMigrations(url);
    expect(await countApplied()).toBe(MIGRATION_COUNT);
  });

  it('serializes concurrent migrators', async () => {
    const second = await createEmptyDatabase('kadro_migrations_concurrent');
    try {
      await Promise.all([runMigrations(second.url), runMigrations(second.url)]);
      const verify = new pg.Client({ connectionString: second.url });
      await verify.connect();
      try {
        const { rows } = await verify.query<{ count: string }>(
          'select count(*)::text as count from drizzle.__drizzle_migrations',
        );
        expect(Number(rows[0]?.count)).toBe(MIGRATION_COUNT);
      } finally {
        await verify.end();
      }
    } finally {
      await second.drop();
    }
  });
});
