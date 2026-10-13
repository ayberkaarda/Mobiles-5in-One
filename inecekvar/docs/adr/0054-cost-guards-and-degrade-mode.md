# ADR-0054: Cost guards, planner degrade mode and log scrubbing

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 6, package 6E (spec items 22 and 14)

## Context

Section 6 item 22 asks for `docs/ops/cost-alerts.md` (hosting budget, database and Redis size,
R2 storage and PMTiles egress, Resend volume, RevenueCat tier, Sentry quota), application caps
(plan rate limit, 3 second timeout, degrade mode with a "yoğunluk" message and single-transfer
results **when the CPU alert fires**, pack download limit per anonymous hash and day, presign
quota) and a worker `cost.guard` that counts daily emails and pack downloads and alerts above
thresholds. Done: doc plus guard tests.

Item 14 asks for structlog processors that drop credentials, hash emails, round coordinates to
three decimals, keep `/auth/*` and `/traces` bodies out, bind the request id, route the uvicorn
access log through the same processors, a documented 30-day retention, no user data in the
production console and a Sentry `beforeSend` scrub on both apps. Done: a login, trace and plan
log sample holds no email, token or precise coordinate.

Before this package the caps existed (ADR-0020, ADR-0023, ADR-0024) and degrade mode was driven
only by a planner timeout or a city beyond the graph capacity. The log processor existed
(ADR-0010) and the 6B scan (ADR-0052) proved the Done line for item 14. Missing: the guard, the
cost document, a degrade switch, error report scrubbing and the retention statement. There is no
host, no provider account and no error reporting SDK (ADR-0005).

## Decision

1. **Count what the application did, from data it already has.** `app/workers/cost_guard.py`
   counts the current UTC day: `emails` (magic links created plus erasures completed, one mail
   each), `pack_downloads` (rows of the day), `presigns` (photo rows created), `exports` (export
   rows created) and `planner_calls` (Redis hour buckets the planner writes). No new table and no
   hook in other modules: the guard reads rows the features already write. The counts are a
   tripwire, not an invoice; the provider consoles stay the source of truth for money.
2. **Thresholds in their own settings class.** `CostGuardSettings` (prefix
   `INECEKVAR_COST_GUARD_`) keeps `app/core/settings.py` untouched, like `BackupVerifySettings`
   (ADR-0053). Defaults are tied to free tiers where one exists (80 mails a day = 80 % of Resend's
   100; 300 presigns a day = 1.2 GiB against 10 GB of R2) and to expected use otherwise. A count
   **at** the threshold alerts.
3. **One alert per resource and day, never a lost one.** The first alert writes
   `inecekvar:cost:alerted:<day>:<resource>` with `SET NX` (48 h); later runs count a repeat. If
   Redis cannot be written the alert is logged again. A database or Redis failure is logged as
   `cost.guard.source_error` with the error class only and the run continues with what it could
   read. Alert lines carry resource, count, threshold and day; nothing else.
4. **The log line is the alert.** No alert mailer: a mail sent by the guard would spend the quota
   it watches, and the host's log collector (not chosen, ADR-0002) is the place to page on
   `level=error`. This is stated in the cost document as owner work.
5. **Degrade on load the application can see, plus a manual switch for the CPU alert.** The
   application cannot read host CPU. The guard uses the computed plan rate as the load signal
   (cache misses of the current UTC hour, default 3,000; amended by decision 10) and writes the Redis flag
   `inecekvar:ops:planner-degrade` (JSON `source`, `reason`, `set_at`, `expires_at`, Redis expiry
   equal to the lifetime) for the cool-down (default 60 minutes), re-arming it while the load
   holds and deleting its own flag a full cool-down after the last re-arm. For a real CPU alert the
   operator (or the host's alert hook) runs `python -m app.ops.planner_degrade on|off|status`,
   which writes one `ops.planner_degrade` audit line; reasons and operator labels are slugs, never
   free text. The guard never overwrites or clears an operator flag.
6. **Degrade inside the planner.** `planner/service.py` reads the flag on every request: active
   means at most one transfer, a 1 second budget, `degraded: true` (the existing response field;
   no contract change) and a 30-minute cache under a separate `...:degraded` key. A flag is
   active only while `expires_at` is in the future, so expiry holds even if the Redis expiry is
   lost; a Redis error or an unreadable value reads as inactive (the timeout and the rate limit
   still bound the cost). Every computed plan (a cache miss) adds one to the hour bucket; that
   write never fails a plan. The mobile app already shows `planner.degradedNote` for `degraded: true` with results and
   the degraded empty state without; no client change was needed.
7. **One scrubber for logs and error reports.** The log processor became a `Scrubber` class used
   by `mask_sensitive` (addresses as keyed digests) and by `scrub_event` (addresses as `[email]`).
   New rules: bearer and basic credentials and JSON Web Tokens in text, `proxy-authorization`,
   more secret key names, coordinate collections (`coordinates`, `points`, `geometry`,
   `polyline`, `trace_points`, `location(s)` holding a list or object) dropped, any pair of floats
   and long decimal pairs in text rounded to three decimals. `scrub_event` also keeps only
   `user.id`, drops request bodies, cookies, query strings and environment, and removes
   `server_name`.
8. **Error reporting is inert until configured.** `init_error_reporting` (called by
   `configure_logging`) returns at once without `INECEKVAR_SENTRY_DSN` and imports nothing; with
   a DSN it imports `sentry_sdk` and passes `before_send=scrub_event`, `send_default_pii=False`;
   without the package it logs `error_reporting.sdk_missing`. No dependency is added. The mobile
   and web apps get the same rules as an unimported helper (`error-scrub.ts`, `scrubEvent`,
   `beforeSendFor(dsn)`) with the wiring point documented in `docs/ops/logging.md`.
9. **Retention is the collector's setting, stated as 30 days.** The application writes JSON to
   stdout and keeps no file; `docs/ops/logging.md` gives the Docker, journald and hosted settings.
10. **Review amendment: the load trigger counts computed plans of the current hour, and a forced
    degrade is an alert.** The independent phase 6 review showed an unauthenticated degrade with
    amplification: every request was counted before the cache lookup and the guard read the
    busier of the current and the previous hour, so two addresses sending cheap cached requests
    for an hour kept every city degraded for about three hours. Now only cache misses are counted
    (`planner/service.py` counts after the cache lookup), the guard reads the current UTC hour
    only (the flag's cool-down is the hysteresis), and the run that switches the flag on logs one
    `cost.guard.alert` line with resource `planner_load` besides `cost.guard.degrade_on`.
    **Attack cost with the defaults:** the plan limit is 30 a minute per address (per /64 for
    IPv6, ADR-0052), at most 1,800 computed plans an hour per address, and each must be a distinct
    cache key (a different origin or destination cell or transfer limit). Reaching 3,000 in one
    UTC hour takes two addresses at the limit for most of an hour; keeping the flag on takes the
    same rate for as long as the attacker wants it. The effect is degraded answers (one transfer,
    1 s budget) for everyone plus an error-level alert, not an outage. The knob is
    `INECEKVAR_COST_GUARD_PLANNER_CALLS_PER_HOUR`: it must exceed the per-address limit times the
    number of attacker addresses the operator wants to absorb (docs/ops/env.md); the automatic
    switch can be turned off (`INECEKVAR_COST_GUARD_DEGRADE_ON_LOAD=false`) and the alert stays.
    The default stays at 3,000 because it is also the CPU line of a single small host. Tests:
    `test_only_the_current_hour_counts_for_the_load`, `test_forced_degrade_is_an_alert_line`,
    `test_one_hour_of_load_ends_after_one_cool_down`,
    `test_planner_counts_only_computed_plans_in_the_hour_bucket`.

## Evidence

Workstation (Windows 11, Docker Desktop, uv, Python 3.12), 2026-10-13.

- API gate `uv run ruff check . && uv run mypy --strict app tests && uv run pytest -q`, exit 0
  (1057 before this package, 64 new):

  ```
  All checks passed!
  Success: no issues found in 229 source files
  1121 passed in 648.99s (0:10:48)
  ```

- New and extended tests (all passed): `tests/workers/test_cost_guard.py` (threshold below, at
  and above; every resource has a threshold; idempotent per day and again the next day; dry run
  writes nothing; settings dry run wins; load sets the flag, re-arms it and clears it after the
  cool-down on a fake clock; operator flag left alone; automatic degrade can be switched off;
  previous hour counts (replaced by decision 10: only the current hour counts); Redis failure and database failure do not crash and leak no URL or
  credential; settings from the environment; cron registration; database counts of today only
  and the worker job against PostgreSQL), `tests/planner/test_degrade.py` (flag forces one
  transfer, a budget of at most 1 s and a cache lifetime above the default; a stricter request is
  kept; expiry on a fake clock restores normal planning with two transfers; every call counted
  (since decision 10: every computed plan);
  `degraded` is a required boolean of the response schema; round trip, unreadable values, Redis
  errors), `tests/planner/test_ops_command.py` (on, status, off with audit lines; lifetime equals
  minutes; bad minutes, free-text reasons and addresses as operator refused),
  `tests/core/test_log_scrub.py` (every new rule, the production stream, a fake Sentry event,
  no import without a DSN, the hook installed with a fake SDK, a missing SDK) and the 6B combined
  scan, extended with a degraded plan, a `cost.guard` run and a probe line.
- Mutations, each red and then restored (table):

  | # | Mutation | Tests run | Result |
  | --- | --- | --- | --- |
  | M1 | guard alerts above instead of at the threshold (`>=` to `>`) | `tests/workers/test_cost_guard.py` | 7 failed, 15 passed |
  | M2 | planner ignores the flag (`forced = False`) | `tests/planner/test_degrade.py` | 3 failed, 6 passed |
  | M3 | log scrub processor returns the event unchanged | `tests/core/test_log_scrub.py`, the combined scan | 15 failed, 11 passed |
  | M3b | `scrub_event` returns the event unchanged | `tests/core/test_log_scrub.py` | 1 failed, 23 passed |
  | M4 | guard never clears its flag | `tests/workers/test_cost_guard.py` | 1 failed, 21 passed |
  | M5 | flag expiry ignored (`active` always true) | `tests/planner/test_degrade.py` | 2 failed, 7 passed |
  | M6 | mobile `scrubEvent` returns a shallow copy | `nx run mobile:test` | 2 failed, 469 passed |

  Every source was restored from its copy and the targeted tests ran green again (93 passed).

- Apps: `pnpm nx run-many -t lint test build -p web mobile --skip-nx-cache`, exit 0: web 46
  files and 785 tests passed, mobile 26 files and 471 tests passed, both builds ran. A first run
  reported one unhandled `EmptyError` from `apps/mobile/src/app/core/session-bootstrap.spec.ts`
  (a file this package does not touch) with all tests passed; three later runs were clean.
- Mobile degraded note: already wired (`planner.store.ts` reads `degraded`, `plan.page.html`
  shows `planner.degradedNote`) and covered by `plan-favorites.spec.ts` "flags degraded results
  above the cards" and `planner.spec.ts`; no new client test was needed.

## Consequences

- The cost document separates what the code enforces from what the owner must set in each
  console; every console line is `not exercised: no provider account`.
- A busy hour degrades planning for at least an hour; the threshold and cool-down are environment
  values and the automatic switch can be turned off.
- Error reports need an SDK, a DSN and a project before they exist; the scrubbers are tested on
  fake events only.

## Not exercised

- Provider budgets and alerts: hosting budget, host CPU, disk and database size, Redis memory, R2
  storage and operations, PMTiles cache rule and egress, Resend volume, RevenueCat tier, Sentry
  quota. No accounts exist.
- A CPU alert firing the degrade switch: no host; the request-rate proxy and the manual command
  stand in.
- A real Sentry SDK (Python, Angular, Capacitor) receiving a scrubbed event.
- Log retention on a collector and a log-based page on `cost.guard.alert`: no host.
