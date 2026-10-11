# Backup and restore

Runbook for security checklist item 20 ("Otomatik yedek"): what is backed up, how, where the keys
live, how a restore runs, the monthly drill and what this design does not cover. Hosting context:
[ADR-0002](../adr/0002-hosting.md) (one VPS with Docker Compose, self-hosted PostgreSQL 16,
Cloudflare R2 for objects). Evidence wording follows [ADR-0004](../adr/0004-portfolio-delivery-scope.md):
nothing here ran against a real host, bucket or key (`not exercised: no hosting account`, gate G5);
the mechanics ran locally against MinIO and scratch PostgreSQL containers, with the output in
"Evidence" below.

## Overview

| Layer                     | What                                                               | Where                                     | Retention           | Status here                                  |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------- | ------------------- | -------------------------------------------- |
| Logical dump              | daily `pg_dump -Fc`, encrypted with `age` before it leaves the host | backup bucket `cetele-backups`, `cetele/` | 30 days (lifecycle) | built and run against MinIO                  |
| WAL archive (PITR)        | pgBackRest `archive-push` of every WAL segment, weekly full backup  | pgBackRest repository in the backup bucket | 4 weekly fulls      | documented only, see "WAL archiving"         |
| Photos                    | bucket versioning on `cetele-media`                                 | media bucket                              | media/ 30 days; uploads/ 1 day | built and run against MinIO; R2 not verified |
| Android local export      | `.cetele` file, AES-256-GCM, Argon2id passphrase (spec item 20)     | the phone                                 | user-managed        | outside this runbook (Android work)          |

Files, all under `cetele/ops/backup/`:

| File                          | Purpose                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `backup.sh`                   | `pg_dump -Fc \| age -r <recipient>` and upload with the write-only identity, plus a `.sha256` sidecar         |
| `restore.sh`                  | newest (or a named) dump with the read-only identity, checksum, `age -d \| pg_restore` into an empty database |
| `restore-drill.sh`            | `restore.sh` into a throwaway PostgreSQL container, fingerprint, invariants, comparison with the source        |
| `drill-e2e.sh`                | the whole chain on scratch containers (the CI job); also runs on a workstation                               |
| `bucket-setup.sh`             | MinIO only: backup bucket, lifecycle, identities and policies, media versioning                              |
| `drill-stats.sql`             | fingerprint: exact row count per table and the ledger balance checksum                                       |
| `drill-invariants.sql`        | reversal links and tenancy of ledger entries on a restored database                                          |
| `drill-seed.sql`              | synthetic drill data (3 shops, 60 customers, 630 entries with 30 reversal pairs)                              |
| `backup-lifecycle.json`       | dumps expire after 30 days, incomplete uploads after 1 day                                                   |
| `media-lifecycle.json`        | noncurrent media/ versions expire after 30 days; uploads/ after 1 day                                         |
| `minio/backup-*-policy.json`  | writer: `s3:PutObject` under the prefix only; reader: list the prefix and `s3:GetObject`                     |
| `checks.test.sh`              | configuration checks of the scripts (no Docker needed)                                                       |
| `lib.sh`                      | shared helpers (sourced)                                                                                     |

All scripts are POSIX `sh` with `set -eu`, run on Linux and Git Bash, never enable tracing and never
print a credential: bucket keys reach the client only through the `MC_HOST_<alias>` environment of
the client process, the age identity only as a file path. Each prints `--help`. Exit codes: 0 done,
1 a step failed, 2 configuration error.

## Targets

These are targets, not measurements of a production system (none exists).

| Target | Value                                                   | Basis                                                                                                                                                       |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPO    | 5 minutes with WAL archiving; 24 hours from dumps alone | pgBackRest `archive_timeout = 60` pushes at least one segment a minute; the daily dump bounds the loss when the WAL archive is unavailable or not yet set up |
| RTO    | 4 hours to a serving API on a new host                  | provision the VPS, deploy compose, restore, re-apply post-dump deletions, switch DNS; the restore step itself took seconds on the drill data (below)         |

The production database is small (one row per debt or payment of small shops), so restore time is
dominated by provisioning, not by `pg_restore`. Re-measure the restore step in every monthly drill
and revisit the RTO when a dump exceeds 1 GB.

## Daily dump

Runs on the VPS host (not inside the server container), once a day at a quiet hour, against the
compose PostgreSQL container:

```sh
# /etc/cetele/backup.env, mode 0600, owner root. Values come from the secret store; none in git.
CETELE_BACKUP_AGE_RECIPIENT=age1...                 # public recipient only
CETELE_BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
CETELE_BACKUP_S3_WRITE_ACCESS_KEY=...
CETELE_BACKUP_S3_WRITE_SECRET_KEY=...
CETELE_BACKUP_PG_CONTAINER=cetele-postgres-1
CETELE_BACKUP_AGE_BIN=/usr/bin/age
```

```sh
# root crontab: 03:15 Europe/Istanbul (00:15 UTC)
15 0 * * * set -a; . /etc/cetele/backup.env; set +a; /opt/cetele/ops/backup/backup.sh >>/var/log/cetele-backup.log 2>&1
```

What `backup.sh` does: `pg_dump -Fc` streams into `age -r <recipient>`, so the plain dump never
touches the disk; the result must start with the `age-encryption.org/v1` header; it is uploaded as
`cetele/cetele-<YYYYMMDDTHHMMSSZ>.dump.age` with a `.sha256` sidecar, then deleted locally. The
script refuses a recipient that contains `AGE-SECRET-KEY` or is not an `age1...` X25519 recipient,
plain `http` to a non-local endpoint, keys with characters that are not URL-safe, and database
names that are not plain identifiers (`checks.test.sh`).

Retention is the bucket's job, not the script's: `backup-lifecycle.json` expires dumps under
`cetele/` after 30 days. The write-only identity has `s3:PutObject` only, so a stolen VPS key
cannot list, read or delete earlier dumps. It can overwrite a key it guesses; names carry the
second they were taken, and an object lock (below) is the stronger control.

## WAL archiving and point-in-time recovery

ADR-0002 keeps PostgreSQL self-hosted, so the PITR layer is pgBackRest, not a managed provider
feature. The "managed PITR" alternative of the spec applies only if the database moves to a
managed service; then the provider's PITR window replaces this section and the daily dump stays as
the provider-independent copy.

`not exercised: no hosting account; pgBackRest was not installed or run in this repository.` The
configuration below is the intended setup, not a tested one:

```ini
# /etc/pgbackrest/pgbackrest.conf (on the database host or in a custom PostgreSQL image)
[global]
repo1-type=s3
repo1-s3-endpoint=<account>.r2.cloudflarestorage.com
repo1-s3-bucket=cetele-backups
repo1-s3-region=auto
repo1-s3-uri-style=path
repo1-path=/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-retention-full=4
start-fast=y
compress-type=zst

[cetele]
pg1-path=/var/lib/postgresql/data
```

```ini
# postgresql.conf
archive_mode = on
archive_command = 'pgbackrest --stanza=cetele archive-push %p'
archive_timeout = 60
wal_level = replica
```

Schedule: weekly `pgbackrest --stanza=cetele --type=full backup`, daily `--type=diff`. The
repository key (`repo1-cipher-pass`) and the R2 keys live in the host secret store. Open points:
the `postgres:16.15-alpine` image has no pgBackRest, so production needs either a derived image or
PostgreSQL on the host; pgBackRest needs read and write on its repository path, so it cannot use
the write-only dump identity; a PITR restore is `pgbackrest --stanza=cetele --type=time
--target="<timestamp>" restore` on a stopped, empty data directory.

## Photos

Ledger photos live in the private `cetele-media` bucket ([ADR-0017](../adr/0017-media-pipeline.md)).
They are not in the dump; the dump holds only their keys (`ledger_entries.photo_key`,
`media_objects.photo_key`). Protection is bucket versioning: an overwrite or delete leaves a
noncurrent version. `media-lifecycle.json` scopes the 30-day expiry to processed photos under
`media/` (the same window as the dumps). Raw uploads under `uploads/`, which can contain EXIF
and location data, expire after one noncurrent day. Day-boundary rounding means removal can
take up to one to two days after deletion. Both rules clean up expired delete markers and abort
incomplete multipart uploads after one day.

- MinIO (local and drill): `bucket-setup.sh` enables versioning and imports both rules; the drill
  output shows `versioning is enabled` and the prefix-specific noncurrent rules.
  `MediaLifecycleTest` checks both prefixes, retention periods and cleanup settings.
- Cloudflare R2 (production): `not verified`. Whether R2 offers S3 object versioning was not
  checked against a real account. If it does not, the fallback is a daily `mc mirror` of
  `cetele-media` into a second, separately keyed bucket with the same 30-day expiry; this is an
  owner decision before launch.
- Deletion interplay: account and shop deletion ([ADR-0018](../adr/0018-account-and-shop-deletion.md))
  deletes the objects; processed photos survive as noncurrent versions for up to 30 days,
  like the database rows inside pre-deletion dumps. Deleted raw uploads have the shorter
  one-day noncurrent expiry, with removal taking at most one to two days. The privacy notice
  must state both periods. Restores are for failures only; post-dump deletions must be applied
  again before reopening traffic.

## Keys and identities

| Secret                                        | Created                                         | Lives                                                                                   | Never                                                    |
| --------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| age identity (`AGE-SECRET-KEY-1...`)          | `age-keygen` on the owner's offline machine     | password manager entry plus one printed copy in a safe; copied to a restore machine only for a restore or drill, then deleted | on the VPS, in CI secrets, in git, in an environment variable |
| age recipient (`age1...`)                     | `age-keygen -y identity.txt`                    | `CETELE_BACKUP_AGE_RECIPIENT` in `/etc/cetele/backup.env`                               | (public, but kept with the config for traceability)      |
| bucket write identity                         | R2 token scoped to `cetele-backups`             | `/etc/cetele/backup.env` on the VPS                                                     | on a workstation                                         |
| bucket read identity                          | R2 token scoped to `cetele-backups`, read only  | password manager; used for drills and restores only                                     | on the VPS                                               |
| pgBackRest `repo1-cipher-pass`                | random 48 hex characters                        | host secret store and password manager                                                  | in git                                                   |

Rotation: a new age key pair once a year or at once on suspected exposure. Change the recipient
on the VPS; keep the old identity until the last dump encrypted to it has expired (30 days), then
destroy it. Bucket tokens rotate on the same occasions; the drill after a rotation proves the new
pair. `restore.sh` reads the identity from `CETELE_RESTORE_AGE_IDENTITY_FILE` and passes only the
path to `age`.

R2 token scopes (ADR-0002, "Not verified"): R2 offers read-only and read-write tokens per bucket;
a write-only token like the MinIO `cetele-backup-writer` policy may not exist. With a read-write
token on the VPS, a stolen key can read dumps (encrypted, useless without the identity) and delete
them; the mitigation is an R2 bucket lock or object lock retention rule of 30 days on `cetele/`.
Both are `not verified: no R2 account`.

## Restore

1. Provision the target (new VPS or the existing host after the incident is contained). Start the
   compose stack with the server stopped, and create an empty database, for example
   `CREATE DATABASE cetele_restore TEMPLATE template0;`.
2. On the machine that holds the identity file and the read token:

   ```sh
   export CETELE_BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
   export CETELE_RESTORE_S3_READ_ACCESS_KEY=... CETELE_RESTORE_S3_READ_SECRET_KEY=...
   export CETELE_RESTORE_AGE_IDENTITY_FILE=/secure/cetele-backup-identity.txt
   export CETELE_RESTORE_PG_CONTAINER=cetele-postgres-1 CETELE_RESTORE_PG_DATABASE=cetele_restore
   # optional: CETELE_RESTORE_OBJECT=cetele/cetele-20261011T001500Z.dump.age
   ops/backup/restore.sh
   ```

   It refuses a non-empty target, a checksum that differs from the sidecar and an identity that
   cannot decrypt the file.
3. Check the restored database: `psql -At -f ops/backup/drill-stats.sql` and
   `psql -At -f ops/backup/drill-invariants.sql` (every invariant line must end in ` 0`).
4. Re-apply deletions completed after the dump time: the restored `deletion_requests` and
   `audit_logs` stop at the dump, so deletions completed later are found in the server log lines
   of the deletion executor and run again before the server is opened. This step is manual.
5. Point the server at the restored database (rename it to `cetele` or change `CETELE_DB_URL`),
   start the server, check `/actuator/health`, then reopen traffic.
6. For a point in time between dumps, use the pgBackRest restore above instead of steps 2 and 3.
7. Destroy the identity copy on the restore machine and write the incident note.

Photos: a restore to an earlier point leaves objects uploaded after the dump without a database
row (harmless, removed by the media expiry jobs) and may reference objects deleted after the dump;
those are recovered from noncurrent versions while they are younger than 30 days.

## Monthly drill

Two layers, both monthly:

1. Automated mechanics, `.github/workflows/cetele-restore-drill.yml`: on the 1st of each month at
   06:20 UTC and on demand (`workflow_dispatch`). It runs `checks.test.sh`, then `drill-e2e.sh` on
   scratch containers: migrations V1..Vn, synthetic data, source fingerprint, `backup.sh` with a
   run-only age key pair and the write-only identity, the identity denial checks, and
   `restore-drill.sh`, which must print `RESULT: restore drill passed` (row counts and the ledger
   balance checksum identical to the source). The output is an artifact kept 30 days.
   `BackupRestoreDrillTest` runs the same dump and restore path in Testcontainers on every server
   build (`cetele-ci.yml`).
2. Production drill by the owner, within the first week of the month, once production exists:
   - pick a quiet hour; run `psql -At -f ops/backup/drill-stats.sql` on production into
     `expected.txt`, then run `backup.sh` by hand at once;
   - on the restore machine: `CETELE_DRILL_EXPECTED=expected.txt ops/backup/restore-drill.sh`
     with the read token and the identity file. Writes between the fingerprint and the dump
     (logins, OTP codes, refresh tokens) can differ in their tables; any difference in
     `ledger_entries`, `customers`, `shops` or the `ledger_balance` line is a failed drill;
   - without `CETELE_DRILL_EXPECTED` the drill still checks the invariants and prints
     `RESULT: restore drill passed without a source comparison`, which does not count as a full
     drill;
   - record date, object, duration of the restore step, result and operator in the log below.

### Drill log

| Date       | Where                    | Object                                    | Restore step | Result                                                      |
| ---------- | ------------------------ | ----------------------------------------- | ------------ | ----------------------------------------------------------- |
| 2026-10-11 | local workstation, MinIO | `cetele/cetele-20261011T065416Z.dump.age` | under 20 s   | identical fingerprint, invariants hold (Evidence, run 1)    |

## Not covered

- Real hosting: no VPS, no R2 bucket, no tokens, no cron entry exists (`not exercised: no hosting
  account`, ADR-0004 G5). R2 write-only tokens, R2 versioning and R2 bucket locks are not verified.
- pgBackRest and WAL archiving: documented, never run; the RPO of 5 minutes is therefore a target
  with no evidence.
- Consistency of the production fingerprint: `drill-stats.sql` and `pg_dump` take separate
  snapshots, so the exact comparison holds only on a quiet source (CI) or by inspection (production).
- Alerting on a missed or failed backup: `backup.sh` exits non-zero and logs, but nothing pages
  anyone yet; the alert path belongs to the cost and health alerts of item 22.
- Off-site copy outside Cloudflare, and a second age recipient for escrow: one recipient and one
  provider only.
- Server-side object data other than photos (none exists today) and the Android local export
  (separate work in the app).
- Re-applying post-dump deletions after a restore is a manual step.
- The age binary of the local run was v1.3.2 (Windows release); the CI job uses the Ubuntu
  package, whose version is printed in the job output.

## Evidence

Every result below carries its command and real output (ADR-0004). Runs on 2026-10-11 on the
development workstation (Windows, Git Bash, Docker 29.7.2).

### Run 1: end-to-end drill against MinIO and scratch PostgreSQL

Command (from `cetele/`, the same script the workflow runs; age v1.3.2 Windows release):

```sh
CETELE_BACKUP_AGE_BIN=<dir>/age.exe CETELE_DRILL_AGE_KEYGEN_BIN=<dir>/age-keygen.exe sh ops/backup/drill-e2e.sh
```

Exit status 0. Complete output:

```text
run: local workstation, commit fb98915 plus the uncommitted ops/backup files
started: 2026-10-11T06:54:03Z
Docker version 29.7.2, build a7dcaa6
images: postgres:16.15-alpine, pgsty/minio:RELEASE.2026-08-04T00-00-00Z, pgsty/mc:RELEASE.2026-09-16T00-00-00Z
age: v1.3.2
== step 1: network, MinIO and the source database
ready: source PostgreSQL 16.15, MinIO
== step 2: buckets and identities
== step 1: backup bucket cetele-backups with the 30-day lifecycle rule
Bucket created successfully `a/cetele-backups`.
Access permission for `a/cetele-backups` is set to `private`
Lifecycle configuration imported successfully to `a/cetele-backups`.
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Expiration for latest version (Expiration)                                                          │
├───────────────────────────────────┬─────────┬─────────┬──────┬────────────────┬─────────────────────┤
│ ID                                │ STATUS  │ PREFIX  │ TAGS │ DAYS TO EXPIRE │ EXPIRE DELETEMARKER │
├───────────────────────────────────┼─────────┼─────────┼──────┼────────────────┼─────────────────────┤
│ cetele-dumps-expire-after-30-days │ Enabled │ cetele/ │ -    │             30 │ false               │
└───────────────────────────────────┴─────────┴─────────┴──────┴────────────────┴─────────────────────┘
== step 2: write-only and read-only identities
Created policy `cetele-backup-writer` successfully.
Created policy `cetele-backup-reader` successfully.
identities: writer has cetele-backup-writer, reader has cetele-backup-reader
== step 3: versioning on the media bucket cetele-media
Bucket created successfully `a/cetele-media`.
Access permission for `a/cetele-media` is set to `private`
a/cetele-media versioning is enabled
a/cetele-media versioning is enabled
Lifecycle configuration imported successfully to `a/cetele-media`.
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Expiration for latest version (Expiration)                                                                             │
├───────────────────────────────────────────────────────┬─────────┬────────┬──────┬────────────────┬─────────────────────┤
│ ID                                                    │ STATUS  │ PREFIX │ TAGS │ DAYS TO EXPIRE │ EXPIRE DELETEMARKER │
├───────────────────────────────────────────────────────┼─────────┼────────┼──────┼────────────────┼─────────────────────┤
│ cetele-media-noncurrent-versions-expire-after-30-days │ Enabled │ -      │ -    │              0 │ true                │
└───────────────────────────────────────────────────────┴─────────┴────────┴──────┴────────────────┴─────────────────────┘
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Expiration for older versions (NoncurrentVersionExpiration)                                                      │
├───────────────────────────────────────────────────────┬─────────┬────────┬──────┬────────────────┬───────────────┤
│ ID                                                    │ STATUS  │ PREFIX │ TAGS │ DAYS TO EXPIRE │ KEEP VERSIONS │
├───────────────────────────────────────────────────────┼─────────┼────────┼──────┼────────────────┼───────────────┤
│ cetele-media-noncurrent-versions-expire-after-30-days │ Enabled │ -      │ -    │             30 │             0 │
└───────────────────────────────────────────────────────┴─────────┴────────┴──────┴────────────────┴───────────────┘
RESULT: buckets ready
== step 3: migrations and synthetic data
applied: V1__init.sql
applied: V2__auth.sql
applied: V3__tenancy.sql
applied: V4__ledger.sql
applied: V5__services.sql
applied: V6__billing.sql
applied: V7__sms_delivery_reports.sql
applied: V8__admin.sql
seeded: drill-seed.sql
== step 4: source fingerprint
ledger_balance shops=3 total=4458600 sha256=07091556abd1c6b981875c580d307a9c68efee245bc7caa75e40c5a0e83695b8
rows admin_users 0
rows audit_logs 0
rows change_log 0
rows customers 60
rows deletion_requests 0
rows devices 0
rows invitations 0
rows ledger_entries 630
rows media_objects 0
rows memberships 3
rows otp_codes 0
rows refresh_tokens 0
rows reminders 0
rows shop_sequences 3
rows shops 3
rows sms_delivery_reports 0
rows sms_quota 0
rows statement_links 0
rows subscriptions 0
rows sync_outbox_receipts 0
rows users 3
rows webhook_events 0
== step 5: run-only age key pair
recipient: public key of a run-only identity (the identity stays in a 0600 temp file)
== step 6: backup.sh
== step 1: pg_dump -Fc | age (database cetele)
== step 2: check the encrypted file
encrypted dump: 105186 bytes, sha256 8cc3c159a7dc53ddd2e9c1aa212db720a63df2f46cc1bb3d05fd38de35ced254
== step 3: upload with the write-only identity
uploaded: s3://cetele-backups/cetele/cetele-20261011T065416Z.dump.age and cetele-20261011T065416Z.dump.age.sha256
RESULT: backup uploaded cetele/cetele-20261011T065416Z.dump.age
== step 7: negative checks
stored: cetele/cetele-20261011T065416Z.dump.age
writer list: denied (expected)
writer read: denied (expected)
writer delete: denied (expected)
reader write: denied (expected)
stored object: no seeded plain text ('Drill customer' not found in 105186 bytes)
decrypt with another identity: refused (expected)
== step 8: restore-drill.sh
== step 1: start a throwaway database (postgres:16.15-alpine)
server: 16.15
== step 2: restore the newest dump
== step 1: pick the dump
dumps listed: 1, newest: cetele/cetele-20261011T065416Z.dump.age
== step 2: download and check
downloaded: 105186 bytes, sha256 8cc3c159a7dc53ddd2e9c1aa212db720a63df2f46cc1bb3d05fd38de35ced254
checksum: matches the sidecar
== step 3: check the target database restored
target: empty
== step 4: age -d | pg_restore
restored tables in public: 22
RESULT: restored cetele/cetele-20261011T065416Z.dump.age into restored
== step 3: fingerprint and invariants
ledger_balance shops=3 total=4458600 sha256=07091556abd1c6b981875c580d307a9c68efee245bc7caa75e40c5a0e83695b8
rows admin_users 0
rows audit_logs 0
rows change_log 0
rows customers 60
rows deletion_requests 0
rows devices 0
rows invitations 0
rows ledger_entries 630
rows media_objects 0
rows memberships 3
rows otp_codes 0
rows refresh_tokens 0
rows reminders 0
rows shop_sequences 3
rows shops 3
rows sms_delivery_reports 0
rows sms_quota 0
rows statement_links 0
rows subscriptions 0
rows sync_outbox_receipts 0
rows users 3
rows webhook_events 0
entries_in_customer_shop 0
reversal_pairs_consistent 0
reversals_acknowledged 0
invariants: hold
== step 4: compare with the source fingerprint
row counts and ledger balance checksum: identical to the source (23 lines)
RESULT: restore drill passed
cleanup: removed container cetele-restore-drill-1791701663-23462
RESULT: end-to-end drill passed
cleanup: removed cetele-drill-source-1791701644-23153, cetele-drill-minio-1791701644-23153, network cetele-drill-net-1791701644-23153 and the run keys
finished: 2026-10-11T06:54:33Z
```

After the run, `docker ps -a` and `docker network ls` listed no `cetele-drill` name (count 0 for
both). The source database of this run has no `flyway_schema_history` table because the script
applies the migration files with `psql`; `BackupRestoreDrillTest` uses Flyway and asserts the
history survives the restore. The ledger total and hash differ between runs because the seed uses
random ids; within a run source and restore must match.

### Run 2: configuration checks

`sh ops/backup/checks.test.sh` (Git Bash): last line `checks: 18 passed, 0 failed`. The same file
under busybox `sh` (`docker run --rm -v <cetele>:/w:ro postgres:16.15-alpine sh
/w/ops/backup/checks.test.sh`) and under dash (`debian:stable-slim`, `/bin/sh` is dash): both
`checks: 18 passed, 0 failed`.

### Run 3: static checks

- `docker run --rm -v <cetele>:/mnt:ro -w /mnt/ops/backup koalaman/shellcheck:v0.11.0 -x -s sh
  backup.sh restore.sh restore-drill.sh bucket-setup.sh drill-e2e.sh checks.test.sh lib.sh`: no
  findings, exit 0.
- `docker run --rm -v <repo>:/repo:ro -w /repo rhysd/actionlint:1.7.7 -no-color
  .github/workflows/cetele-restore-drill.yml`: no findings, exit 0.

### Run 4: Testcontainers drill in the server build

`./gradlew --offline test --tests 'app.cetele.server.ops.*'` (JDK 21): `BackupRestoreDrillTest`
`tests="5" skipped="0" failures="0" errors="0"` in
`build/test-results/test/TEST-app.cetele.server.ops.BackupRestoreDrillTest.xml`. The tests: the
restored database has the row counts and ledger balance checksum of the source; ledger invariants
hold on the restored database; the checksum is the server balance rule (`ledger.money.Balance`)
applied per shop; the checksum ignores a reversal pair and changes with one amount; the invariant
query reports a broken reversal link.

Full server gate afterwards, `./gradlew --offline check openApiContractCheck`: `BUILD SUCCESSFUL in
2m 2s`; the 116 result files of `build/test-results/test` add up to 630 tests, 0 skipped, 0
failures, 0 errors. Gradle does not declare `ops/backup/*.sql` as test inputs, so after a change to
those files only, run the test with `--rerun-tasks` (or `--rerun`) to avoid a cached result.

### Not exercised

- `.github/workflows/cetele-restore-drill.yml` on GitHub: `not exercised: the branch has not been
  pushed`; only actionlint and the local run of the same script exist.
- `restore.sh` with libpq on `PATH` (no container): `not exercised: no PostgreSQL client on the
  workstation`; the drill uses the container mode.
- Any production host, R2 bucket, token or key, pgBackRest and WAL archiving: `not exercised: no
  hosting account` (ADR-0002, ADR-0004 G5).
