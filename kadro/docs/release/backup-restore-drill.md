# Backup and restore drill

|         |                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| Item    | Security checklist item 20 (product spec §6)                                                                          |
| Scope   | Proving that a `pg_dump -Fc` of a PostGIS database restores into a fresh server, with data and extension intact       |
| Scripts | [`ops/restore-drill.sh`](../../ops/restore-drill.sh), [`scripts/ops/backup.sh`](../../scripts/ops/backup.sh)          |
| Context | [ADR-0002](../adr/0002-hosting.md): self-hosted PostgreSQL 16, daily dump, 30-day R2 lifecycle, RPO 24 hours, no PITR |

## 1. What the drill proves, and what it does not

The script in this repository proves the **restore mechanics**: a custom-format dump taken from one
PostGIS 16 server restores into a second, brand-new server, row counts match table by table, the
`postgis` extension is present and a spatial query returns the expected rows.

The backup script (section 6) proves the **backup mechanics** against scratch services: dump,
`age` encryption, the key pattern `backup.verify` expects and an upload through the S3 API.

Neither covers the production path end to end (the real R2 bucket and its lifecycle rule, the real
dataset, a download and decrypt of a real dump). Those parts are owner tasks and are listed in
section 5. Do not report the production backup as verified until section 5 has been completed and
recorded.

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

- Weekly: restore drill in CI, workflow `.github/workflows/kadro-restore-drill.yml` (spec item 20's
  `restore-drill.yml`), Mondays 05:40 UTC and on manual dispatch. It runs `ops/restore-drill.sh`
  with the built-in seed and uploads the output as the artifact `restore-drill-output` (30 days).
  It has not run yet: scheduled runs start once the file is on the default branch. Restoring the
  latest production dump in that job needs a read-only R2 key and the `age` identity as CI secrets
  (section 5, task 5).
- After every Postgres major or PostGIS minor upgrade, and before launch: run section 2 and the
  section 5 drill.
- The worker queue `backup.verify` (ADR-0082) checks the newest artifact in the backup bucket: it
  exists, is large enough, has an `age` header and is young enough. It does not decrypt or restore.
  The real default schedule is weekly, Mondays 06:20 UTC (`BACKUP_VERIFY_CRON` = `20 6 * * 1`), so
  the alert rule is "no `backup_verified` line for 8 days" (`docs/ops/worker.md`), not 48 hours.
  `BACKUP_VERIFY_CRON` is a constant in `packages/contracts/src/jobs.ts`, not an environment
  variable: to verify daily, change it there (for example `20 6 * * *`) and redeploy the worker;
  only then does a 48-hour alert make sense.

## 5. Owner tasks (need real accounts or servers)

| #   | Task                                                                                                           | Status     |
| --- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Create R2 bucket `kadro-backups`, 30-day lifecycle rule, scoped write-only key for the host                    | owner task |
| 2   | Generate the `age` key pair; keep the identity offline in two places; put only the recipient on the server     | owner task |
| 3   | Install `scripts/ops/backup.sh` as a daily job on the VPS (section 6) and confirm the first object appears     | owner task |
| 4   | Download one real dump, decrypt and restore it on a scratch host (section 3); record time taken and row counts | owner task |
| 5   | Extend `kadro-restore-drill.yml` to restore the latest real dump (read-only R2 key and identity as CI secrets) | owner task |

## 6. Production backup job (`scripts/ops/backup.sh`)

The script runs on the database host once a day. It streams `pg_dump --format=custom` of
`DATABASE_URL` straight into `age --encrypt` (the plaintext dump never touches the disk), checks
that the result starts with the `age` header and uploads it to
`s3://kadro-backups/kadro-YYYYMMDD.dump.age` (UTC date) through the R2 S3 API with `aws s3 cp`. The
key pattern is the one `backup.verify` (ADR-0082) looks for. `bash scripts/ops/backup.sh --help`
prints the full interface.

| Variable                          | Required       | Meaning                                                                        |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                    | yes            | Database to dump; keep the password in `~/.pgpass` (mode 0600), not in the URI |
| `BACKUP_AGE_RECIPIENT`            | yes            | `age` public key (`age1...`); the identity stays offline                       |
| `R2_ENDPOINT`                     | unless dry run | `https://<account>.r2.cloudflarestorage.com` (http only for localhost)         |
| `BACKUP_UPLOAD_ACCESS_KEY_ID`     | unless dry run | Write-only R2 key for the backup bucket                                        |
| `BACKUP_UPLOAD_SECRET_ACCESS_KEY` | unless dry run | Its secret                                                                     |
| `BACKUP_BUCKET`                   | no             | Default `kadro-backups`                                                        |
| `BACKUP_PREFIX`                   | no             | Default `kadro-`; must equal the worker's `BACKUP_PREFIX`                      |
| `BACKUP_DATE`                     | no             | `YYYYMMDD`, default today (UTC)                                                |

Behaviour: it refuses to start (exit 2) when a required variable is missing, listing only the
names, or when a value is malformed; it never prints the connection string or credentials and never
enables shell tracing; the upload credentials reach `aws` only through its environment. `--dry-run`
dumps and encrypts but skips the upload and does not need the upload variables; `--out FILE` keeps
the encrypted file (useful with `--dry-run`). A failed `pg_dump` fails the run (`pipefail`) and
removes a partial `--out` file.

### Bucket setup (owner, once)

1. Create the R2 bucket `kadro-backups` (no public access, no custom domain). It must differ from
   the upload buckets (`packages/config` enforces this for the worker).
2. Apply the 30-day lifecycle rule in [`ops/backup-lifecycle.json`](../../ops/backup-lifecycle.json)
   (expire `kadro-*` objects after 30 days, abort incomplete multipart uploads after 1 day), in the
   dashboard (bucket settings, object lifecycle rules) or through the S3 API:
   `aws s3api put-bucket-lifecycle-configuration --endpoint-url "$R2_ENDPOINT" --bucket kadro-backups --lifecycle-configuration file://ops/backup-lifecycle.json`.
3. Create two API tokens scoped to this bucket only: object read and write for the database host
   (`BACKUP_UPLOAD_*`) and object read only for the worker (`BACKUP_ACCESS_KEY_ID`,
   `BACKUP_SECRET_ACCESS_KEY`, ADR-0082).
4. Run `age-keygen -o kadro-backup.key` on an offline machine and store the identity in two places;
   put only the recipient (`age-keygen -y kadro-backup.key`) on the host.
5. Install the PostgreSQL 16 client (same major version as the server), `age` and the AWS CLI on
   the host, put the variables in a root-only environment file and schedule the script daily (for
   example a systemd timer at 03:30 UTC). Run it once by hand and list the bucket.

### Recorded runs

Argument, environment and upload-call checks with stub `pg_dump`, `age` and `aws` (no database, no
bucket), `bash scripts/ops/backup.test.sh`:

```text
ok   - refuses without environment and names every missing variable
ok   - dry run does not require upload variables
ok   - rejects an unknown argument
ok   - rejects a non-postgres DATABASE_URL
ok   - rejects a malformed age recipient
ok   - rejects a malformed BACKUP_DATE
ok   - rejects a BACKUP_PREFIX with spaces
ok   - rejects a plain-http endpoint that is not localhost
ok   - refuses when pg_dump is not installed
ok   - --help prints the usage
ok   - dry run dumps and encrypts, keeps --out, never calls aws
ok   - refuses to overwrite an existing --out file
ok   - a pg_dump failure fails the run and removes the partial file
ok   - upload goes to the dated key with credentials only in the environment
ok   - no run printed the database password, host or upload credentials
15 passed, 0 failed
```

Real tools against scratch containers on the owner workstation: a PostGIS 16 container seeded with
300 users and 80 venues, a runner on Alpine 3.22 (`pg_dump` 16.15, `age` 1.2.1, `aws-cli` 2.27.25)
with a throwaway `age` key pair, and a local S3 server (moto) standing in for R2:

```text
== dry run
backup: key kadro-20261003.dump.age (bucket kadro-backups)
backup: dumping and encrypting
backup: encrypted dump 11179 bytes, age header present
backup: dry run, skipped upload to s3://kadro-backups/kadro-20261003.dump.age
backup: kept encrypted dump at /root/out.dump.age
RESULT: backup dry run passed
== decrypt and inspect the kept file
PGDMP
2; 3079 18046 EXTENSION - postgis
4886; 0 19707 TABLE DATA public users kadro
4888; 0 19716 TABLE DATA public venues kadro
== upload to the local S3 server
backup: key kadro-20261003.dump.age (bucket kadro-backups)
backup: dumping and encrypting
backup: encrypted dump 11179 bytes, age header present
backup: uploading to s3://kadro-backups/kadro-20261003.dump.age
RESULT: backup uploaded (11179 bytes)
2026-10-03 20:18:21      11179 kadro-20261003.dump.age
no password in script output
```

The `pg_restore --list` excerpt is shortened to the PostGIS extension and the two seeded tables.
The lifecycle rule was parsed as JSON but has not been applied to a real bucket, and no upload has
been made to R2 itself.
