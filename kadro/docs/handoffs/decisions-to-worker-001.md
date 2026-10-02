# Handoff decisions → worker 001

- From: Phase 2 decisions (`docs/adr/0028` … `0033`, `0037`)
- To: owner of `apps/worker`
- Status: open

Implements the queues of ADR-0028; operator view in `docs/ops/worker.md`.

1. **Bootstrap.** On start: pg-boss migrations, create every queue with its options and
   `<queue>.dead` dead-letter queue (ADR-0028 table), register schedules (`opencall.expire`
   `5 * * * *`, `maintenance.sweep` `35 * * * *`, time zone `Europe/Istanbul`), then `work()` with
   the per-queue concurrency. Validate each payload with the `packages/contracts` schema before the
   handler; an invalid payload fails without retry.
2. **Idempotency.** `job_receipts` insert in the effect transaction; state re-check first.
3. **`email.send`** (ADR-0029): token issued in the worker, hash only in the database, at most 3 live
   tokens per purpose, definite provider failure deletes the attempt's token, stale jobs dropped.
   Templates and transport from `@kadro/emails` (moved from `apps/web/emails`).
4. **`push.send`, `push.receipts`, `match.reminder`** (ADR-0031): fixed templates, recipients and
   access resolved at send time, hourly cap through `rate_limit_buckets` key `push:global`,
   `DeviceNotRegistered` pruning on tickets and receipts, coalescing keys.
5. **`upload.process`** (ADR-0030): `HEAD` size check, magic bytes, `sharp` limits
   (`limitInputPixels` 25 000 000, first frame, `failOn: 'error'`, one thread, 20 s), WebP 1024 px
   q80, re-check permission (else `not_allowed`), publish to the media bucket, apply to
   `users.avatar_key` or `teams.badge_key` in one transaction with `ready`, delete the incoming
   object always.
6. **`account.hard_delete`** (ADR-0032, ADR-0033): preconditions, external cleanup, single database
   transaction, tombstone re-pointing, confirmation email before commit without blocking it, audit
   row without personal data.
7. **`opencall.expire`** (ADR-0037) and **`maintenance.sweep`** (ADR-0028 list in
   `docs/ops/worker.md`).
8. **Metrics** named in `docs/ops/worker.md`.

Acceptance: per-queue tests for invalid payload → dead letter, run-twice idempotency, the stale
path, and the specific cases named in threat model §5.6, §5.7, §5.10 and §5.13; worker jobs
demonstrated locally with `EMAIL_TRANSPORT=log` and `PUSH_TRANSPORT=log` (Phase 2 gate).
