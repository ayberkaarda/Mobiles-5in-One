# Handoff matches → worker 001

- From: match endpoints and `apps/web/lib/server/jobs/notify.ts` (Phase 2)
- To: owner of `apps/worker` (`src/reminders/plan.ts`)
- Status: resolved (worker keys use epoch milliseconds; `apps/worker/test/reminders.test.ts` covers a same-second reschedule)

## Reminder keys use the start time in milliseconds

The reminder handler skips a job whose `startsAt` differs from the match's start, compared to the
millisecond (`skipped_rescheduled`). The web key was `reminder:<matchId>:<24h|2h>:<epochSeconds>`,
so a reschedule within the same second produced the same key: pg-boss dropped the replacement
while the old job was still queued, the worker then skipped the old one, and the reminder was lost.

`reminderIdempotencyKey` in `apps/web/lib/server/jobs/notify.ts` now uses
`startsAt.getTime()` (epoch milliseconds). `planMatchReminders` / `reminderKey` in
`apps/worker/src/reminders/plan.ts` still use seconds. The worker does not enqueue reminders in
production paths, so nothing breaks, but the documented rule should be one.

Request: switch the worker's key to epoch milliseconds (and the ADR-0028 example
`reminder:<matchId>:24h:<startsAtEpoch>` to say milliseconds, docs owner).

Acceptance: worker reminder tests use the millisecond key; web `tests/matches/review.test.ts`
("reminders follow a reschedule to the millisecond") stays green.
