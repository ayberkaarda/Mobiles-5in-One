# Handoff worker → web 001

- From: `apps/worker` (Phase 2 queues and handlers, ADR-0028 … ADR-0031, ADR-0037)
- To: owner of `apps/web` (`lib/server`, auth and domain routes, `emails/`)
- Status: open

The worker now creates every queue of `JOB_QUEUES` with its `<queue>.dead` queue, runs the
handlers of `email.send`, `push.send`, `push.receipts`, `match.reminder`, `opencall.expire` and
`maintenance.sweep`, and calls `public.kadro_grant_pgboss_send_access()` after start. The web side
can switch from sending to enqueuing.

## 1. Send-only pg-boss client and `enqueue()` (ADR-0028)

- One client per process, started once, as the web role:
  `new PgBoss({ connectionString, options: '-c role=kadro_app', schema: 'pgboss', supervise: false, schedule: false, migrate: false, createSchema: false })`.
  `start()` reads `pgboss.version`; until handoff `worker-to-db-001` is resolved that needs the one
  extra grant described there.
- `enqueue(tx, queue, payload, { startAfter? })` in `lib/server/jobs.ts`: parse the payload with
  `JOB_PAYLOAD_SCHEMAS[queue]`, then
  `boss.send(queue, data, { singletonKey: data.idempotencyKey, startAfter, db: fromDrizzle(tx, sql) })`.
  `fromDrizzle` is exported by `pg-boss`; the job row then commits or rolls back with the domain
  write. `send` returns `null` when a job with the same key is still queued or active (every queue
  uses the `exclusive` policy): treat that as success.
- The worker's own helper is `apps/worker/src/enqueue.ts`; the web helper should behave the same.
  A test in `apps/worker/test/queues.test.ts` proves the path with real roles: `kadro_app` enqueues
  inside its transaction, a rolled-back transaction leaves no job, a duplicate key returns `null`,
  and `kadro_worker` processes the job.

## 2. Email: remove the Phase 1 path in the same release (ADR-0029)

- Templates and transports now live in `@kadro/emails` (`packages/emails`, moved unchanged from
  `apps/web/emails` and `lib/server/email/transport.ts`, plus the `deletion_scheduled` template).
  After the switch the web app sends no email, so `apps/web/emails/**` and
  `lib/server/email/transport.ts` are deleted rather than re-pointed.
- Register, forgot and `DELETE me` enqueue `email.send` with
  `{ kind, userId | null, requestId, idempotencyKey }` inside their transactions. No token is
  created on the web side any more; remove the token issuing and the `after()` scheduler from
  `account-flows.ts`.
- Forgot: enqueue exactly one job per call; `userId: null` when no eligible account matched. The
  worker runs the same transaction shape for both branches and sends nothing for `null`.
- Suggested keys: `email:verify:<userId>:<requestId>`, `email:reset:<userId|none>:<requestId>`,
  `email:registered:<userId>:<requestId>`, `email:deletion:<deletionRequestId>`.
- **Redeem side:** ADR-0029 makes redeeming a token of a purpose spend every other open token of the
  same user and purpose; Phase 1 does it for reset only. Apply it to `verify-email` as well. The
  worker already caps live tokens at three per user and purpose.
- Configuration: after the switch remove `EMAIL_TRANSPORT`, `RESEND_API_KEY` and `EMAIL_FROM` from
  `webEnvSchema` (handoff `decisions-to-config-001` §2). The worker schema already has them.

## 3. Push producers (ADR-0031)

`push.send` payload `{ type, userId, refId, idempotencyKey }`, one job per recipient, enqueued in
the transaction of the domain write. `refId` per type: match id for `match.*`, `rsvp.*`,
`lineup.slot_free`; application id for `application.*`; team id for `team.member_joined`. The worker
re-checks the recipient's access at send time, so producers may enqueue for the full recipient
list of ADR-0031 without filtering further.

- Coalesced types: `rsvp.changed` with key `rsvp:<matchId>:<recipientId>` and
  `startAfter = now + 10 min`; `application.received` with key
  `application:<openCallId>:<recipientId>` and the same delay. The exclusive policy drops repeats
  while one is pending; the handler summarises the current state.
- Other keys must be unique per event, e.g. `push:promoted:<matchId>:<userId>:<rsvpUpdatedAtEpoch>`.
- `application.decided` from a staff decision or a call close: key
  `push:decided:<applicationId>` (the expiry job uses the same key, so a close and an expiry
  never notify twice).

## 4. Match reminders

When a match becomes `open` and whenever `starts_at` changes, enqueue the reminder jobs with
`startAfter`. Use the same rule as `planMatchReminders` in `apps/worker/src/reminders/plan.ts`:
`24h` at `starts_at − 24 h` and `2h` at `starts_at − 2 h`, each only if that time is still in the
future; key `reminder:<matchId>:<24h|2h>:<startsAtEpochSeconds>`; payload
`{ matchId, reminder, startsAt, idempotencyKey }`. Old jobs need no cancellation: a rescheduled or
cancelled match makes them complete as `skipped_rescheduled` / `skipped_status`. If the function
should be shared instead of copied, the lead can move it to `packages/contracts`.

## 5. Account deletion

`DELETE me` enqueues `account.hard_delete` with key `delete:<deletionRequestId>` and
`startAfter = grace_until` (ADR-0032). The queue exists; its handler is delivered by the upload and
deletion worker. `maintenance.sweep` re-queues overdue requests with the same key.

Acceptance: web integration tests enqueue through `kadro_app` inside the domain transaction; no
email is sent from the web process; register and forgot remain constant-work (ADR-0015).
