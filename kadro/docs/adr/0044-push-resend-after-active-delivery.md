# ADR-0044: Re-sending a coalesced push after a change during its delivery

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0028 (queues, transactional enqueue, receipts), ADR-0031 (coalesced notifications,
  10-minute rule)

## Context

`rsvp.changed` and `application.received` coalesce per object and recipient (ADR-0031): the web
producer enqueues `push.send` with `singletonKey` `<prefix>:<objectId>:<recipientId>` and a
10-minute `startAfter`, and the `exclusive` queue policy drops every further enqueue while a job
with that key is queued, retrying or active. pg-boss 12.35.1 enforces this with the partial unique
index `job_i6 (name, singleton_key) WHERE state <= 'active' AND policy = 'exclusive'`.

Dropping is right while the job is queued: it has not read anything yet and its summary will
include the change. It is wrong once the handler has read the state it renders (confirmed count,
pending applications) and has not completed: the change is dropped, the summary sent does not
contain it, and no later job exists. The change is lost until an unrelated event opens another
window, possibly never.

Constraints: the 10-minute coalescing rule stays; a delivery is never sent twice for one window
(receipt key `<singletonKey>:<windowOpenedEpochMilliseconds>`); the enqueue stays in the domain
transaction (ADR-0028 transactional outbox), so a rolled-back change records nothing.

## Options

**(a) Durable pending re-send record (chosen).** When the coalesced enqueue is dropped, the
producer writes a `push_resends` row for the key in the same transaction. The worker reads the row
before it reads the state and, once the delivery has an outcome, completes its job and checks the
row in one transaction: a row the delivery already covered is deleted; a row that changed after
the state read becomes the next window's job.

- Race: the producer's row may be uncommitted when the worker checks, or the job may complete
  between the producer's dropped enqueue and its row insert. Closed by one transaction-scoped
  advisory lock per key (`pg_advisory_xact_lock(hashtextextended('push-resend:<key>', 0))`, the
  repo's existing pattern) taken by the producer before its enqueue and by the worker before it
  completes the job. And by completing the job inside that transaction (`boss.complete(...,
{ db })`, fenced to the fetched attempt), so the follow-up job can take the same `singletonKey`
  and a producer that waited on the lock finds the job completed and enqueues normally.
- Double send: none. The follow-up job has a new window key; a row whose version the job read
  before its state read is deleted without a follow-up.
- Accumulation: one row per key at most (unique key, `version` counts changes). Rows live until
  the job holding the key completes. A job that dead-letters leaves its row; the next window's job
  clears it, and the maintenance sweep deletes rows not changed for a day (a push that old is
  stale under the 6-hour rule anyway).
- Transaction boundary: the row is written in the domain transaction with the enqueue; the
  worker's completion, row check and follow-up enqueue commit together. One new table and one
  migration.

**(b) Bypass the singleton while a job is active; compare state versions in the handler.** Every
change enqueues while the key is active (for example a second key per state), and the handler
skips when a newer version exists. pg-boss cannot drop "only while queued" for one queue whose
policy is `exclusive` for every other push type, so the producer would need to know whether the
job is active: `kadro_app` cannot read `pgboss.job` (migration 0011 grants `INSERT` and two
columns only). It also needs a per-object state version that no domain table has (`match_rsvps`
and `open_call_applications` change in several places). More moving parts, wider grants, and two
jobs per window in the common case.

**(c) pg-boss native mechanism.** Read in the installed 12.35.1 source (`dist/plans.js`,
`dist/manager.js`):

- `stately` allows one queued and one active job per key (`job_i3` on `(name, state, key)`),
  which is close to the wanted behaviour, but a queue's policy cannot change after creation
  (`updateQueue` throws `queue policy cannot be changed after creation`). `push.send` would have to
  be replaced by a new queue (contract change in `packages/contracts`, migration of live jobs), and
  under `stately` a failing job whose retry conflicts with another non-terminal job of the key is
  failed instead of retried (`manager.js`, retry path of `fail`), so a failed delivery could end
  without a retry.
- `singletonSeconds` with `singletonNextSlot` (debounce) uses `job_i4` on
  `(name, singleton_on, key)` for every non-cancelled state. Windows become fixed time slots
  instead of "10 minutes from the first change", the first event of an empty slot runs at once,
  and the next-slot insert still collides with `job_i6` on an `exclusive` queue. A change committed
  just after a slot boundary while the next slot's job starts is still lost.

Neither keeps the 10-minute rule and the existing queue without a contract change.

## Decision

Option (a).

### Table `push_resends` (migration 0012)

`id` uuid v7, `singleton_key` text unique (1–128), `type` text in (`rsvp.changed`,
`application.received`), `user_id` uuid, `ref_id` uuid, `requested_at` timestamptz (first dropped
change since the row was cleared), `version` integer ≥ 1, `created_at`, `updated_at`; index on
`updated_at`. No foreign keys: the columns mirror a job payload, which has none either; rows are
short-lived and swept. Grants: `kadro_app` SELECT, INSERT, and UPDATE on `version` and
`updated_at` only (insert or bump); `kadro_worker` SELECT, DELETE. The migration only creates;
reverting it is dropping the table, which no migration does automatically.

### Producer (web, `lib/server/jobs/notify.ts`)

Per recipient, in sorted order (a fixed lock order), inside the caller's transaction:

1. `lockPushResend(tx, singletonKey)`.
2. Enqueue as before (`singletonKey`, window key, `startAfter` = now + 10 min).
3. When the enqueue returns `null` (dropped): `recordPushResend` inserts the row or, if one
   exists, increments `version` and keeps the first `requested_at` and `ref_id`.

### Worker (`apps/worker/src/push/resend.ts`, `handler.ts`)

For a coalesced job (type above and `singletonKey` ≠ `idempotencyKey`):

1. Before the delivery reads any state: `seen` = the row's `version`, 0 when absent.
2. Deliver as before (receipt, recipient check, cap, Expo).
3. Settle, in one transaction: take the key's lock; complete the job through pg-boss with the
   transaction as executor, fenced to the fetched `retryCount`. If no row was completed, the claim
   was lost (expiry and retry); the attempt that holds the job settles. Otherwise delete the row if
   `version ≤ seen`. If a row remains, enqueue the next window's job: same `singletonKey`,
   `refId` from the row, window opened at `max(now, requested_at, this window + 1 ms)`, `startAfter`
   = opened + 10 min, then delete the row.
4. A thrown error (transient failure) settles nothing: the row stays, pg-boss retries the job, and
   the retry reads the row and the state again.
5. A failure after the receipt has committed and before settle commits (a crash, a failed settle
   transaction) leaves the job active or retrying with its receipt written. The retry returns
   `duplicate` without reading any state, so it cannot know which recorded changes the earlier
   delivery covered: it settles with `seen` = 0 and hands every pending row on. The cost is at
   most one extra summary after such a failure; the alternative, treating the row as covered,
   loses a change made after the earlier state read.

pg-boss's own completion after the handler returns finds the job already completed and changes
nothing (its completion is fenced to the attempt and only touches `active` jobs).

### Interleavings

| Change commits …                              | Outcome                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| while the job is queued                       | row written; the job reads it and the state; deleted |
| after the version read, before the state read | covered by the state, and also sent again (harmless) |
| after the state read, before settle           | row version > seen; follow-up job                    |
| while settle holds the lock                   | producer waits; finds the job completed; new window  |
| after settle                                  | no job holds the key; new window                     |
| during a failed attempt                       | row kept; the retry reads it                         |
| before a failure between receipt and settle   | the retry (`duplicate`) hands the row on             |

## Consequences

- No change made during an active delivery is lost; the follow-up arrives 10 minutes after the
  previous delivery at the earliest, so the coalescing rule still bounds pushes per object and
  recipient.
- A change that lands between the version read and the state read is delivered and then sent
  once more as a follow-up summary with the same content; accepted, since telling the two apart
  would need a state version the domain does not keep.
- Every dropped repeat costs one upsert and an advisory lock in the domain transaction.
- Account hard delete (ADR-0032 step 6) deletes the user's rows, since `user_id` has no foreign
  key to cascade; the deletion proof's table dump covers the table.
- `JobContext` gains `singletonKey`; the worker's `enqueue` accepts a coalescing key.
- The maintenance sweep reports `pushResends` and deletes rows whose `updated_at` is more than a
  day old, each under its key's lock and re-checked there. Not `requested_at`: a new change on a
  row a dead-lettered job left keeps the old `requested_at`, and sweeping by it would delete the
  live window's record; the lock keeps a change that is still committing.
- Tests: `apps/worker/test/push.test.ts` holds the Expo request after the state read (a barrier,
  not a delay) and commits the change there, for both types; it failed before this change (no
  follow-up job) and covers the queued window, the exact 10-minute boundary, two concurrent
  producers and a failed delivery. `packages/db/test/push-resends.test.ts` covers constraints,
  grants and that the lock makes a second transaction wait.
