# Backup and restore drill

|         |                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| Item    | Security checklist item 20 (product spec §6)                                                                          |
| Scope   | Proving that a `pg_dump -Fc` of a PostGIS database restores into a fresh server, with data and extension intact       |
| Script  | [`ops/restore-drill.sh`](../../ops/restore-drill.sh)                                                                  |
| Context | [ADR-0002](../adr/0002-hosting.md): self-hosted PostgreSQL 16, daily dump, 30-day R2 lifecycle, RPO 24 hours, no PITR |

## 1. What the drill proves, and what it does not

The script in this repository proves the **restore mechanics**: a custom-format dump taken from one
PostGIS 16 server restores into a second, brand-new server, row counts match table by table, the
`postgis` extension is present and a spatial query returns the expected rows.

It does **not** cover the production path (`age` encryption, R2 upload and download, lifecycle
rules, the real dataset). Those parts are owner tasks and are listed in section 5. Do not report the
production backup as verified until section 5 has been completed and recorded.

## 2. Run the drill locally

Requirements: Docker running, `bash` (Git Bash on Windows). No compose project, no volumes, no host
ports are used.

```sh
bash ops/restore-drill.sh
```

What it does:

1. Starts scratch container `kadro-drill-src-<id>` from `postgis/postgis:16-3.5-alpine` (the image
   used by `docker-compose.yml`), enables PostGIS and seeds two tables (250 users, 120 venues with a
   `geometry(Point, 4326)` column and a GiST index). `DRILL_SEED_SQL=<file>` applies extra SQL.
2. Takes `pg_dump -Fc` and streams it to a temporary file on the host.
3. Starts a second, fresh container `kadro-drill-dst-<id>`, creates a new database from `template0`
   and runs `pg_restore --no-owner --exit-on-error` into it.
4. Compares exact `count(*)` per table in schema `public` (source versus restored), checks
   `pg_extension` for `postgis` and runs an `ST_DWithin` query against the restored data.
5. Removes both containers with `docker rm -f <exact name>` on exit, including on failure or
   interrupt. It never uses volume removal, prune or `compose down -v`.

Exit code 0 and the line `RESULT: restore drill passed` mean success; any mismatch prints `FAIL:`
and exits 1.

### Recorded run

Run on the owner workstation (Docker 29.7.2, image `postgis/postgis:16-3.5-alpine`):

```text
source row counts:
public.drill_users 250
public.drill_venues 120
dump size: 14734 bytes
restored row counts:
public.drill_users 250
public.drill_venues 120
row counts: identical
postgis extension in restored database: 3.5.7
spatial query (venues within 20 km of the origin): 120
RESULT: restore drill passed
cleanup: removed containers kadro-drill-src-… and kadro-drill-dst-…
```

The run used the built-in seed, not the Kadro schema or migrations.

## 3. Restoring the real database (production procedure)

Draft procedure for the production host. **Not executed**: it needs the real server, bucket and key.

1. Pick the dump (`kadro-YYYYMMDD.dump.age`) from the `kadro-backups` bucket.
2. Download, then decrypt with the `age` identity held in the owner's password manager:
   `age -d -i <identity-file> -o kadro.dump kadro-YYYYMMDD.dump.age`.
3. Provision an empty PostGIS 16 server (same image as production).
4. `createdb -T template0 kadro`, then `pg_restore --no-owner --exit-on-error -d kadro kadro.dump`.
5. Recreate application roles and grants: run the compose `db-roles` step (migration
   `0010_roles_and_grants.sql` describes the grants). Roles are cluster-level and are not part of a
   single-database dump.
6. Smoke checks: `SELECT extversion FROM pg_extension WHERE extname='postgis'`; row counts of
   `users`, `teams`, `matches`, `venues`; start web and worker against it and call
   `GET /api/v1/health`.
7. Point `DATABASE_URL` at the restored server only after the checks pass.

Recovery point objective is 24 hours (daily dump, no PITR); recovery time objective is not measured
until the first timed production restore (section 5).

## 4. Cadence

- Weekly: restore drill in CI against the latest production dump (spec item 20, workflow
  `restore-drill.yml`). The workflow is not part of this change; it is an owner/Phase 6 follow-up.
- After every Postgres major or PostGIS minor upgrade, and before launch: run section 2 and the
  section 5 drill.
- The worker queue `backup.verify` records the result of the latest check; alert if no success was
  recorded for 48 hours.

## 5. Owner tasks (need real accounts or servers)

| #   | Task                                                                                                           | Status     |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Create R2 bucket `kadro-backups`, 30-day lifecycle rule, scoped write-only key for the host                    | owner task |
| 2   | Generate the `age` key pair; keep the identity offline in two places; put only the recipient on the server     | owner task |
| 3   | Install the daily dump, encrypt and upload job on the VPS and confirm the first object appears                 | owner task |
| 4   | Download one real dump, decrypt and restore it on a scratch host (section 3); record time taken and row counts | owner task |
| 5   | Add the weekly `restore-drill.yml` workflow with a read-only R2 key as a CI secret                             | owner task |
