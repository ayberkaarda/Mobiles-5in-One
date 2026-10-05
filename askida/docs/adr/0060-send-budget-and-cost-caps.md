# ADR-0060: Send budget and cost caps

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 22 asks for `docs/ops/cost-alerts.md`, application caps, a `cost.guard`
job that counts daily e-mails and pushes and pauses non-critical sends above caps, and the fraud
budget (automatic payout hold, built in Phase 3). Provider billing alerts need accounts that do
not exist.

## Options

1. Count sends in a `send_counters` table.
2. Count sends in Redis day keys.

## Decision

Option 2: counters change on every send and are worthless after two days; a table would add a
write per mail to the database for no audit value.

- `App\Domain\Cost\SendBudget`: Redis keys `cost:sent:{channel}:{day}`, `INCR` with a two-day
  TTL, the day on the `Europe/Istanbul` clock; pause flag and alert claim per channel and day.
  Counters hold numbers only.
- Caps: `COST_DAILY_EMAIL_CAP` (default 2 000) and `COST_DAILY_PUSH_CAP` (default 20 000),
  `config/askida.php` `cost.*`.
- The check is live: `SendBudget::allows(SendKind)` refuses a non-critical send as soon as the
  counter reaches the cap. The job `App\Domain\Cost\Jobs\GuardDailySends` (`cost.guard`, every 15
  minutes, without overlapping, on one server) sets the pause flag and sends finance one alert mail
  per channel and day at `FINANCE_ALERT_EMAIL` (claimed with an atomic add, so a second run the same
  day sends nothing).
- Classification: non-critical = the "Yeni askı" push to shop members and the "Askın alındı" push
  to the donor. Critical, never paused: verification and reset codes, receipts and refund notices,
  deletion confirmation, finance and fraud alerts. A mailable is critical unless it implements
  `App\Domain\Cost\Contracts\NonCriticalMail` (none does today). A `MessageSending` listener counts
  every mail and cancels only a non-critical one; `SendPush` asks the budget before each device
  delivery and counts each delivery.
- `docs/ops/cost-alerts.md` lists the cost drivers with sample planning figures, a sample fee model
  and every application cap with the test that proves it.

## Consequences

- Tests: `tests/Feature/Cost/SendBudgetTest.php` (cap reached, non-critical push and mail dropped,
  critical mail still sent, one alert per day and channel, reset on the next Istanbul day, schedule
  every 15 minutes). Recorded on the delivering branch, `tests/Feature/Cost`, `tests/Feature/Ops`
  and `PushTest.php` together: 32 passed (144 assertions); the schedule test was added when the
  schedule line merged and runs in the final whole-suite run (ADR-0064).
- Today the mail cap protects nothing that can be paused (every mail is critical); it still counts
  and alerts, and it becomes a real pause once a non-critical mail exists.
- The push fan-out cap per hour (ADR-0021) stays in place below the daily budget.
- not exercised: provider dashboard alerts (no accounts), real mail delivery of the finance alert
  (array mailer in tests), real push delivery.
