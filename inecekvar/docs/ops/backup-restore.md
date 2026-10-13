# Backup and restore

Security checklist item 20 (and the backup part of item 21). Decisions and evidence: [ADR-0053](../adr/0053-backup-and-restore-drill.md). Scripts: `inecekvar/ops/backup/`. Drill workflow: `.github/workflows/inecekvar-restore-drill.yml`.

What this page describes is exercised against MinIO and scratch PostGIS containers on a workstation. No production host, no Cloudflare R2 bucket and no production age identity exist yet; every step that needs them is marked as an owner task.

## Architecture

```
PostgreSQL 16 + PostGIS (app DB)
   │  pg_dump -Fc  (daily, backup host cron)
   ▼
age -r <public recipient>          the plain dump never touches the disk
   │
   ▼
backups bucket  <prefix>inecekvar-<UTC stamp>.dump.age  +  .sha256 sidecar
   │   versioning on; dumps expire 30 days after upload, a replaced or expired version 30 days later
   │   identities: writer (PutObject under the prefix only)
   │               reader (list + get, restore only, kept offline with the age identity)
   │               verifier (list only, the backup.verify worker job)
   ▼
backup.verify (worker, daily 07:30 Europe/Istanbul): newest dump age <= 26 h, size >= 4 KiB, sidecar present
   │   alert: one structured log line `backup.verify.alert` (error level); result in Redis
   ▼
restore.sh -> restore-drill.sh -> replay-deletions.sh
```

Other copies: photos and exports live in versioned buckets (`inecekvar-media`, `inecekvar-exports`) whose noncurrent versions expire after 30 days (`incoming/` and `quarantine/` after 1 day); the weekly public GeoJSON export (`GET /v1/export/{city}/latest.geojson`) is a community-visible copy of the published network. Neither replaces the database dump: accounts, edits and moderation history exist only in the database.

| Script | Who runs it | Identity |
| --- | --- | --- |
| `bucket-setup.sh` | once, on MinIO (local stack, drill) | MinIO admin |
| `backup.sh` | backup host cron, daily | writer + age recipient (public) |
| `restore.sh` | operator, during an incident | reader + age identity (private) |
| `restore-drill.sh` | operator (quarterly) and `drill-e2e.sh` | reader + age identity |
| `replay-deletions.sh` | operator after every restore, before the API and worker start | database only |
| `drill-e2e.sh` | CI weekly, workstation | creates everything per run |
| `checks.test.sh` | CI, workstation | none |

## Recovery objectives (honest)

- **RPO: up to 24 hours.** One logical dump per day; there is no WAL archive and no point-in-time recovery (no pgBackRest, no managed PITR). Everything written since the last dump is lost when the primary is lost. Section 6 item 20 asks for WAL/PITR; it is not built (see "Not covered").
- **RTO: target 4 hours, not measured at production size.** The drill restores an 80 KB dump in seconds; that proves the mechanics, not the duration for a real database. Provisioning a new database host is not scripted (no host exists).
- **Retention: 30 days.** Older dumps are gone, so a corruption noticed after 30 days cannot be undone from backups.

## Schedule (owner task: the backup host)

```
# root crontab on the backup host: 03:30 Europe/Istanbul (00:30 UTC)
30 0 * * * . /etc/inecekvar/backup.env && /opt/inecekvar/ops/backup/backup.sh >>/var/log/inecekvar-backup.log 2>&1
```

`/etc/inecekvar/backup.env` (mode 0600, root) holds the `INECEKVAR_BACKUP_*` keys below; the values come from the secret store, never from git. `backup.verify` runs in the worker at 07:30, four hours after the dump, so a failed night alerts the same morning.

## Key custody (owner decision)

- `age-keygen` is run once by the owner on an offline machine. The **public recipient** (`age1...`) goes into `INECEKVAR_BACKUP_AGE_RECIPIENT` on the backup host; `backup.sh` refuses any value that looks like a private identity.
- The **identity file** (the private key) never enters the repository, CI, the backup host, the API host or a chat. Two copies: the owner's password manager and an offline medium in a separate place. Without it no backup can be restored, so losing both copies loses every backup.
- The reader token is stored next to the identity (it is only needed for a restore); the writer token lives on the backup host only; the verifier token lives in the worker environment.
- Rotation: create a new key pair, switch the recipient, keep the old identity until the last dump encrypted to it has expired (30 days), then destroy it. Rotate the bucket tokens on the same day as any suspected exposure (history-purge runbook rotation list).
- Drills never touch these keys: `drill-e2e.sh` creates a run-only key pair in a 0600 temp file and deletes it at exit.

## Restore, step by step

1. **Stop writes.** Stop the API and the worker (the hourly hard delete must not run before step 6).
2. **Prepare an empty target.** A PostgreSQL 16 server with PostGIS 3.5 (`postgis/postgis:16-3.5` locally) and a new empty database: `CREATE DATABASE inecekvar_restored TEMPLATE template0;`.
3. **Fetch the identity and the reader token** from the owner's custody to the restoring machine (a temp file with mode 0600; delete it afterwards).
4. **Restore.**
   ```
   INECEKVAR_BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
   INECEKVAR_RESTORE_S3_READ_ACCESS_KEY=... INECEKVAR_RESTORE_S3_READ_SECRET_KEY=... \
   INECEKVAR_RESTORE_AGE_IDENTITY_FILE=/run/restore/identity.txt \
   INECEKVAR_RESTORE_PG_DATABASE=inecekvar_restored \
   bash ops/backup/restore.sh          # newest dump; INECEKVAR_RESTORE_OBJECT=<key> picks another
   ```
   It prints the chosen key with its `LastModified` time and asks you to type the target database name before it restores (`--yes` skips the question; without a terminal and without `--yes` it refuses to start; only the drill's own throwaway container needs neither). It refuses a dump whose name stamp lies more than `INECEKVAR_RESTORE_FUTURE_MINUTES` (10) in the future or more than `INECEKVAR_RESTORE_MAX_SKEW_HOURS` (6) away from its `LastModified` time (a planted or overwritten dump: investigate, then set `INECEKVAR_RESTORE_OBJECT` to a dump you trust), a checksum mismatch, a file that is not age, a wrong identity ("age could not decrypt ... wrong identity?") and a non-empty target. The backup host holds the public recipient and the writer key, so it can upload a dump that decrypts correctly; the stamp checks, the `backup.verify` change alert and the confirmation are what stand between such a dump and the new primary (ADR-0053 decision 11). Note the dump time in the object name (`inecekvar-YYYYMMDDTHHMMSSZ`): everything after it is missing.
5. **Check.** `bash ops/backup/restore-drill.sh` runs the same checks on a throwaway copy (Alembic head, published line geometry and stops, TOTP ciphertext, required tables); in an incident run the queries of `drill-checks.sql` against the restored database as well.
6. **Replay deletions** (next section). Mandatory before step 7.
7. **Migrate if needed** (`uv run alembic upgrade head` when the code is newer than the dump), point `INECEKVAR_DATABASE_URL` at the restored database, start the API, then the worker.
8. **Record** the incident: dump used, dump time, data-loss window, replay list and counts.

## Deleted accounts and backups (item 21)

**Expiry.** A dump holds every account that existed at dump time, including accounts deleted later. Dumps expire 30 days after upload; since the phase 6 review a replaced or expired version is kept 30 more days (so an overwrite by a stolen writer key is recoverable for the whole retention), so a dump is gone at most about 60 days after upload plus the lifecycle scan delay. Photos deleted by the hard delete stay as noncurrent versions in the versioned media bucket for 30 days. So a deleted account leaves the photo versions within about a month and the backups within about two months of its hard delete; the privacy text should say "encrypted backups are kept for up to 60 days" (owner decision: a shorter total needs `Expiration` below 30 days, which shortens the restore window).

**Overwrite protection.** The writer identity holds `s3:PutObject` under the prefix, which S3 cannot split into "create only". Two layers answer an overwrite: the 30-day noncurrent retention above keeps the original version, and `backup.verify` alerts on a key stamp in the future (`future_stamp`), a stamp far from `LastModified` (`stamp_skew`, default more than 6 hours) and an ETag or size change of a key seen on an earlier run (`changed`, the last listing is kept in Redis; ADR-0053 decision 10). Object Lock in compliance or governance mode, where the store offers it (S3, MinIO; R2 has bucket locks), is the stronger option: it refuses the overwrite instead of detecting it, and is an owner item when the bucket is created.

**A restore must replay deletions.** Three cases, by when the request happened relative to the dump:

| Case | In the restored database | What happens |
| --- | --- | --- |
| Requested before the dump, hard delete after it | user deactivated, `deletion_requests` row `scheduled` | the hourly `deletion.hard_delete` completes it on schedule; `replay-deletions.sh` counts the requests already due |
| Requested after the dump | user active, no request, traces and favorites back | must be replayed: `replay-deletions.sh` with `INECEKVAR_REPLAY_APPLY=1` |
| Requested and cancelled after the dump | user active, no request | the replay list holds the request: give the cancellation in the cancellations list, or the replay re-deactivates an account the user kept |
| Requested before, cancelled after the dump (login in grace) | still `scheduled` | the restored request would erase an account the user kept: the cancellations list re-applies the cancellation (`replay-cancellation.sql`) |

**Replay procedure.**

1. Build the replay list: one line `<account id> <requested at, UTC ISO 8601>` per deletion request made at or after the dump time. Sources, in order of preference:
   - the old primary, if it is still readable: `SELECT user_id || ' ' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM deletion_requests WHERE created_at >= '<dump time>' ORDER BY created_at;`
   - otherwise the API logs: every request logs `auth.account.delete_requested` with `user_id` and its timestamp (log retention 30 days covers the 24-hour window); the `audit_logs` rows `account.delete_requested` are in the database and therefore lost with it.
   Build the cancellations list the same way: one line `<account id> <cancelled at, UTC ISO 8601>` per cancellation at or after the dump time, from the old primary (`SELECT user_id || ' ' || to_char(cancelled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM deletion_requests WHERE state = 'cancelled' AND cancelled_at >= '<dump time>' ORDER BY cancelled_at;`) or from the API log event `auth.account.delete_cancelled` (`user_id` and `cancelled_at`, no personal data; logged since the phase 6 review). Per account the latest event wins, so a request made again after a cancellation is still replayed.
2. Run the replay against the restored database:
   ```
   INECEKVAR_REPLAY_DELETIONS_FILE=replay.txt INECEKVAR_REPLAY_CANCELLATIONS_FILE=cancellations.txt \
   INECEKVAR_RESTORE_PG_DATABASE=inecekvar_restored INECEKVAR_REPLAY_APPLY=1 bash ops/backup/replay-deletions.sh
   ```
   Per account it prints `absent` (registered after the dump: nothing to erase), `carried` (the dump already has the request) or `replayed` (re-applied and verified: deactivated, scheduled 7 days after the original request, sessions and refresh tokens revoked, step-ups, favorites and traces deleted, pending edits withdrawn, an `account.delete_replayed` audit row without personal data), or `cancelled` (the account's latest event is a cancellation: not re-applied; a request the dump carries is cancelled with an `account.delete_cancel_replayed` audit row). Cancellations of accounts that are not in the replay list are printed with `(cancellation)`. Without `INECEKVAR_REPLAY_APPLY=1` it only flags and exits 1. It is idempotent.
3. **Residual, stated honestly:** the cancellations list is only as complete as its source. If the old primary is gone and the log lines of the window are lost, a user who cancelled after the dump is deactivated again by the restore (request carried) or by the replay (request after the dump) and erased 7 days after the original request unless they sign in again during the grace period. Record any missing source in the incident.

**What the drill proves.** `drill-e2e.sh` seeds `d004` (request before the dump, hard-deleted on the source after it), records a deletion request for `d005` after the dump, and a request plus its cancellation for `d003` after the dump. The restore check `scheduled_deletions_keep_immediate_effects` verifies `d004`'s carried request keeps its effects; `deletions_after_dump_reapplied` replays `d005`, leaves `d003` alone (`cancelled`) and requires one state line per list line; a failing `replay-deletions.sh` fails the check and an empty list is a `skip`, never a pass (ADR-0053 decision 11). The negative run `skip-replay` shows the drill fails when the replay is skipped, and `checks.test.sh` kills a replay half-way (a database stand-in that dies on the second account) and shows the check records FAIL. Not exercised against a database: re-applying the cancellation of a request the dump carries (`replay-cancellation.sql`; covered by the fake-database case in `checks.test.sh` only).

## Drills

- **Weekly, automatic:** `.github/workflows/inecekvar-restore-drill.yml` (Tuesday 06:10 UTC and on dispatch) runs `checks.test.sh`, shellcheck, `drill-e2e.sh` and the six negative runs; the output is an artifact for 30 days. It uses no repository secret.
- **Quarterly, manual (owner), against the real bucket:**
  - [ ] fetch the identity and the reader token from custody to a 0600 temp file
  - [ ] `bash ops/backup/restore-drill.sh` with the production endpoint and the reader token (no fingerprint: the comparison row says `skip`; every other row must pass)
  - [ ] note the dump time, the restore duration (time the command) and the row counts of `users`, `lines`, `line_versions`
  - [ ] build a replay list from the last day's `auth.account.delete_requested` log events and run `replay-deletions.sh` against the drill copy without `APPLY` to confirm the list format and the lookups (it may flag; that is the point)
  - [ ] confirm the newest `backup.verify` result is `ok` (`redis-cli GET inecekvar:ops:backup-verify:last`) and that the alert rule on `backup.verify.alert` exists
  - [ ] delete the temp files and record the run below

### Drill log

| Date | Who | Dump | Duration | Result |
| --- | --- | --- | --- | --- |
| 2026-10-13 | workstation, `drill-e2e.sh` | scratch | 34 s end to end | passed (ADR-0053) |
| 2026-10-13 | workstation, `drill-e2e.sh` after the phase 6 review fixes (stamp check, cancellations list, strict replay check) | scratch | about 40 s end to end | passed; the six negative runs each failed on their check (ADR-0053 decision 11) |

## Monitoring

`backup.verify` (`app/workers/backup_verify.py`, daily 07:30 Europe/Istanbul) lists the backup prefix with the list-only identity and checks the newest dump: `missing`, `stale` (older than `INECEKVAR_BACKUP_VERIFY_MAX_AGE_HOURS`, default 26), `empty`, `too_small` (under `INECEKVAR_BACKUP_VERIFY_MIN_SIZE_BYTES`, default 4096), `no_checksum`, `listing_error`, and `not_configured` in production. Any of these logs one `backup.verify.alert` line at error level with status, object key, age, size and thresholds (never an endpoint or a credential); `ok` logs `backup.verify.ok`. The result JSON is kept in Redis under `inecekvar:ops:backup-verify:last` for 8 days for the ops and cost documents. A dry run (`INECEKVAR_JOBS_DRY_RUN=true` or `dry_run=True`) logs `backup.verify.alert_suppressed` and writes nothing. The log-based alert rule itself belongs to the hosting work (not exercised: no log pipeline).

## Not covered

- WAL archiving and point-in-time recovery (pgBackRest or managed PITR): not built; RPO stays 24 hours.
- Cloudflare R2: no bucket, token or lifecycle rule exists; MinIO stands in. At setup, check in the dashboard whether R2 offers object versioning and a put-only token for the account; if the token can also read, the dumps remain protected by age, and a bucket lock (retention) rule should keep a compromised backup host from deleting them.
- The production age identity and its custody: owner decision, not in the repository.
- The backup host, its cron entry and the log-based alert rule: no host exists.
- Lifecycle expiry over real time: the rules are imported and listed by MinIO in the drill; a dump actually expiring after 30 days has not been observed.
- The GitHub run of the workflow: written and validated locally (the same script and negative runs ran on the workstation), not run on GitHub yet.
- Restore duration at production size.

## Environment keys

The scripts read their keys from the process environment (`/etc/inecekvar/backup.env` on the backup host); the worker reads `INECEKVAR_BACKUP_VERIFY_*`. The full table is in [env.md](env.md#backups-and-restore-phase-6).
