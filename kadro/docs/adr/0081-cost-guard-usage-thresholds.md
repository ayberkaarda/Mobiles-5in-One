# ADR-0081: `cost.guard` usage thresholds and send gates

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §6 item 22, Phase 6; `docs/release/cost-alerts.md` §3; ADR-0002,
  ADR-0028, ADR-0029, ADR-0031; `apps/worker/src/cost/*.ts`, `apps/worker/src/push/handler.ts`

## Context

Spec item 22 asks for a worker job `cost.guard` that counts daily outbound e-mails and pushes and
pauses non-critical sends above configured caps. The design note in `cost-alerts.md` §3 sketches
two new tables (`usage_counters`, `send_gates`), per-type daily push caps and an audited manual
override. The only usage limit in code so far is the global hourly push cap (ADR-0031), counted in
`rate_limit_buckets` under `push:global`.

This record fixes a smaller version that needs no migration and calls no provider API.

## Decision

1. **Job.** Queue `cost.guard` in the job contract (`scheduledJobSchema`, key only), cron
   `*/15 * * * *` in UTC (`COST_GUARD_CRON`), `exclusive` policy with the scheduled key, no retry:
   the next run recomputes everything. Every run derives state from counters, never from the
   previous run.
2. **Counters, all already kept by the senders.**
   - Pushes per UTC day: the sum of the hourly `push:global` windows of that day. Each window is
     incremented atomically with the reservation that precedes a send (ADR-0031), one per device.
   - E-mails per UTC day and per rolling 30 days: `job_receipts` rows of `email.send`. A receipt is
     written for every finished job, including `not_due` and `stale_dropped`, so this is an upper
     bound of real sends. The rolling window equals the receipt retention of the maintenance sweep
     (30 days), so no counted row is swept early. A calendar month is not used because a 31-day
     month would outlive that retention.
   - Not counted: the `deletion_completed` mail sent by `account.hard_delete` itself (one per
     deleted account).
3. **Thresholds.** `EMAIL_DAILY_CAP` (default 2 000), `EMAIL_MONTHLY_CAP` (rolling 30 days, default
   45 000) and `PUSH_DAILY_CAP` (default 50 000), validated by `packages/config`; `0` disables a
   threshold. The defaults are proposals until the owner fixes the budget `B` (cost-alerts §4).
4. **Levels.** At 80 % (`used * 5 >= cap * 4`) a `warn` line and the metric
   `cost_threshold{kind,period,level=warning}`; at 100 % an `error` line, the metric with
   `level=exceeded`, and the gate of that kind closes. Each alert fires once per UTC day, meter and
   level: a marker row `cost:alert:<kind>:<period>:<level>` in `rate_limit_buckets` keyed to the day
   start is inserted with `on conflict do nothing`, and only the inserting run logs.
5. **Gates.** A gate is a `rate_limit_buckets` row `cost:gate:<kind>` whose `window_start` is the
   current UTC day start. It means "paused until the next UTC midnight" and releases itself when
   the day changes; a threshold still exceeded closes it again on the first run of the new day (at
   most 15 minutes later). The maintenance sweep removes old gate and marker rows with the other
   windows after 2 days. No table, column or grant changes: the worker already reads and writes
   `rate_limit_buckets` and reads `job_receipts` (migration 0010).
6. **Classes.** The class belongs to the template (`apps/worker/src/cost/classes.ts`):
   - E-mail: every current kind (verification, password reset, already registered, deletion
     scheduled and completed) is essential. No e-mail is paused today; the e-mail gate is recorded
     and alerted, and becomes effective for the first deferrable mail kind (digest, marketing).
   - Push, essential: `match.updated`, `rsvp.promoted`, `application.decided` (a change to a match
     the user is in, or the outcome of the user's own request).
   - Push, deferrable: both match reminders, `rsvp.changed`, `lineup.slot_free`,
     `application.received`, `team.member_joined`.
     `push.send` reads the push gate only for a deferrable type; a dropped push completes with
     outcome `cost_paused`, a receipt and the metric `cost_capped{kind,type}`. Essential pushes and
     every e-mail never read a gate, so a closed or broken gate cannot block sign-in, verification,
     password reset, deletion or security mail. The hourly push cap of ADR-0031 still applies to all
     types.
7. **Failure mode.** If the counters cannot be read, the run closes both gates for the day
   (deferrable sends pause), logs at `error` and counts `cost_guard_failed{reason=read_usage}`,
   then completes as `failed_closed`. A gate read error inside `push.send` fails that job, which
   retries; nothing is sent in between.

## Consequences

- Abuse or a fan-out bug that drives push volume past the daily threshold stops the deferrable
  share within 15 minutes; the hourly cap remains the hard ceiling for everything.
- The e-mail thresholds are alerts only until a deferrable mail kind exists.
- Usage is tracked per kind, not per push type; per-type caps would need per-type counters.
- Gate state is visible with a read-only query (`docs/ops/worker.md`, Observing). A manual release
  before midnight means deleting today's gate row by hand, which is not audited; an audited admin
  action is a follow-up.
- Tests (`apps/worker/test/cost-guard.test.ts`) use a movable clock and isolated UTC days: counter
  windows, 80 % once per day, 100 % gate until midnight, rolling 30-day e-mail gate, disabled
  thresholds, fail-closed reader, deferrable pushes dropped while essential pushes and
  verification mail still go out.

## Owner tasks (not done here)

- Fix budget `B`, then set the three thresholds per environment.
- Route `cost_threshold` and `cost_guard_failed` log alerts to the owner's e-mail and incident
  channel.
- Provider-side limits that need billing APIs or dashboards stay manual: Resend plan usage alerts,
  Cloudflare R2 storage and operations, Sentry quota and spike protection, RevenueCat tier, VPS
  billing (cost-alerts §1 and §4).

## Alternatives considered

- **New `usage_counters` / `send_gates` tables (design note).** Cleaner names and an exact sent
  count, but a migration for the same behaviour; kept as a follow-up if per-type caps or an
  audited override are needed.
- **In-memory gate in the worker process.** Lost on restart and not shared between worker
  instances; rejected.
- **Polling provider usage APIs.** Needs billing credentials in the worker and network calls in a
  safety job; rejected.
