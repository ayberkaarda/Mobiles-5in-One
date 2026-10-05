# ADR-0058: Backup design

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 20 asks for daily encrypted backups at 03:30 Europe/Istanbul of the
database and `storage/app/private` to a separate bucket "with write-only credentials", retention
7 daily / 4 weekly / 6 monthly, health checks and a failure mail. `spatie/laravel-backup` has been
installed since Phase 0 with its defaults. There is no production bucket and no provider account;
MinIO is the S3-compatible target locally.

## Decision

- `config/backup.php`: name `askida`; sources the `pgsql` dump and `storage/app/private`;
  destination disk `backups`; every archive entry encrypted with AES-256 and
  `BACKUP_ARCHIVE_PASSWORD`; retention keep all 7 days, then daily 7, weekly 4, monthly 6,
  yearly 0, no size-based pruning; `backup:monitor` judges only the age of the newest archive
  (at most 1 day); mail to `BACKUP_ALERT_EMAIL` for failed backups, unhealthy backups and failed
  cleanups only.
- Disk `backups` in `config/filesystems.php` with its own bucket (`BACKUP_AWS_BUCKET`, default
  `askida-backups`) and its own key pair (`BACKUP_AWS_*`).
- **Three identities, and "write-only" is not claimed.** `backup:clean` and `backup:monitor` need
  to list and delete, so the application identity `askida-backup-app` holds `PutObject`,
  `ListBucket` and `DeleteObject` (plus multipart cleanup) and no `GetObject`. The restore identity
  `askida-backup-restore` holds `GetObject` and `ListBucket` and lives with ops outside the
  application. The bucket owner changes lifecycle, policy and versioning and is in no `.env`.
  Sample policies in `docker/minio/policies/`; `minio-init` creates the bucket and both identities
  locally (idempotent). A stolen application key can delete archives but cannot read them; the
  protection against deletion is owner-side versioning with a retention lock.
- **Deviation: `s3-backups` disk driver.** S3-compatible stores authorise `HeadObject` with
  `GetObject`, so without it spatie's `exists()`, size and age checks failed
  (`UnableToCheckFileExistence`) and retention would never delete. The disk uses the S3 driver
  wrapped in `App\Support\Backup\ListingMetadataAdapter` (existence, size and modification time
  from the bucket listing; reads stay denied). This file is outside the planned file list and is
  accepted.
- Boot guard `App\Providers\BackupServiceProvider`: outside `local` and `testing` the application
  refuses to start with an empty archive password, with the `.env.example` password, or with a
  missing or malformed `BACKUP_ALERT_EMAIL` (same pattern as the fake-driver guards).
- Schedule in `routes/console.php`: `backup:clean` 03:00, `backup:run` 03:30, `backup:monitor`
  04:00 Europe/Istanbul, on one server, clean and run without overlapping.
- The server image installs the PostgreSQL 16 client from the PGDG repository: the Debian bookworm
  client (`pg_dump` 15) refuses to dump a 16 server.

## Consequences

- **Shop documents are not in the archive.** Documents live on the `private` disk, which is the
  `askida-private` bucket, not `storage/app/private`. Their protection is owner-side bucket
  versioning plus replication: not exercised: no production bucket. The specification's
  "versioning on the public bucket" is likewise an owner-side bucket setting and not exercised.
  Item 20 stays `partial`.
- Recorded locally against MinIO: `backup:run` "Backup completed!", `backup:list` shows the
  archives, `backup:monitor` "considered healthy"; identity checks: the application identity
  cannot read an archive, the restore identity cannot write or delete.
- Tests: `tests/Feature/Ops/BackupConfigTest.php`, `BackupGuardTest.php`, `BackupListingTest.php`
  (a list-only bucket that throws on every head and get request: clean prunes, monitor judges).
- Rotation of the backup key and the archive password is in `docs/ops/backup-restore.md` and in the
  history-purge rotation list (ADR-0061).
- Alert mail delivery: not exercised: no mail provider (local mailer only).
- not exercised: a production bucket and credentials, provider-side versioning or object lock.
