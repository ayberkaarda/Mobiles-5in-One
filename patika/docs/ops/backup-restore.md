# Backup and restore

Security checklist item 20 (Otomatik yedek). Patika is a portfolio project: the scripts and the drill are real and run locally and in CI against throwaway containers; no production database, bucket or key exists (README, "Gerçek / simüle").

## What is backed up

| Data | Mechanism | Retention | Restore path |
| --- | --- | --- | --- |
| PostgreSQL + PostGIS (all tables, migrations history) | `ops/backup/backup.sh` daily: `pg_dump -Fc` piped into `age` to a recipient public key, then uploaded to a separate bucket | 30 days (bucket lifecycle rule; local copies pruned by the script) | `ops/backup/restore.sh` into a fresh PostGIS |
| Point in time | Managed PostgreSQL PITR (ADR-0002); `pgBackRest` if self-hosted | Provider window (7 days or more) | Provider console or `pgbackrest restore` |
| Photos (`media/`, R2 or MinIO) | Object versioning on the photo bucket (below) | Noncurrent versions expire after 30 days | Restore the previous version of the object |
| Data Protection key ring (`DataProtection:KeysPath`) | Copied with the volume snapshot of the API host, kept apart from the database dumps | Same as the host snapshots | Mount the copied ring; without it the TOTP secrets and purchase tokens in a restored database cannot be decrypted |

On the backup side the dump never exists in plaintext on disk: `pg_dump` writes into `age` through a pipe. `restore.sh` decrypts into a `mktemp -d` directory created under `umask 077` and removed on exit. Neither script puts the database password on a command line (`pg_dump --dbname=postgresql://user:password@...` would show it in `ps` and `/proc/*/cmdline`): both write it to a private temporary `PGPASSFILE` and unset `PGPASSWORD` and the URL before any PostgreSQL tool starts. `test-pgpass.sh` checks the URL parsing; the drill checks the result on the real tools.

## Scripts

All live under [`ops/backup/`](../../ops/backup/). They need `pg_dump`, `pg_restore` and `psql` 17, `age`, and the `aws` CLI for uploads. The drill builds a tools image with exactly these (`postgres:17-bookworm` plus the Debian `age` and `awscli` packages).

### backup.sh

| Variable | Required | Meaning |
| --- | --- | --- |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (or `PGSERVICE`), or `PATIKA_BACKUP_DATABASE_URL` | yes | Source database (a read-only role is enough). The URL is split into the libpq variables (only the `sslmode` parameter is supported) and unset, and its password, or `PGPASSWORD`, goes into a temporary `PGPASSFILE` (umask 077, removed by the exit trap; [`pgpass.sh`](../../ops/backup/pgpass.sh)), so no command line or child environment carries the password |
| `PATIKA_BACKUP_AGE_RECIPIENT` | yes | age public key (`age1...`); the private identity is kept offline |
| `PATIKA_BACKUP_DIR` | no, `./backups` | Local directory for the encrypted file and its `.sha256` |
| `PATIKA_BACKUP_S3_URI` | no | For example `s3://patika-backups/db`; when set, the file and checksum are copied with `aws s3 cp` |
| `PATIKA_BACKUP_S3_ENDPOINT` | no | `--endpoint-url`, for example `https://<account>.r2.cloudflarestorage.com` or `http://minio:9000` |
| `PATIKA_BACKUP_RETENTION_DAYS` | no, `30` | Local prune age in days |

The output file is `patika-YYYYMMDDTHHMMSSZ.dump.age` plus `patika-...dump.age.sha256`. The upload credential should be write-only (an R2 token with Object Write on the backup bucket only), so a compromised host cannot read or delete old backups. Remote deletion is left to the bucket's 30-day lifecycle rule.

Schedule: once a day from the host's scheduler or a cron job that can reach the database (for example `0 3 * * *` UTC). The Worker does not run it because the Worker image has no PostgreSQL client tools.

### restore.sh

```bash
PGHOST=restore-host PGUSER=postgres PGPASSWORD=... \
# or PATIKA_RESTORE_SERVER_URL=postgresql://postgres:...@restore-host (moved into a temporary PGPASSFILE like the above)
PATIKA_BACKUP_AGE_IDENTITY=/secure/patika-backup.agekey \
PATIKA_RESTORE_DB=patika_restore \
bash ops/backup/restore.sh patika-20261026T030151Z.dump.age
```

Steps, and the message each failure prints:

1. `.sha256` sidecar check when present: `FAIL checksum mismatch`.
2. `age --decrypt` with the identity: `FAIL age could not decrypt` (wrong key or a tampered file; age authenticates every chunk).
3. `pg_restore --list` on the result: `FAIL decrypted file is not a pg_dump custom-format archive`.
4. An existing target database is refused: `FAIL target database exists`.
5. `createdb --template=template0`, then `pg_restore --no-owner --no-privileges --exit-on-error`. The dump carries `CREATE EXTENSION postgis`, so the target server only needs PostGIS installed.
6. Smoke queries from [`smoke.sql`](../../ops/backup/smoke.sql): station count, stations within 2 km of a Moda point (`ST_DWithin` on `geography`), the nearest station by the `<->` operator, an md5 over every station id and WKT, feeding, urgent, user and district counts, TOTP ciphertext rows, the `__EFMigrationsHistory` row count and latest migration, and the PostGIS version. With no stations: `FAIL smoke: restored database has no stations`.
7. With `PATIKA_RESTORE_EXPECT` pointing at a file of expected rows (taken from the source with the same `smoke.sql`), any difference prints a diff and `FAIL smoke mismatch`.

To restore a production backup, download the newest object and its `.sha256` with a read-only token (`aws s3 cp --endpoint-url ... s3://patika-backups/db/<name> .`), run `restore.sh` into a new database, compare the smoke rows with the numbers the admin area shows, and then point `ConnectionStrings__Patika` and `ConnectionStrings__PatikaRead` at it. Restore the Data Protection key ring from the same date; otherwise admins re-enrol TOTP and purchase tokens come back only with the next purchase or restore.

### drill.sh

[`drill.sh`](../../ops/backup/drill.sh) is the end-to-end check. [`.github/workflows/patika-restore-drill.yml`](../../../.github/workflows/patika-restore-drill.yml) runs it weekly (Monday 05:40 UTC) and on `workflow_dispatch`; locally it runs from Git Bash or Linux:

```bash
cd patika && bash ops/backup/drill.sh
```

The drill:

1. Creates its own Docker network and containers: a source PostGIS 17-3.5, a second PostGIS as the fresh target, MinIO and a tools container. Only the source publishes a random `127.0.0.1` port (for `dotnet ef`); nothing binds 5432 on the host.
2. Migrates the source with `dotnet ef database update`, the same EF migrations the API applies, and seeds [`drill-seed.sql`](../../ops/backup/drill-seed.sql) (synthetic rows, `example.invalid` addresses).
3. Fingerprints the source with `smoke.sql`.
4. Generates a throwaway age key pair and creates a versioned bucket.
5. Runs `backup.sh` with upload, connecting through a password-bearing `PATIKA_BACKUP_DATABASE_URL`. A 40-day-old local file must be pruned in the same run. Shims in front of `pg_dump` and `pg_restore` record the arguments and the environment each was started with; the drill fails if the password appears in either, if `PGPASSWORD` was inherited, if no `PGPASSFILE` was set or if a `pgpass` file is left in `/tmp`.
6. Checks that the output is an age file with no plaintext seed markers in it.
7. Downloads the dump from the bucket and runs `restore.sh` into the second server against the source fingerprint.
8. Runs five negative tests that must each fail on their named check.

The workflow starts these containers itself instead of declaring `services:`, so the same script runs on a laptop.

## Photo bucket versioning

- R2: turn on object versioning for the photo bucket and add a lifecycle rule that expires noncurrent versions after 30 days. If versioning is not available for the account, keep a second bucket with a daily `rclone copy --immutable` of `media/` and a 30-day lifecycle on it. This works because a photo is never overwritten in place: every upload gets a new UUIDv7 key.
- MinIO (local and self-hosted): `mc version enable local/patika-local` and `mc ilm rule add --noncurrent-expire-days 30 local/patika-local`. The drill turns on versioning for its backup bucket with `aws s3api put-bucket-versioning` and reads it back (`versioning: Enabled` in the output below).
- Account deletion removes a user's photo objects (Worker `deletion.hard_delete` through `IObjectKeyRemovalQueue`). With versioning on, the deleted versions remain until the noncurrent expiry, so deletion of photos completes within 30 days after the hard delete.

## Not in place

- The Worker `backup.verify` job (hourly at minute 40, [`BackupVerify.cs`](../../src/Patika.Worker/Jobs/Ops/BackupVerify.cs)) lists `Backup:Directory` or the `Backup:S3Bucket`/`S3Prefix` with a list-only key and takes the newest usable `patika-*.dump.age` by the UTC stamp in its name: usable means non-empty, with the `.sha256` sidecar backup.sh writes, and neither the name nor the object time more than 5 minutes in the future (clock skew), so a planted far-future name cannot keep the check quiet. It logs a warning and mails `Ops:AlertEmail` (once per UTC day) when the newest usable backup is older than `Backup:MaxAgeHours` (26), when there is none, when a newer dump is empty or has no sidecar (`backup is invalid`), or when the listing fails; ignored future-dated objects are named in the log and the alert. It is off until one of the two locations is configured, and no production location exists (portfolio scope). Covered by `BackupVerifyTests`.
- No production schedule, bucket, token or offline identity exists (portfolio scope). The daily run and the R2 lifecycle rule are owner setup.
- Not exercised: PITR (`pgBackRest` or a managed provider), restoring the Data Protection key ring together with a dump, and R2 itself (the drill uses MinIO through the same S3 API).

## Last drill

Local run on Windows 11 with Git Bash and Docker Desktop, from the committed scripts, on 2026-10-26, after the review fixes (password moved into a temporary PGPASSFILE, checked by the pg_dump and pg_restore shims). Real output, unedited:

```text
commit: d10cf215
started: 2026-10-26T04:58:12Z
Docker version 29.7.2, build a7dcaa6

== containers (patika-drill-045813-427)
pg_dump (PostgreSQL) 17.11 (Debian 17.11-1.pgdg12+2)
1.1.1
aws-cli/2.9.19 Python/3.11.2 Linux/6.18.33.2-microsoft-standard-WSL2 source/x86_64.debian.12 prompt/off
source PostGIS on 127.0.0.1:64663; restore target patika-drill-045813-427-dst has no host port

== migrate source with the EF migrations
Applying migration '20261025143121_InitialSchema'.
Applying migration '20261025154621_Phase2'.
Applying migration '20261025170707_Phase3Api'.
Applying migration '20261025201331_Phase4Data'.
Applying migration '20261025224833_Phase4Admin'.
Applying migration '20261025232223_Phase4AdminHardening'.
Applying migration '20261026005827_Phase5Subscriptions'.
Applying migration '20261026041906_Phase6FanoutDeferral'.
Done.

== seed synthetic data and fingerprint the source
stations|4
stations_within_2km_of_moda|3
nearest_station_to_moda|d0000000-0000-7000-8000-000000000101
station_geometry_md5|c37ad7aa56a87916966cf34112959f2a
feedings|6
urgent_posts|1
users|2
totp_ciphertext_rows|1
districts|39
migrations|8
latest_migration|20261026041906_Phase6FanoutDeferral
postgis_version|3.5.2

== keys and bucket
recipient age1wlx8pej6... (identity file stays inside the tools container)
versioning: Enabled

== password-recording shims for pg_dump and pg_restore

== backup.sh with a password-bearing URL (and an expired local file to prune)
backup: wrote patika-20261026T045826Z.dump.age (92592 bytes, sha256 b85bffe00c6d801066d4f59fe500189cb7ab1e441cba096ed65ae04585be72a9)
backup: uploaded patika-20261026T045826Z.dump.age to s3://patika-backups/db/
backup: pruned 2 local files older than 30 days
pg_dump: password in neither argv nor environment; PGPASSFILE set; no pgpass file left in /tmp
encrypted file header: age-encryption.org/v1; no plaintext seed markers
2026-10-26 04:58:26      92592 patika-20261026T045826Z.dump.age
2026-10-26 04:58:27         99 patika-20261026T045826Z.dump.age.sha256

== download from the bucket and restore.sh into the second server
restore: checksum ok (b85bffe00c6d801066d4f59fe500189cb7ab1e441cba096ed65ae04585be72a9)
restore: decrypted; archive lists 245 TOC lines
restore: restored into patika_restore
restore: smoke stations|4
restore: smoke stations_within_2km_of_moda|3
restore: smoke nearest_station_to_moda|d0000000-0000-7000-8000-000000000101
restore: smoke station_geometry_md5|c37ad7aa56a87916966cf34112959f2a
restore: smoke feedings|6
restore: smoke urgent_posts|1
restore: smoke users|2
restore: smoke totp_ciphertext_rows|1
restore: smoke districts|39
restore: smoke migrations|8
restore: smoke latest_migration|20261026041906_Phase6FanoutDeferral
restore: smoke postgis_version|3.5.2
restore: smoke rows match expected.txt
restore: OK
pg_restore: password in neither argv nor environment; PGPASSFILE set; no pgpass file left in /tmp

== negative runs
negative wrong-identity     exit 1: restore: FAIL age could not decrypt patika-20261026T045826Z.dump.age: age: error: no identity matched any of the recipients
negative corrupted-file     exit 1: restore: FAIL checksum mismatch for corrupt.dump.age
negative corrupted-no-sum   exit 1: restore: FAIL age could not decrypt corrupt.dump.age: age: error: failed to decrypt and authenticate payload chunk
negative smoke-mismatch     exit 1: restore: FAIL smoke mismatch against /drill/wrong-expected.txt
negative existing-target    exit 1: restore: FAIL target database exists: patika_restore (restore only into a fresh database)

RESULT: restore drill passed
exit: 0
```
