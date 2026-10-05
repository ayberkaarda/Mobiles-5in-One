# Backups and restore

Security checklist item 20. What is backed up, where it goes, who can touch it, how long it is
kept, how a restore works and how the restore is rehearsed. Configuration lives in
`server/config/backup.php` (spatie/laravel-backup), the disk in `server/config/filesystems.php`
(`backups`), the schedule in `server/routes/console.php` (region `backups`), the boot guard in
`server/app/Providers/BackupServiceProvider.php`, the drill in `scripts/ops/restore-drill.sh`.

## What

One zip archive per run, named `askida/<Y-m-d-H-i-s>.zip`:

| Entry                             | Content                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `db-dumps/postgresql-askida.sql`  | `pg_dump` of the `pgsql` connection (plain SQL, all tables, PostGIS)    |
| `private/...`                     | the files under `server/storage/app/private` (the `local` disk)         |

Every entry is encrypted with AES-256 using `BACKUP_ARCHIVE_PASSWORD`. Outside `local` and
`testing` the application refuses to boot when that password is empty or still holds the
`.env.example` value, and when `BACKUP_ALERT_EMAIL` is not a valid address.

Shop documents uploaded through the API are stored on the `private` disk, which is the
`askida-private` S3-compatible bucket, not `storage/app/private`. They are therefore not inside
the archive. Their protection is a bucket setting of the owner: object versioning plus a
replica or provider-side backup of `askida-private`. Not exercised: no production bucket.

The dump client must have the same major version as the server (PostgreSQL 16). `pg_dump` from
an older major refuses to run; one from a newer major writes settings a 16 server rejects on
restore. Current 16 minors write `\restrict` lines, so the restore side needs `psql` 16.10 or
newer (the drill uses `postgis/postgis:16-3.5-alpine`).

## Where and who

The `backups` disk is an S3-compatible bucket (`BACKUP_AWS_BUCKET`, default `askida-backups`)
separate from the document and photo buckets and reached with its own key pair
(`BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`, `BACKUP_AWS_ENDPOINT`). Three
identities, each with the least it needs:

| Identity                | Held by                     | Allowed on the backup bucket                                        | Used for                                       |
| ----------------------- | --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `askida-backup-app`     | the application (`.env`)    | `PutObject`, `ListBucket`, `DeleteObject` (plus multipart cleanup)  | `backup:run`, `backup:clean`, `backup:monitor` |
| `askida-backup-restore` | ops, outside the app        | `GetObject`, `ListBucket`                                           | restores and the restore drill                 |
| bucket owner            | the owner, never in `.env`  | lifecycle, policy and versioning changes                            | maintenance                                    |

The sample policies are `docker/minio/policies/askida-backup-app.json` and
`askida-backup-restore.json`; locally `minio-init` in `docker-compose.yml` creates the bucket and
both identities with them. The application identity can still delete archives (retention needs
it), so the bucket is not write-only and is not described as such. A stolen application key can
destroy archives but cannot read them; the owner's protection against deletion is bucket
versioning with a retention lock or a provider-side copy.

S3-compatible stores authorise `HeadObject` (existence, size, modification time) with
`GetObject`. Because the application identity has no `GetObject`, the `backups` disk uses the
`s3-backups` driver: the regular S3 driver whose existence, size and modification time come from
the bucket listing (`App\Support\Backup\ListingMetadataAdapter`). Reads stay denied.

Checked locally against MinIO (application identity reading, restore identity writing and
deleting):

```text
mc: <ERROR> Unable to read from `app/askida-backups/askida/2026-10-05-03-25-18.zip`. Insufficient permissions to access this path ...
mc: <ERROR> Unable to write to one or more targets. Insufficient permissions to access this path .../askida/probe.txt
mc: <ERROR> Failed to remove `restore/askida-backups/askida/2026-10-05-03-25-18.zip`. Access Denied.
```

## When

| Time (Europe/Istanbul) | Command          | Effect                                                                 |
| ---------------------- | ---------------- | ---------------------------------------------------------------------- |
| 03:00                  | `backup:clean`   | prunes archives by the retention rules below                           |
| 03:30                  | `backup:run`     | writes tonight's archive                                               |
| 04:00                  | `backup:monitor` | unhealthy when the newest archive is older than one day                |

All three run on one server; `backup:clean` and `backup:run` never overlap themselves.

## Retention

Every archive for 7 days, then the newest of each day for 7 more days, the newest of each week
for 4 weeks and the newest of each month for 6 months; no yearly archives. Anything older is
deleted by `backup:clean`. Size-based pruning is off: it needs object sizes per archive and the
storage limit belongs to the bucket owner (quota and lifecycle rule on the bucket).

## Alerts

Mail to `BACKUP_ALERT_EMAIL` for a failed backup, a failed cleanup and an unhealthy backup.
Successful runs and healthy checks are only logged. Not exercised: no mail provider account
(locally the mails go to Mailpit or the log mailer).

## Restore

1. Pick the archive: `mc ls restore/<bucket>/askida/` with the restore identity; archive names
   sort by time.
2. Run `scripts/ops/restore-drill.sh` against it first (below): it proves the archive decrypts,
   restores and satisfies the hook invariants without touching any running database.
3. For a real restore, create an empty database from `template0` on the target server, decrypt
   the archive with the password (any zip tool with AES-256 support, for example `7z x`), and
   apply `db-dumps/postgresql-askida.sql` with `psql -v ON_ERROR_STOP=1` as the owning role
   (`askida`). Put the application into maintenance mode (`php artisan down`) before switching
   `DB_DATABASE`, then run `php artisan migrate --force` (no pending migrations expected) and
   `php artisan up`.
4. Restore `private/...` entries into `server/storage/app/private` if the archive has any.
5. Record the time taken and the archive name in the incident notes.

## Restore drill

`scripts/ops/restore-drill.sh` takes the newest archive (`DRILL_ARCHIVE` for a local file, or
`DRILL_S3_ENDPOINT` with `BACKUP_RESTORE_ACCESS_KEY_ID` and `BACKUP_RESTORE_SECRET_ACCESS_KEY`),
decrypts it with `BACKUP_ARCHIVE_PASSWORD` (the plain dump only exists in a pipe), restores it into
a disposable PostGIS 16 container without a published port or volume, and checks:

- `SELECT count(*) FROM hooks` equals
  `SELECT COALESCE(SUM(qty), 0) FROM donations WHERE hooks_issued_at IS NOT NULL`;
- no hook has a status outside `AVAILABLE`, `RESERVED`, `REDEEMED`, `EXPIRED`.

It prints `RESULT: restore drill passed` and removes its container by exact name, also on
failure. Credentials and the password reach containers only as environment variables, never
as arguments, and are never printed. `scripts/ops/restore-drill.test.sh` checks the validation,
the invariant failures (count mismatch, unknown status), a wrong password, an unencrypted
archive and the bucket path with fixture archives built at run time.

Local run against the `askida-backups` bucket of a compose stack (project `askida-p6backup`):

```bash
BACKUP_ARCHIVE_PASSWORD=local-development-backup-password-not-a-secret \
DRILL_S3_ENDPOINT=http://minio:9000 DRILL_DOCKER_NETWORK=askida-p6backup_default \
BACKUP_RESTORE_ACCESS_KEY_ID=askida-backup-restore \
BACKUP_RESTORE_SECRET_ACCESS_KEY=askida_backup_restore_local_dev \
bash scripts/ops/restore-drill.sh
```

The workflow `.github/workflows/askida-restore-drill.yml` (weekly, Monday 05:50 UTC, and on
demand) builds a database with issued units, runs `backup:run --only-db` against a job-local
MinIO with run-time credentials, checks the two identities' denials, runs the drill test and the
drill, and keeps the output for 30 days. The production run is not exercised: no bucket, no
credentials.

## Rotation

- Application key pair: create a new key for `askida-backup-app`, deploy it in
  `BACKUP_AWS_ACCESS_KEY_ID`/`BACKUP_AWS_SECRET_ACCESS_KEY`, confirm the next `backup:run` and
  `backup:monitor`, then delete the old key.
- Restore key pair: rotate after every use by a person who leaves the ops rota.
- Archive password: set the new `BACKUP_ARCHIVE_PASSWORD`; archives written before keep the old
  password, so the old one stays in the secret store until the last archive written with it
  has expired (6 months and 6 weeks with the retention above), then it is deleted.

## Targets (sample values)

These are targets for a portfolio deployment, not measured guarantees:

| Measure | Target   | Basis                                                                  |
| ------- | -------- | ---------------------------------------------------------------------- |
| RPO     | 24 hours | one archive per night; payments can be re-read from the provider      |
| RTO     | 4 hours  | restore time of a database of this size plus DNS-free cut-over         |
