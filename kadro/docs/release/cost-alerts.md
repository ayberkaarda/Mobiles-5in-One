# Cost guardrails and alerts

|         |                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item    | Security checklist item 22 (product spec §6)                                                                                                                    |
| Hosting | [ADR-0002](../adr/0002-hosting.md): one VPS (production), one smaller VPS (preview), self-hosted Postgres, Cloudflare R2, Resend, Expo push, RevenueCat, Sentry |
| Status  | Thresholds below are **proposals**. Every dashboard setting is an **owner task**: nothing has been configured.                                                  |

Fixed hosting cost makes the VPS itself predictable; the variable risks are object storage
operations, transactional e-mail volume, push fan-out and error-tracking quota. The owner confirms
the monthly ceiling named in ADR-0002 "Open points"; the table uses `B` for that budget so the
numbers can be fixed once `B` is known.

## 1. Service guardrails

| Service                | What can grow                                     | Alert threshold (proposal)                                      | Hard limit (proposal)                                              | Where to set it (owner task)                      |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| VPS provider           | Fixed plan; bandwidth overage, snapshots          | Billing alert at 80 % of `B`; traffic at 80 % of the plan quota | No auto-scaling; no paid add-ons                                   | Provider billing page                             |
| Disk (Postgres, logs)  | Database, pg-boss archive, Docker logs            | Host disk above 70 % warn, 85 % page                            | `local` log driver rotation (30 days), pg-boss archive retention   | Host monitoring / uptime check                    |
| Postgres               | Connections, table bloat                          | Connections above 80 % of `max_connections`                     | Pool sizes fixed in the application configuration                  | Host monitoring                                   |
| Cloudflare R2          | Storage (uploads and `kadro-backups`), operations | Storage above 5 GB warn; operations above the free tier warn    | Backups lifecycle 30 days; upload size and count limits in the API | Cloudflare dashboard, notifications and billing   |
| Resend                 | Monthly e-mail volume                             | 70 % of the plan's monthly sends                                | `cost.guard` pauses non-critical mail (section 3)                  | Resend dashboard usage alerts                     |
| Expo push              | Pushes per hour and per day                       | 60 % of the daily cap                                           | `PUSH_HOURLY_CAP` (default 5 000/h, ADR-0031) and daily caps       | Application configuration                         |
| RevenueCat             | Tracked revenue tier                              | 80 % of the free tier's monthly tracked revenue                 | None (pricing tier, not a cap)                                     | RevenueCat dashboard notifications                |
| Sentry                 | Error and transaction quota                       | 70 % of the monthly quota                                       | Spike protection on, per-key rate limit                            | Sentry subscription and spike protection settings |
| Domains, Apple, Google | Annual fees                                       | Calendar reminder 30 days before renewal                        | n/a                                                                | Owner calendar                                    |

Notification target for every alert: the owner's e-mail plus the incident channel. One named person
is responsible for reading them.

## 2. Application kill-switches

Spec item 22 defines these. Status in code: the push hourly cap exists (ADR-0031, counted as
`push_capped{type}`); `cost.guard` exists with the scope of ADR-0081 (daily push threshold, daily
and rolling 30-day e-mail thresholds, deferrable pushes paused); the presign cap exists as rate-limit group U (rolling 24 h) plus a daily quota layer in `apps/web/lib/server/uploads/uploads.ts`.

| Switch                | Limit                              | Behaviour above the limit                              |
| --------------------- | ---------------------------------- | ------------------------------------------------------ |
| Push fan-out          | 5 000 sends/hour (existing)        | Job completes without sending, logged and counted      |
| Upload presign        | 10 per user per day                | `429` with the standard error contract                 |
| Open-call push radius | Cap on the radius used for fan-out | Radius clamped; no broadcast feature exists yet (0031) |
| E-mail daily cap      | `cost.guard` (section 3)           | Non-critical mail paused; critical mail still sent     |

## 3. Design note: `cost.guard`

Implemented in Phase 6 with a narrower scope; ADR-0081 records what was built, what differs from
this note (no new tables, one global push threshold instead of per-type caps, no audited override
yet) and what stays an owner task.

Purpose: replace the single hourly push counter with daily per-type caps and add an e-mail cap, so a
bug or abuse burst cannot turn into a bill, without ever blocking security-critical messages.

**Job.** pg-boss queue `cost.guard`, scheduled every 15 minutes by the worker; a singleton key
prevents overlap. Idempotent: it recomputes state from counters, never from the previous run.

**Inputs.** Counters kept by the senders: per-day counts of outbound e-mails by template and of push
sends by type (a small table such as `usage_counters(day, kind, type, count)` incremented in the same
transaction that records the send). Caps come from validated environment variables (for example
`EMAIL_DAILY_CAP`, `PUSH_DAILY_CAP_<TYPE>`) with documented defaults; `0` means unlimited.

**Output.** One row per kind in a `send_gates(kind, paused_until, reason)` table. Senders read the
gate before sending: if `paused_until > now()` and the message class is non-critical, the job
completes without sending and counts `cost_capped{kind,type}`.

**Classes.** Critical (never paused): sign-in and e-mail verification, password reset, account
deletion confirmation, security notices, billing webhook processing. Non-critical (pausable):
reminders, digests, social notifications, marketing. The class is a property of the template or push
type in code, not of the cap.

**Thresholds.** At 80 % of a daily cap: warning log plus an alert to the owner. At 100 %: set
`paused_until` to the next UTC midnight and alert again. A manual override (`paused_until = NULL`) is
an audited admin action.

**Failure modes.** If the guard cannot read counters, critical mail still goes out and non-critical
sends pause, with an error-level log, so a broken guard cannot silently permit unbounded sending.

**Tests to write with the implementation.** Counter increments are atomic with the send record; the
gate pauses at 100 % and releases at midnight; critical classes are never blocked; non-critical sends
pause on read errors; the 80 % alert fires once per day.

**Out of scope here.** No code, migration or configuration is part of this document.

## 4. Owner checklist

| #   | Task                                                                 | Status                                                                      |
| --- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Confirm monthly ceiling `B` and fill concrete numbers into section 1 | owner task                                                                  |
| 2   | Create billing alerts at the VPS provider and Cloudflare             | owner task                                                                  |
| 3   | Enable usage alerts in Resend, RevenueCat and Sentry                 | owner task                                                                  |
| 4   | Set up host disk and connection monitoring                           | owner task                                                                  |
| 5   | Name the person who receives and acts on alerts                      | owner task                                                                  |
| 6   | Implement `cost.guard` and the e-mail and presign caps per section 3 | done: `cost.guard` (ADR-0081); presign cap in place (group U + daily quota) |
