# ADR-0059: Restore drill and the hook invariant

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

A backup that has never been restored is not a backup. Security checklist item 20 asks for a
weekly CI restore drill that restores the latest dump into PostgreSQL with PostGIS and asserts
`AVAILABLE + RESERVED + REDEEMED + EXPIRED = qty sum`. The drill must handle the archive password
and the restore credentials without leaking them, and must never touch a database it did not
create.

## Decision

- `scripts/ops/restore-drill.sh` (bash, `set -euo pipefail`, no tracing):
  1. takes the newest archive by key name (spatie names archives `Y-m-d-H-i-s.zip`), from a local
     file (`DRILL_ARCHIVE`) or from the bucket with the restore identity (`mc` in a container,
     credentials only through the `MC_HOST_drill` environment variable);
  2. starts a disposable `postgis/postgis:16-3.5-alpine` container with no published port and no
     volume, named per run;
  3. decrypts the dump with `BACKUP_ARCHIVE_PASSWORD` (PHP `ZipArchive`; the password reaches the
     container only as an environment variable); the plain dump exists only in a pipe; an archive
     with an unencrypted dump entry is refused;
  4. restores into a fresh database and checks the invariant;
  5. prints `RESULT: restore drill passed` and removes its own container by exact name, also on
     failure.
- The invariant is written as two checks with the same meaning as the specification's sum:
  `SELECT count(*) FROM hooks` equals
  `SELECT COALESCE(SUM(qty), 0) FROM donations WHERE hooks_issued_at IS NOT NULL`, and no hook has
  a status outside `AVAILABLE`, `RESERVED`, `REDEEMED`, `EXPIRED`.
- The restore image is the Alpine PostGIS 16 build because current `pg_dump` 16 minors write
  `\restrict` lines that the Debian-tagged image's older `psql` 16.9 rejects.
- `scripts/ops/restore-drill.test.sh` builds fixture archives at run time and checks validation,
  both invariant failures (count mismatch, unknown status), a wrong password, an unencrypted
  archive, the bucket path, and that no run prints the password or the credentials.
- `.github/workflows/askida-restore-drill.yml` (weekly Monday 05:50 UTC and manual): builds a
  database with issued units, runs `backup:run --only-db` against a job-local MinIO with secrets
  created per run (`openssl rand`, masked), checks the identity denials, runs the drill test and
  the drill, keeps the output for 30 days.

## Consequences

- Recorded locally: `restore-drill.test.sh` 15 passed, 0 failed; the real drill against the local
  `askida-backups` bucket restored 28 tables, donations 7, units issued 9, hooks 9, unknown status
  0, `RESULT: restore drill passed`, exit 0 (rows created for the drill on a development database).
- RPO 24 hours and RTO 4 hours are sample targets in `docs/ops/backup-restore.md`, not measured
  guarantees.
- not exercised: the GitHub run of the drill workflow (needs the push); a production drill (no
  bucket, no credentials); a restore into a production server.
