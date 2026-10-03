# Worker operations

`apps/worker` is a long-running Node.js process built on pg-boss. It is the only process that runs
jobs; the web app only enqueues them (ADR-0028). This page covers what an operator needs to run,
observe and recover it.

Implementation status (Phase 2): queue bootstrap, the job runner (validation, idempotency, retries,
dead letters, logging, metrics), graceful shutdown, the health signal and the handlers of
`email.send`, `push.send`, `push.receipts`, `match.reminder`, `upload.process`,
`account.hard_delete`, `opencall.expire` and `maintenance.sweep` are implemented. The
`venue.import` handler (Phase 5, ADR-0067) reads an admin's stored CSV and records the result on
its `venue_imports` row; an import whose last attempt fails is marked `failed` (`internal_error`).
`cost.guard` (Phase 6, ADR-0081) checks e-mail and push usage against the configured thresholds
and pauses deferrable pushes for the rest of the UTC day once a threshold is reached.
ADR-0082 adds the RevenueCat subscriber deletion of `account.hard_delete` with its follow-up queue
`revenuecat.subscriber_delete`, and the weekly backup artifact check `backup.verify`.

## Queues

| Queue                          | Kind                                            | Concurrency | Retries                    | Dead letter                         |
| ------------------------------ | ----------------------------------------------- | ----------- | -------------------------- | ----------------------------------- |
| `email.send`                   | on demand                                       | 4           | 5, exponential from 30 s   | `email.send.dead`                   |
| `push.send`                    | on demand                                       | 4           | 3, exponential from 60 s   | `push.send.dead`                    |
| `push.receipts`                | delayed (+15 min)                               | 1           | 3, fixed 300 s             | `push.receipts.dead`                |
| `match.reminder`               | delayed                                         | 1           | 2, 60 s                    | `match.reminder.dead`               |
| `upload.process`               | on demand                                       | 2           | 2, 30 s                    | `upload.process.dead`               |
| `account.hard_delete`          | delayed (7 days)                                | 1           | 10, exponential from 300 s | `account.hard_delete.dead`          |
| `opencall.expire`              | cron `5 * * * *`                                | 1           | none (next run covers)     | `opencall.expire.dead`              |
| `maintenance.sweep`            | cron `35 * * * *`                               | 1           | none (next run covers)     | `maintenance.sweep.dead`            |
| `venue.import`                 | admin (Phase 5)                                 | 1           | 2, 60 s                    | `venue.import.dead`                 |
| `cost.guard`                   | cron `*/15 * * * *` (UTC)                       | 1           | none (next run covers)     | `cost.guard.dead`                   |
| `revenuecat.subscriber_delete` | after a failed RevenueCat call in a hard delete | 1           | 8, exponential from 300 s  | `revenuecat.subscriber_delete.dead` |
| `backup.verify`                | cron `20 6 * * 1` (UTC)                         | 1           | 3, exponential from 600 s  | `backup.verify.dead`                |

The definitions live in `apps/worker/src/queues.ts`. Cron expressions run in `Europe/Istanbul`.
Every source queue uses the pg-boss `exclusive` policy with `singletonKey = idempotencyKey`: while
a job with a key is queued, retrying or active, a second send with the same key returns `null`
and creates nothing. Dead-letter queues use the `standard` policy and keep jobs 14 days; completed
jobs are deleted after 7 days. Job payloads contain ids only, never personal data or tokens.

`maintenance.sweep` removes expired `email_tokens`, refresh tokens revoked or expired more than 30
days ago, `rate_limit_buckets` windows older than 2 days, `job_receipts` older than 30 days and
push tokens unseen for 60 days, and re-queues `account.hard_delete` (key
`delete:<deletionRequestId>`) for requests whose grace period ended more than one hour ago. For
uploads (ADR-0030) it rejects uploads still `pending` one hour after presign (`expired`, incoming
object deleted), closes uploads still `processing` one hour after their last change when no
`upload.process` job for them is queued, retrying or active (their job dead-lettered or was lost:
`rejected` with `expired`, raw object and any WebP an attempt already published deleted), marks
`ready` uploads that no avatar or badge references any more as `deleted`, and deletes media
objects older than one hour that are neither referenced by `users.avatar_key` / `teams.badge_key`
nor belong to an upload in `processing` (this also covers badges of teams deleted by their
staff).

### `upload.process` (ADR-0030)

Payload `{ uploadId }`, key `upload:<uploadId>`. The handler continues only while the upload is
`processing`; a second run completes as `skipped_status` and only removes a leftover raw object.

1. `HEAD` the raw object `incoming/{kind}/{ownerId}/{uploadId}` in `R2_INCOMING_BUCKET`: missing →
   `missing`; size different from `content_length` or outside 1..2 MiB → `size_mismatch`.
2. Read at most 2 MiB; magic bytes decide the format (JPEG `FF D8 FF`, PNG signature,
   `RIFF....WEBP`): unknown → `not_an_image`, different from the declared type → `type_mismatch`.
3. `sharp` with `limitInputPixels` 25 000 000 (`too_many_pixels`), `failOn: 'error'`, first frame,
   one libvips thread, 20 s timeout (`decode_failed`); EXIF orientation applied, fit inside
   1024 × 1024 without enlargement, WebP quality 80, no metadata written.
4. Permission re-check: avatar → uploader active; badge → uploader is captain or co-captain of an
   existing team. Otherwise `not_allowed`.
5. Put `{uploads.key}.webp` to `R2_MEDIA_BUCKET` (`Cache-Control: public, max-age=31536000,
immutable`) with the job's abort signal; an attempt whose signal fired (expired job, stopping
   worker) stops here and retries instead of applying. Then one transaction that locks the upload
   and the target row: `avatar_key` / `badge_key` set to that key, the previous `ready` upload of
   the same target `deleted`, this upload `ready`; a permission lost meanwhile is recorded as
   `not_allowed` in the same transaction. The replaced object is deleted after the commit.
6. The raw object is deleted in every outcome.

Two runs of the same upload can overlap (a retry after an expiry, an operator re-send). Both write
the same deterministic key; the run that finds the upload no longer `processing` under the lock
completes as `skipped_status` and deletes the object it wrote only when the upload did not become
`ready`, so the winner's published image always stays.

Rejections complete the job as `rejected_<reason>` with the upload `rejected`; they never reach
the dead-letter queue. Storage or database failures retry (`StorageError`, 2 retries, 30 s).

### `account.hard_delete` (ADR-0032, ADR-0033)

Payload `{ deletionRequestId }`, key `delete:<deletionRequestId>`, `startAfter = grace_until`.
Runs only for a request that exists, is not completed, whose `grace_until` has passed and whose
user is still deactivated; otherwise it completes as `skipped_grace_period`, `skipped_cancelled`,
`skipped_missing` or `skipped_completed` without touching anything.

Everything runs in one transaction. Lock order: deletion request → user → captained teams (id
order) → matches with an RSVP of the user (id order).

1. Decisions under the team locks: a captained team without other members is solo. Joining a
   team needs a key-share lock on its row, so nobody can join between this decision and the
   commit (a late join fails once the team is gone).
2. Object storage before any database change: every object under `avatars/{userId}/` and
   `incoming/avatar/{userId}/`, and for each solo team `badges/{teamId}/` and
   `incoming/badge/{teamId}/`. Idempotent; a storage failure rolls the transaction back and the job
   retries.
3. Database effects: solo-captained teams deleted (cascades);
   shared teams handed to the oldest co-captain, else the oldest member, with
   `team.captaincyTransfer` audit rows (`reason: account_deleted`) and `is_pro_locked` set when the
   new captain already owns a team without Pro; memberships and RSVPs on matches that are
   `draft`/`open`/`locked` when read under their row lock removed with waitlist promotion (a match
   that became `played` keeps the RSVP for the tombstone) (`rsvp.promoted` push); remaining RSVPs and both sides
   of MVP votes moved to a new tombstone user (`Silinmiş oyuncu`, no personal fields); reviews and
   open-call applications deleted, `venues.created_by` cleared; the user row deleted (cascades:
   tokens, push tokens, subscriptions, uploads); request `completed_at` set (`external_pending`
   per step 5); audit `account.deleted` with
   `{ teamsDeleted, teamsTransferred, objectsDeleted }` and no actor.
4. The `deletion_completed` email is sent before the commit with a 10 s timeout; a failure is
   counted as `email_delivery_failed{kind=deletion_completed}` and never blocks the deletion.
5. RevenueCat (ADR-0082), after the object-storage deletes and before the database effects, under
   the request lock: `DELETE /v1/subscribers/{userId}` with up to 3 attempts (backoff from 1 s) on
   429, 5xx, timeout or network errors; 404 means already deleted. Success → `external_pending`
   empty. Failure → never blocks the deletion: `external_pending = {revenuecat}`, a
   `revenuecat.subscriber_delete` job (key `rc-delete:<deletionRequestId>`) is enqueued in the same
   transaction and `revenuecat_delete_failed{stage=hard_delete,reason,status,attempts}` is counted.
   Without `REVENUECAT_API_KEY` nothing is called and `external_pending` records `revenuecat` only
   when a subscription existed. The `account deleted` log line carries `revenueCat`
   (`deleted`, `not_found`, `failed_deferred`, `skipped_unconfigured`).

### `revenuecat.subscriber_delete` (ADR-0082)

Payload `{ deletionRequestId, appUserId }`: the deleted account's id is the RevenueCat app user id
and is kept only in this job until the subscriber is gone. One call per run; a failure counts
`revenuecat_delete_failed{stage=follow_up}` and retries with backoff, then dead-letters. It runs only
for a completed request that still lists `revenuecat` and whose account row no longer exists
(`skipped_missing`, `skipped_not_completed`, `skipped_done`, `skipped_account_exists` otherwise).
Success (`deleted` or `not_found`) removes `revenuecat` from `external_pending`.

### `backup.verify` (ADR-0082)

The daily encrypted dump is produced on the database host, outside the application
(`docs/release/backup-restore-drill.md`). The worker only checks its artifacts: it lists
`BACKUP_BUCKET` with a read-only key, takes the newest `<BACKUP_PREFIX>YYYYMMDD.dump.age` object
and reports `ok`, `stale` (older than `BACKUP_MAX_AGE_HOURS`) or `failed` (`no_backup`,
`too_small` below `BACKUP_MIN_BYTES`, `not_encrypted` without an `age` header, `missing`). It never
decrypts or restores; restorability is proven only by the restore drill. The outcome is the job
output; `ok` logs `backup check ok` with `backup_verified`, the others log at `error` with
`backup_check_failed{status,reason}`. A storage error is counted as `storage_error` and retried.
Without `BACKUP_BUCKET` the job completes as `skipped_unconfigured` (warn).

The `kadro_worker` grants of migration 0010 cover every statement; no further migration is needed.

### Job lifecycle

1. The payload is parsed with the `.strict()` schema of `packages/contracts` (`jobs.ts`). An
   invalid payload is dead-lettered at once, without retry and without running the handler; the
   log line lists only the failing paths and issue codes, never values.
2. The handler re-checks current state and exits early with an outcome when the job is stale or
   no longer allowed (`skipped_*`, `not_due`, `stale_dropped`, `capped`, ...).
3. Database effects commit together with a `job_receipts(queue, idempotency_key)` row; a second
   run of the same key completes as `duplicate`. External effects (Resend, Expo) happen before the
   receipt is written and are at-least-once (ADR-0029, ADR-0031).
4. Transient failures (network, 429, 5xx) retry with the queue's backoff; after the last retry the
   job moves to `<queue>.dead`. Permanent failures complete with an outcome.

### Database roles

The worker connects with the login in `DATABASE_URL` and runs every session as `kadro_worker`
(startup option `-c role=kadro_worker`), so the pg-boss tables are owned by the group role
(migration 0010). The login must be a member of `kadro_worker`; locally the compose superuser
qualifies. After creating the queues the worker calls
`select public.kadro_grant_pgboss_send_access()`, which lets `kadro_app` start a send-only client
(`SELECT` on `pgboss.version` and `pgboss.queue`, migration 0011) and insert jobs.

## Configuration

`packages/config` validates the worker environment at boot (`loadWorkerEnv`) and exits with the
list of missing or invalid keys, without printing values.

| Key                                                | Purpose                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `APP_ENV`, `BUILD_SHA`, `LOG_LEVEL`    | Runtime identity and log level                                                                |
| `DATABASE_URL`                                     | PostgreSQL; the login must be a member of `kadro_worker`                                      |
| `WEB_ORIGIN`                                       | Origin used to build email links; non-loopback `https://` outside local                       |
| `EMAIL_TRANSPORT`                                  | `log` (local only) or `resend`; default `log` (ADR-0029)                                      |
| `RESEND_API_KEY`, `EMAIL_FROM`                     | Required for `resend`; `EMAIL_FROM` defaults to `Kadro <bildirim@kadro.app>`                  |
| `PUSH_TRANSPORT`                                   | `log` (local only) or `expo`; default `log` (ADR-0031)                                        |
| `EXPO_ACCESS_TOKEN`                                | Required for `expo` (enhanced push security)                                                  |
| `PUSH_HOURLY_CAP`                                  | Global push sends per hour, 1..100 000, default 5 000                                         |
| `EMAIL_DAILY_CAP`, `EMAIL_MONTHLY_CAP`             | `cost.guard` e-mail thresholds per UTC day / rolling 30 days; default 2 000 / 45 000; `0` off |
| `PUSH_DAILY_CAP`                                   | `cost.guard` push threshold per UTC day; default 50 000; `0` off                              |
| `R2_ENDPOINT`                                      | S3-compatible endpoint (R2); non-loopback `https://` outside local                            |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`         | Worker key: read/delete incoming, read/write/delete media                                     |
| `R2_INCOMING_BUCKET`, `R2_MEDIA_BUCKET`            | Private raw uploads and published media; must differ                                          |
| `REVENUECAT_API_KEY`, `REVENUECAT_API_BASE_URL`    | Optional; reconciliation and subscriber deletion (ADR-0063, ADR-0082); unset skips both       |
| `BACKUP_BUCKET`, `BACKUP_PREFIX`                   | Optional `backup.verify` target; unset skips the check; prefix default `kadro-`               |
| `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY` | Read-only key for the backup bucket on `R2_ENDPOINT`; required with `BACKUP_BUCKET`           |
| `BACKUP_MAX_AGE_HOURS`, `BACKUP_MIN_BYTES`         | `stale` threshold (1..720, default 30) and minimum dump size (default 1 024)                  |

`MEDIA_PUBLIC_BASE_URL` belongs to the web app, which builds public URLs; the worker only writes
object keys. It must be `https://` in every environment, because the API contract requires https
image URLs. Loopback `http://` is accepted only for `R2_ENDPOINT`, a server-side connection that
never reaches API responses. See "Public media over https locally" below.

`RESEND_API_KEY`, `EXPO_ACCESS_TOKEN` and the R2 secret are on the rotation list of
`docs/security/history-purge-runbook.md`.

## Running locally

Prerequisites: Docker running, Node.js from `.nvmrc`, `pnpm install` done.

1. Configuration, once: `cp .env.example .env`. The worker section already selects
   `EMAIL_TRANSPORT=log` and `PUSH_TRANSPORT=log` and the local storage values.
2. Database: `pnpm db:up` (PostgreSQL + PostGIS container of `docker-compose.yml`).
3. Object storage: until `docker-compose.yml` has its storage service (handoff
   `worker-to-config-001`), start a throw-away S3-compatible server on port 9000, for example
   SeaweedFS (accepts the local key pair, data kept in memory):
   ```sh
   docker run --rm -d --name kadro-local-s3 --tmpfs /data -p 127.0.0.1:9000:8333 chrislusf/seaweedfs:4.48 server -dir=/data -s3 -volume.max=50 -master.volumeSizeLimitMB=64
   ```
   The smoke script creates both buckets when they are missing. Stop it with
   `docker stop kadro-local-s3`.
4. Schema:
   ```sh
   pnpm --filter @kadro/db build
   pnpm --filter @kadro/db db:migrate
   ```
5. Worker, in its own terminal:
   ```sh
   pnpm worker:dev
   ```
   Wait for the JSON line `"msg":"worker ready"`; it lists the queues and both transports (`log`).
6. Demonstration, in a second terminal:
   ```sh
   pnpm --filter @kadro/worker smoke
   ```
   The script (`apps/worker/scripts/smoke.ts`) refuses to run outside `APP_ENV=local`, seeds a few
   rows labelled `Duman`, enqueues a verification email, a forgot-password request without an
   account, a push, a T-2 h match reminder, an avatar upload (raw PNG in the incoming bucket), an
   account deletion whose grace period is over, an open-call expiry and a sweep, waits for the
   worker to complete each job, checks the effects (one token hash stored, reminder fanned out to
   the confirmed players, WebP published and raw object removed, account removed and request
   completed, expired call with its application rejected), prints one `OK`/`FAIL` line per check
   and removes the seeded rows and objects. Exit code 0 means every check passed.
7. In the worker terminal the verification email appears as `email (log transport)` with the link
   `http://localhost:3000/e-posta-dogrula#token=...`, and pushes as `push (log transport)` with
   their fixed Turkish text. These transports are refused outside `APP_ENV=local`.
8. Health: `pnpm --filter @kadro/worker build && pnpm --filter @kadro/worker healthcheck` prints
   `kadro-worker healthy` while the worker runs.
9. Stop with Ctrl+C: the worker stops fetching, waits for active jobs and exits.

The full stack (`docker compose up --build`) runs the worker container next to web and Postgres.
Start order in every environment: migrations, then the worker (creates the queues and grants the
web role), then the web app.

### Public media over https locally

Image URLs in API responses are `MEDIA_PUBLIC_BASE_URL` plus the object key and must be `https://`;
the web app refuses a plain `http://` value at boot. Leave the variable empty and every image URL
is `null`, which is enough for most local work. To see real images:

1. Create a certificate for `localhost` from a locally trusted authority. A tool such as mkcert
   does this: it installs a local root into the system trust store and issues the certificate
   (suggestion only; nothing in the repository runs it).
2. Put a TLS-terminating reverse proxy in front of the storage service's media bucket, for example
   `https://localhost:9443` forwarding to `http://localhost:9000`, using that certificate.
3. Set `MEDIA_PUBLIC_BASE_URL=https://localhost:9443/kadro-media` in `.env`. `R2_ENDPOINT` keeps
   `http://localhost:9000`: it is the server-side storage connection and never appears in
   responses.
4. Open an image URL in the browser or simulator. It must load without a certificate warning; if
   the device does not trust the local root, install the root on it. Do not disable certificate
   verification in the app or in Node (`NODE_TLS_REJECT_UNAUTHORIZED=0` is not an option).

Tests: `pnpm --filter @kadro/worker test` starts its own disposable PostGIS container (Docker
required), runs real pg-boss against it with two login roles (`kadro_worker`, `kadro_app`
members) and fake Resend, Expo and S3 servers on loopback (the S3 fake records the order of
operations and can fail chosen requests), and removes the container afterwards.

## Observing

- Logs are JSON lines (`service: kadro-worker`). Every job line carries `queue`, `jobId`,
  `retryCount`, `idempotencyKey`, the producer's `requestId` when the payload has one, `outcome`
  and `durationMs`. Emails are masked, tokens, device tokens and credentials redacted; payload
  values of rejected jobs are never logged.
- Metrics (structured log lines with `metric`): `job_completed{queue,outcome}`,
  `job_failed{queue}`, `job_dead_lettered{queue,reason}`, `email_delivery_failed{kind,reason}`,
  `email_stale_dropped{kind}`, `push_capped{type}`, `push_ticket_error{code}`,
  `push_receipt_error{code}`, `cost_threshold{kind,period,level}` (once per UTC day and level),
  `cost_capped{kind,type}`, `cost_guard_failed{reason}`,
  `revenuecat_delete_failed{stage,reason,status,attempts}`, `backup_verified{status}`,
  `backup_check_failed{status,reason}`.
- Alerts in preview and production: any `job_dead_lettered`, any `push_capped`, any
  `cost_threshold` or `cost_guard_failed`, any `backup_check_failed`, no `backup_verified` line for
  8 days (weekly schedule), and a queue whose oldest queued job is older than 15
  minutes.
- Send gates of `cost.guard` (read-only): `select key, window_start from rate_limit_buckets where
key like 'cost:gate:%'`. A row for today's UTC date means deferrable sends of that kind are
  paused until the next UTC midnight.
- Health: the worker writes `<tmpdir>/kadro-worker/health.json`; `ready` only after the queues and
  handlers are set up, refreshed by a database probe every 30 s. The container `HEALTHCHECK` runs
  `node dist/healthcheck.js`, which fails when the status is not `ready` or older than 90 s.

Queue depth from SQL (read-only):

```sql
select name, state, count(*)
from pgboss.job
group by name, state
order by name, state;
```

## Recovering

- **Dead letters.** Inspect the payload (ids only) and `output` (error type, SQLSTATE or HTTP
  status) of the job in `<queue>.dead`. Fix the cause, then move it back with pg-boss
  `redrive('<queue>.dead')` or re-send the payload to the original queue with the same
  `idempotencyKey`; handlers are idempotent, so a re-send of already applied work completes as
  `duplicate`.
- **Rejected uploads.** Nothing to recover: the client sees `rejected` with its reason and uploads
  again. An upload whose job dead-lettered while it was `processing` can be re-sent with key
  `upload:<uploadId>` once storage is reachable; without action the sweep closes it as `expired`
  one hour later and removes its objects.
- **Overdue deletion.** No action needed: `maintenance.sweep` re-queues deletion requests whose
  grace period ended more than one hour ago. A dead-lettered `account.hard_delete` is a priority
  incident (personal data kept beyond the promised period).
- **RevenueCat cleanup owed.** Read-only:
  `select id, completed_at from deletion_requests where 'revenuecat' = any(external_pending)`.
  A row with a queued or retrying `revenuecat.subscriber_delete` job settles itself. A dead letter
  in `revenuecat.subscriber_delete.dead` (key rejected, long outage): fix the key or wait for the
  provider, then redrive it. Rows from before ADR-0082 or written without a key have no job and no
  user id left; they can only be closed by hand at RevenueCat.
- **Backup check failed or stale.** Check the dump job on the database host and the bucket
  listing first; `failed_not_encrypted` means a plaintext dump reached the bucket and is a security
  incident (remove it, rotate as needed). Re-run the check by sending `backup.verify` with any new
  key once fixed.
- **Stopping.** `SIGTERM` stops fetching and waits up to 30 s for running jobs; a job still running
  at the deadline is handed back for retry and runs again on the next instance (idempotent). The
  container stop grace period is 40 s.
- **Scaling.** One instance is the default. A second instance needs no configuration change:
  pg-boss hands each job and each cron slot to one instance only, and queue bootstrap is
  idempotent.

## Adding a deferred handler

A queue whose handler ships later is marked `queue_only` in `src/queues.ts` (none today). A
handler is added by writing it against its contract schema, registering it in the `handlers` map
of `src/runtime.ts` and setting the queue's `stage` to `active`; the runner supplies validation,
dead-lettering, receipts helpers (`src/idempotency.ts`), logging and metrics.
