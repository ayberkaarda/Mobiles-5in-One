# ADR-0028: Worker queues, job conventions and the web → worker path

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §4 (worker), §6 items 14, 21, 22; ADR-0002, ADR-0024, ADR-0026; threat
  model TB4, T-JOB-01..03; `docs/ops/worker.md`

## Context

Phase 2 moves every slow, retryable or scheduled side effect out of request handlers: emails,
push notifications, match reminders, upload processing and account hard deletion. `apps/worker`
already starts pg-boss 12 in its own `pgboss` schema and stops it gracefully on `SIGTERM`, but has
no queues. The web app and the worker share one PostgreSQL database (ADR-0002); there is no Redis.

The questions to settle: which queues exist, how jobs are enqueued from the web app, how handlers
stay correct under at-least-once delivery, how retries and failures are bounded, how scheduled work
runs, and what a job payload may contain.

## Decision

### Queues (Phase 2)

| Queue                 | Producer                                | Purpose                                                         |
| --------------------- | --------------------------------------- | --------------------------------------------------------------- |
| `email.send`          | web (auth, deletion), worker            | Transactional email, token issued by the worker (ADR-0029)      |
| `push.send`           | web (domain events), worker (reminders) | One notification to one user, all their devices (ADR-0031)      |
| `push.receipts`       | worker (`push.send`)                    | Expo receipt check 15 min after sending (ADR-0031)              |
| `match.reminder`      | web (match open, reschedule)            | T-24 h and T-2 h reminders, fan-out to `push.send` (ADR-0031)   |
| `upload.process`      | web (`uploads/:id/complete`)            | Verify, re-encode and publish one image (ADR-0030)              |
| `account.hard_delete` | web (`DELETE me`), worker (sweep)       | Hard delete after the 7-day grace period (ADR-0032)             |
| `opencall.expire`     | schedule, hourly                        | Mark expired calls, reject pending applications (ADR-0037)      |
| `maintenance.sweep`   | schedule, hourly                        | Expired tokens and buckets, orphan uploads, overdue deletions   |
| `venue.import`        | admin import (Phase 5)                  | Queue created in Phase 2, handler delivered with the admin area |

`webhook.revenuecat.process` (Phase 5), `backup.verify` and `cost.guard` (Phase 6) are added by the
ADRs of those phases. Every queue has a dead-letter queue named `<queue>.dead`.

### Job contract

- Queue names and payload schemas are zod `.strict()` schemas in `packages/contracts` (`jobs.ts`),
  imported by both producer and consumer. The worker validates every payload before running the
  handler; a payload that fails validation is failed without retry and lands in the dead-letter
  queue (it can never succeed).
- **Payloads carry identifiers only**: user, team, match, upload, deletion-request ids, enum kinds
  and timestamps. Never email addresses, names, phone numbers, message text, tokens, presigned URLs
  or object contents. Job rows live in the database, its backups and pg-boss archives; ids are
  pseudonymous, personal data is not.
- Every job carries `idempotencyKey` (string, ≤ 128 chars). The producer sets it to a stable
  business key (`email:verify:<userId>:<requestId>`, `upload:<uploadId>`,
  `reminder:<matchId>:24h:<startsAtEpochMilliseconds>`); when no business key exists, it is the
  SHA-256 of the canonical JSON of `{ queue, data }`. The same value is passed as pg-boss
  `singletonKey`, so a duplicate enqueue while the first job is still queued or active is dropped
  by pg-boss. Exception: coalesced notifications (ADR-0031) use a per-object `singletonKey` and an
  `idempotencyKey` that also names the coalescing window, because a receipt outlives the window.
  Update (ADR-0044): a dropped coalesced enqueue also writes a `push_resends` row in the same
  transaction, and the `push.send` handler completes a coalesced job itself, inside the transaction
  that checks that row, so a change made during an active delivery is carried to the next one.

### Idempotent handlers

pg-boss delivers at least once: a worker can stop after a side effect and before completion.
Handlers are written so that a second run is harmless:

1. **Database effects** run in one transaction that first inserts
   `job_receipts(queue, idempotency_key)` (unique). A unique violation means the effect already
   committed; the handler completes without doing anything.
2. **State re-check.** Handlers load current state and exit early when the job is stale: a
   reminder for a match that was cancelled or rescheduled, a hard delete for a cancelled request,
   an upload that is no longer `processing`.
3. **External effects** (Resend, Expo, R2) happen before the receipt commits and are either
   naturally idempotent (R2 delete, R2 put to a fixed key) or accepted as at-least-once with the
   rare duplicate described in ADR-0029 and ADR-0031.

`job_receipts` rows older than 30 days are removed by `maintenance.sweep`.

### Retries, expiry and dead letters

| Queue                 | Retry limit | Backoff (pg-boss `retryBackoff`) | `expireInSeconds` | Notes                                        |
| --------------------- | ----------- | -------------------------------- | ----------------- | -------------------------------------------- |
| `email.send`          | 5           | 30 s base, exponential           | 60                | Stale after token lifetime (ADR-0029)        |
| `push.send`           | 3           | 60 s base, exponential           | 60                | Dropped when the notification is stale       |
| `push.receipts`       | 3           | 300 s base                       | 60                |                                              |
| `match.reminder`      | 2           | 60 s                             | 60                | Dropped after `starts_at`                    |
| `upload.process`      | 2           | 30 s                             | 60                | Decode errors are not retried (rejected)     |
| `account.hard_delete` | 10          | 300 s base, exponential          | 600               | Dead letter raises an alert; sweep re-queues |
| `opencall.expire`     | 0           | —                                | 300               | Next hourly run covers a failure             |
| `maintenance.sweep`   | 0           | —                                | 600               | Next hourly run covers a failure             |

- A handler throws only for transient failures (network, 5xx, lock timeout). Permanent failures
  (invalid payload, target deleted, image rejected) complete the job with a logged outcome.
- Exhausted jobs move to `<queue>.dead`. Dead letters are kept 14 days, counted by the metric
  `job_dead_lettered{queue}` and alerted in preview and production on any non-zero count. They are
  inspected and re-sent by an operator (`docs/ops/worker.md`), never retried automatically.
- Completed jobs are deleted by pg-boss after 7 days; no payload holds personal data, so the
  retention is an operational choice only.

### Scheduling

- Delayed work uses pg-boss `startAfter` on the job itself (reminders at `starts_at − 24 h` and
  `starts_at − 2 h`, hard delete at `grace_until`, receipt check at `+15 min`). No polling loop.
- Periodic work (`opencall.expire`, `maintenance.sweep`) uses `boss.schedule()` with a cron
  expression in the `Europe/Istanbul` time zone. pg-boss stores schedules in the database and
  emits each cron slot once across all worker instances.
- `maintenance.sweep` also re-enqueues `account.hard_delete` for any deletion request whose
  `grace_until` passed more than one hour ago without completion, so a lost or dead-lettered job
  cannot leave an account undeleted.

### Instances and concurrency

- pg-boss fetches jobs with `FOR UPDATE SKIP LOCKED`, so each job is delivered to one worker at a
  time and cron slots are emitted once. Production runs **one** worker container; running two needs
  no code change and no distributed lock (no ShedLock-style table).
- Per-queue local concurrency: `email.send` 4, `push.send` 4, `upload.process` 2 (CPU-bound,
  `sharp` with one thread per job), `account.hard_delete` 1, others 1.

### Web → worker path

- The web app never runs handlers. It creates a send-only pg-boss client (`supervise: false`,
  `schedule: false`, `migrate: false`) and enqueues through one helper
  `enqueue(tx, queue, payload, options)` in `apps/web/lib/server/jobs.ts`.
- `enqueue` passes the caller's Drizzle transaction to pg-boss through its `db` executor option,
  so **the job row commits or rolls back with the domain write** (transactional outbox without a
  separate outbox table). A job is never enqueued for a write that rolled back, and a committed
  write never lacks its job.
- The worker owns the `pgboss` schema: on start it runs pg-boss migrations and creates every queue
  and dead-letter queue (idempotent). Deploy order is database migrations → worker → web; the web
  app's readiness check fails while a queue it sends to does not exist.
- Database roles: `kadro_worker` owns `pgboss`; `kadro_app` (web) may only `INSERT` into the
  pg-boss job table and `SELECT` queue metadata.

### Shutdown

On `SIGTERM` / `SIGINT` the worker stops fetching, waits up to 30 s for active handlers
(`boss.stop({ graceful: true, timeout: 30000 })`, already implemented), then exits. Handlers still
running at the deadline are abandoned; their jobs expire and are retried, which the idempotency
rules above make safe. The container stop grace period is 40 s.

## Consequences

- Email, push and deletion survive process restarts; a crash costs a retry, never a lost effect.
- Every job is traceable by `idempotencyKey` and request id without personal data in the queue.
- New tables: `job_receipts` (handoff `decisions-to-db-001`). New package files:
  `packages/contracts/src/jobs.ts`. New web helper: `apps/web/lib/server/jobs.ts`.
- The worker gains the configuration for Resend, R2 and Expo (handoff `decisions-to-config-001`).

## Process-level handlers

- The worker installs `uncaughtException` and `unhandledRejection` handlers
  (`apps/worker/src/process-handlers.ts`). They log one `fatal` record (error type, code and
  sanitized stack frames; never the message), run the graceful stop, then exit with code 1 so the
  process supervisor restarts the worker. The 5 second limit is a timer, so it holds only while
  the event loop keeps running; a blocked loop needs the supervisor's own kill timeout. The
  handler runs once and never throws.
- Logger calls inside event listeners (pg-boss `error` and `warning`, the web send-only client) go
  through `safeLog`: a logger that throws synchronously must not become an uncaught exception.
  Asynchronous transport failures are not covered.
- The web server installs the same hooks from `instrumentation.ts` on the Node.js runtime only:
  `uncaughtException` is logged at `fatal` and exits with code 1; `unhandledRejection` is logged at
  `error` and the server keeps serving.

## Rejected alternatives

- **Separate outbox table polled by the worker.** Duplicates what pg-boss already stores; the
  `db` executor option gives the same atomicity with one table less.
- **Web enqueues after commit (`after()` or post-commit hook).** A process stop between commit and
  enqueue loses the job; this is the Phase 1 weakness ADR-0026 accepted temporarily.
- **Redis-based queue (BullMQ).** Adds a stateful service and a second backup target; pg-boss
  matches the "PostgreSQL only" decision of §4.
- **Distributed lock for scheduled jobs.** pg-boss already emits each cron slot once.
