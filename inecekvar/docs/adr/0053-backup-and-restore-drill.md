# ADR-0053: Backups, restore drill and deletion replay

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 6, package 6D (spec item 20; the backup part of item 21)

## Context

Section 6 item 20 asks for a daily `pg_dump -Fc`, age-encrypted, in a separate write-only bucket with a 30-day lifecycle, WAL/PITR, versioning on photos and exports, a `backup.verify` worker alert, `docs/ops/backup-restore.md` and a weekly CI drill that restores the latest dump into PostgreSQL with PostGIS and asserts every published line has a valid geometry and at least two stops. ADR-0002 deferred the drill to phase 6; ADR-0026 deferred backup expiry of deleted accounts. The Cetele scripts (`cetele/ops/backup/`) and the Askida drill are the proven patterns. No production host, R2 bucket or age identity exists.

## Decision

1. **Logical dump only, encrypted in the pipe.** `ops/backup/backup.sh` runs `pg_dump -Fc | age -r <recipient>`; the plain dump never touches the disk; the object is `<prefix>inecekvar-<UTC stamp>.dump.age` with a `.sha256` sidecar. No WAL archive: RPO is up to 24 hours and is stated as such.
2. **Three bucket identities.** Writer (PutObject under the prefix), reader (list and get, offline with the age identity), verifier (list only, for the worker). `bucket-setup.sh` creates them on MinIO with the policies in `ops/backup/minio/`; the drill proves each denial.
3. **Versioning everywhere, bounded by lifecycle.** Backup bucket: versioning, dumps expire after 30 days, replaced or expired versions after 1 day (so overwrites by a stolen writer key are recoverable for a day and a dump is gone after about 31 days; amended by decision 10 to 30 days). Media and exports: versioning, noncurrent `photos/` and `exports/` versions after 30 days, `incoming/` and `quarantine/` after 1 day.
4. **Restore checks as one table, all evaluated before the verdict.** `restore-drill.sh` restores into a throwaway PostGIS container and records: Alembic head equals the repository head (computed from `api/alembic/versions`), the rules of `drill-checks.sql` (published lines present, valid non-empty WGS 84 LINESTRING of at least two points, at least two stops in the line's city, TOTP secrets still AES-GCM blobs, scheduled deletions keep their immediate effects), required tables not empty, and a fingerprint (row count of every table plus SHA-256 digests of line geometry, stop order, lines, stops, accounts with a digest of the TOTP ciphertext, deletion requests and traces) identical to the source. `check_rules` fails on a missing, repeated or unexpected rule line, so an empty result cannot pass.
5. **Deletion replay is part of every restore.** `replay-deletions.sh` takes `<account id> <requested at>` lines (from the old primary's `deletion_requests` or the `auth.account.delete_requested` log events since the dump time) and re-applies the immediate part of `request_deletion` with `replay-deletion.sql`, then verifies the effects. Without `INECEKVAR_REPLAY_APPLY=1` it flags and fails. The drill records one request after the dump and must replay it.
6. **`backup.verify` reads its own settings.** `app/workers/backup_verify.py` has a `BackupVerifySettings` class (prefix `INECEKVAR_BACKUP_VERIFY_`) so the API settings module stays untouched; thresholds 26 hours and 4 KiB; statuses `ok`, `missing`, `stale`, `empty`, `too_small`, `no_checksum`, `listing_error`, `not_configured` (an alert only in production). One `backup.verify.alert` line at error level, never an endpoint, credential or exception message (the class name only); the result JSON goes to Redis `inecekvar:ops:backup-verify:last` for 8 days; the dry run logs `backup.verify.alert_suppressed` and writes nothing. Cron daily 07:30 Europe/Istanbul. `python -m app.workers.backup_verify` runs it once for the drill.
7. **The drill owns its containers.** `drill-e2e.sh` starts `drill-compose.yml` under `inecekvar-drill-<run id>` with random passwords, ports 57791 and 57792 on 127.0.0.1 (57277 to 57776 refused), migrates with Alembic, seeds the sample city and five synthetic accounts (TOTP blobs encrypted at run time by `app.auth.totp.encrypt_secret` with a key that never leaves the process), creates a run-only age key pair and removes everything with `down -v`. `INECEKVAR_DRILL_MUTATION` injects one of six faults; the workflow runs all six and requires each to fail on its named check.
8. **Workflow.** `.github/workflows/inecekvar-restore-drill.yml`: weekly (Tuesday 06:10 UTC) and on dispatch, actions pinned to commit SHAs, images pinned to digests, age from the Ubuntu archive, no repository secret.

10. **Review amendment: overwrite retention and tamper detection** (phase 6 review F3). `s3:PutObject` lets the backup host overwrite every dump and sidecar, the 1-day noncurrent retention left a compromised backup host a day to destroy 30 days of backups, and `backup.verify` checked only size, age and sidecar presence. Now: noncurrent versions of the backup prefix are kept 30 days (`backup-lifecycle.json`; total life of a dump about 60 days, privacy text adjusted); `backup.verify` refuses a dump whose key stamp lies more than `INECEKVAR_BACKUP_VERIFY_FUTURE_TOLERANCE_MINUTES` (10) in the future (`future_stamp`) or differs from `LastModified` by more than `INECEKVAR_BACKUP_VERIFY_MAX_STAMP_SKEW_HOURS` (6) (`stamp_skew`), and the worker keeps the last listing's ETag and size per key in the Redis hash `inecekvar:ops:backup-verify:seen` and alerts `changed` once when a seen key changes. Object Lock is the stronger option and an owner item. Tests: `test_future_key_stamp_alerts`, `test_stamp_far_from_last_modified_alerts`, `test_changed_etag_or_size_of_a_seen_key_alerts`, `test_seen_listing_is_kept_in_redis_and_alerts_once` and `test_job_lists_a_real_bucket` (an overwrite on real MinIO reads `changed`, then `ok`). Mutations "change check off" and "stamp checks off" each turn tests red. `restore.sh` applies the same stamp rules before it downloads (decision 11).

## Evidence

Workstation (Windows 11, Docker Desktop, Git Bash, age v1.3.2), 2026-10-13, images pinned to the digests of the workflow:

- `bash inecekvar/ops/backup/drill-e2e.sh`: exit 0 in 34 s. Tail:

  ```
  stored: inecekvar/inecekvar-20261013T022824Z.dump.age (dump time 2026-10-13T02:28:24Z)
  "age_seconds": 2 "dumps": 1 "size_bytes": 80341 "status": "ok"
  writer list: denied (expected)
  writer read: denied (expected)
  writer delete: denied (expected)
  reader write: denied (expected)
  verifier read: denied (expected)
  stored object: age file, no seeded plain text in 80341 bytes
  decrypt with another identity: refused (expected)
  01990000-0000-7000-8000-00000000d005 replayed
  CHECK                                      RESULT DETAIL
  alembic_head                               pass   restored 0005 = repository head 0005
  published_lines_present                    pass   0 violations
  published_line_geometry_valid              pass   0 violations
  published_line_at_least_2_stops            pass   0 violations
  published_line_stops_in_city               pass   0 violations
  totp_secret_still_ciphertext               pass   0 violations
  scheduled_deletions_keep_immediate_effects pass   0 violations
  required_tables_not_empty                  pass   14 tables hold rows
  fingerprint_matches_source                 pass   31 lines identical (row counts and hashes)
  deletions_after_dump_reapplied             pass   replayed 1, carried 0, absent 0
  RESULT: restore drill passed
  RESULT: end-to-end drill passed
  cleanup: removed compose project inecekvar-drill-179185848922524 (containers, network, volumes) and the run keys
  ```
  MinIO listed the imported rules (`inecekvar-dumps-expire-after-30-days`: 30 days latest, 1 day noncurrent; media `photos/` 30 days noncurrent, `incoming/` and `quarantine/` 1 day; exports 30 days noncurrent) and versioning enabled on all three buckets.
- Negative runs (`INECEKVAR_DRILL_MUTATION=...`), each exit 1, each caught by exactly the intended check; the unmutated run above is the restored state:

  | Mutation | Fault | Caught by |
  | --- | --- | --- |
  | `corrupt-dump` | byte 40155 of the stored dump flipped, sidecar unchanged | `restore: FAIL checksum mismatch: sidecar cb05bb7e..., file 36a33c51...` |
  | `wrong-identity` | restore with another age identity | `restore: FAIL age could not decrypt ... (status 1; wrong identity?)` |
  | `drop-stop` | published line `ornek-hat-3` left with one stop before the fingerprint | `published_line_at_least_2_stops FAIL 1 violations` (the only FAIL row) |
  | `plain-totp` | readable base32 secret stored for d001 before the fingerprint | `totp_secret_still_ciphertext FAIL 1 violations` |
  | `empty-table` | every favorite deleted before the fingerprint | `required_tables_not_empty FAIL empty or missing: favorites(0)` |
  | `skip-replay` | replay list only flagged | `deletions_after_dump_reapplied FAIL 1 not re-applied: ...d005 missing` |

- `bash inecekvar/ops/backup/checks.test.sh`: `checks: 70 passed, 0 failed` (configuration refusals without printing the canary secret; every check function with a passing and a failing fixture).
- `docker run koalaman/shellcheck:v0.11.0 -x -S style` on the eight scripts: no findings (exit 0).
- In `inecekvar/api`: `uv run ruff check .` `All checks passed!`; `uv run mypy --strict app tests` `Success: no issues found in 221 source files`; `INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/workers -q` `24 passed` (15 in `test_backup_verify.py`: fresh, stale with the 26-hour boundary, missing, empty object, too small, no checksum, newest decides, listing error without secrets, alert line and published result, ok, dry run, not configured, settings, and one job run against a real Testcontainers MinIO bucket).
- Worker mutations, each restored: stale accepted (`elif False and age > ...`) fails `test_stale_dump_alerts`, `test_newest_dump_decides`, `test_alert_line_and_published_result`; empty accepted (`size < 0`) fails `test_empty_object_alerts`, `test_newest_dump_decides`, `test_job_lists_a_real_bucket`; sidecar ignored fails `test_missing_checksum_alerts`.
- Secret scan: `gitleaks git --log-opts="origin/main..HEAD"` no leaks after the scripts commit was amended locally to build a JSON listing fixture from parts (gitleaks read `"key":"inecekvar-...dump.age"` as an API key); no age key appears in any file: drill keys are made at run time.

Not exercised:

- `not exercised: real R2/S3` (no bucket or tokens; whether R2 offers versioning and a put-only token for the account is to be checked at setup).
- `not exercised: real age key custody` (owner decision; no production identity exists).
- `not exercised: WAL/PITR` (not built; RPO 24 hours).
- `not exercised: GitHub run` of `inecekvar-restore-drill.yml` (the same script and negative runs ran on the workstation).
- `not exercised: backup host cron, log-based alert rule, lifecycle expiry over 30 real days, restore duration at production size`.

## Consequences

- Item 20 moves from not-started to partial: the drill clause is satisfied by executed output, but WAL/PITR, R2 and a running schedule are material residuals. Item 21 gains the backup expiry and replay evidence and stays partial.
- Every restore now has a mandatory replay step; the worker must not start before it (runbook, step 6).
- A new migration needs no drill change (the head is read from the scripts); a new table is fingerprinted automatically, and a table that must never be empty after a restore should be added to the default `INECEKVAR_DRILL_REQUIRED_TABLES`.
- Privacy texts can state that encrypted backups are kept for up to 60 days (30 days current plus 30 days as a noncurrent version, decision 10).
