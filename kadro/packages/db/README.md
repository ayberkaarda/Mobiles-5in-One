# @kadro/db

Drizzle ORM schema, committed SQL migrations and seed data for PostgreSQL 16 + PostGIS.

## Layout

| Path             | Content                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `src/schema/`    | One file per domain area; `enums.ts`, `geography.ts` (PostGIS point type)                 |
| `src/client.ts`  | `createDbClient`, `createDbClientFromEnv` (root export `@kadro/db`)                       |
| `src/migrate.ts` | `runMigrations`, `migrateFromEnv`, `MIGRATIONS_FOLDER` (subpath `@kadro/db/migrate` only) |
| `src/seed/`      | District list, `[ÖRNEK]` sample venues, idempotent `seedDatabase`                         |
| `migrations/`    | SQL files applied in journal order (`meta/_journal.json`)                                 |
| `test/`          | Vitest suites against a disposable `postgis/postgis:16-3.5-alpine` container              |

## Conventions

- Table and column names are snake_case; every table has a UUIDv7 `id` (generated in the
  application) and `created_at` / `updated_at` (`timestamptz`).
- Secrets are stored only as lowercase hex SHA-256 digests: `refresh_tokens.token_hash`,
  `email_tokens.token_hash`, `team_invites.code_hash`. A check constraint rejects anything else.
- `geography(Point, 4326)` columns map to `{ lng, lat }`. Coordinates are validated and always
  sent as bound parameters (`geographyPointSql`).
- Raw SQL is never assembled from strings; use the `sql` template with bound parameters.

## Commands

```sh
pnpm --filter @kadro/db db:generate   # schema change -> new SQL file in migrations/
pnpm --filter @kadro/db db:check      # journal / snapshot consistency
pnpm --filter @kadro/db build
pnpm --filter @kadro/db db:migrate    # applies migrations to DATABASE_URL (read via @kadro/config)
pnpm --filter @kadro/db db:seed       # districts + sample venues, safe to repeat
pnpm --filter @kadro/db test          # needs a running Docker daemon
```

`db:migrate` and `db:seed` read only `NODE_ENV`, `APP_ENV` and `DATABASE_URL` from the
repository `.env` (`loadDatabaseEnv` in `@kadro/config`); worker, web, email and push settings are
not required. The
migration role must be allowed to run `CREATE EXTENSION postgis` on the first run. The image in
`docker-compose.yml` (`postgres:16.15-alpine`) does not ship PostGIS; local development needs a
PostGIS-enabled PostgreSQL 16 image such as `postgis/postgis:16-3.5-alpine`.

Generated migrations are reviewed before commit. drizzle-kit quotes custom column types, so
`geography(Point, 4326)` is unquoted by hand in `0001_initial_schema.sql`; the snapshot is
unaffected. `0000_postgis.sql` and `0002_match_terms_frozen.sql` are hand-written custom
migrations (extension; ADR-0004 trigger that freezes fee, slots and format after the first lock).

Phase 2 migrations (handoff `decisions-to-db-001`), one per logical change:

| File                                 | Change                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `0003_job_receipts.sql`              | Worker idempotency receipts, unique `(queue, idempotency_key)` (ADR-0028) |
| `0004_uploads.sql`                   | Upload records, kind/team, status/reason and key-format checks (ADR-0030) |
| `0005_deletion_external_pending.sql` | `deletion_requests.external_pending` (closed set `revenuecat`, ADR-0032)  |
| `0006_user_tombstone.sql`            | `users.is_tombstone` with a no-personal-data check (ADR-0033)             |
| `0007_rsvp_waitlisted_at.sql`        | Waitlist position, backfilled for existing waitlist rows (ADR-0035)       |
| `0008_venue_search_name.sql`         | `pg_trgm`, `venues.search_name` backfilled, trigram GIN index (ADR-0039)  |
| `0009_list_keyset_indexes.sql`       | Indexes for keyset-paginated team and application lists (ADR-0039)        |
| `0010_roles_and_grants.sql`          | `kadro_app` / `kadro_worker` group roles, table grants, `pgboss` schema   |
| `0011_pgboss_send_access.sql`        | Send-only grant also covers `pgboss.version` (handoff worker-to-db-001)   |

### Roles

`kadro_app` (web) and `kadro_worker` are `NOLOGIN` group roles; operators grant them to the login
users of each environment. Both may read and write the domain tables; `audit_logs` is
`SELECT, INSERT` only; `job_receipts` is worker-only (`SELECT, INSERT, DELETE`). The `pgboss`
schema is owned by `kadro_worker`. After pg-boss has created its tables and queues, the worker
calls `select public.kadro_grant_pgboss_send_access()` (redefined in `0011`), which gives
`kadro_app` `SELECT` on `pgboss.version` (read by `start()`) and `pgboss.queue`, and `INSERT` (plus the returned `id`, `start_after` columns) on `pgboss.job` and
every job partition; call it again whenever a queue is added. A new table must be granted in its
own migration; a test fails when a public table lacks the expected grants. A real pg-boss test
proves `kadro_app` can `start()` and `send()` but cannot fetch, complete, delete or create queues. The migration role
needs `CREATEROLE` on the first run.

### Search names

`venues.search_name` holds `foldTr(name)` from `@kadro/contracts`. The application and the seed
write it on every insert and name change; migration 0008 backfilled existing rows with an SQL
expression that matches `foldTr` for Turkish and common Latin letters.

## Seed data

- **Districts:** all ilçe of İstanbul (39), Ankara (25) and İzmir (30) with `il`, `ilce`, `il_slug`
  and `slug` (Turkish letters folded to ASCII).
- **Centroids are approximate.** Each `centroid` is a hand-picked reference point near the
  district's administrative center, rounded to about 0.01° (~1 km). It is not a geometric centroid
  and not derived from official boundary data; use it only for map defaults and coarse "near me"
  ordering.
- **Sample venues:** six fictional pitches with `is_sample = true`, names prefixed `[ÖRNEK]`, no
  phone number, `verified = false`, and points offset from the district reference point. They do
  not describe real businesses. Real venues enter production only through the admin CSV import.
- Re-running the seed matches rows on natural keys and keeps their ids; a non-sample venue is never
  overwritten even if it uses a sample slug.
