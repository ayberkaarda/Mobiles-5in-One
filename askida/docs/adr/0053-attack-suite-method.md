# ADR-0053: Attack suite method

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 23 asks for a Pest attack suite (`server/tests/Security/AttackSuiteTest.php`)
that attacks the eleven threats of `docs/security/threat-model.md` (register 4.1 to 4.11) plus
spoofed headers, token lifecycle and upload abuse. An attack suite is only useful if a refusal
cannot come from a broken fixture and if the suite cannot shrink or turn green unnoticed. Race
conditions must be attacked with real parallelism, not with sleeps.

## Options

1. One large test file with a section per threat.
2. One file per threat, numbered by the register, with an entry file that only delegates.
3. One file per threat, numbered by the register, with an entry file that checks the suite itself.

## Decision

Option 3.

- Files `server/tests/Security/Attack/ThreatNN<Name>Test.php`, `NN` = register number (01 to 11),
  12 spoofed headers (threat-model section 4.12, Phase 1 row "forged client address and host
  headers"), 13 token lifecycle (items 3 and 4), 14 upload abuse (item 7, register 4.7).
  **Deviation from the Phase 6 plan:** the plan named the files `NN<Name>Test.php`. Pest builds a
  PHP class name from the file name and a class name cannot start with a digit (the run failed with
  a parse error of the built class), so every file carries the `Threat` prefix.
- `AttackSuiteTest.php` is a suite-integrity guard, not a delegator (the harnesses are classes, not
  traits, so `uses()` does not apply): one `describe` per threat checks that the file exists, names
  a register heading that still exists in the threat model, holds at least two tests, asserts a
  refusal, carries a negative control, and contains no sleep call, no empty `catch` and no skip. A
  last test refuses attack files outside the numbered list.
- `Attack/AttackKit.php` asserts status, `application/problem+json`, problem `code` and `status`
  together (`assertProblem`).
- Concurrency: the existing `tests/Security/Concurrency/ConcurrencyHarness.php` gains an `http`
  scenario: each worker process sends one request through its own HTTP kernel (routing, Sanctum,
  form requests, limiters, controllers), all workers wait on a PostgreSQL advisory lock and start
  together. The only pause is the harness polling `pg_locks` until every participant waits.
- Rate limits are attacked at their production values with the limiter state and test-clock
  travel, never with sleeps. Limiters are tested in one process: each worker process has its own
  `array` cache, so the parallel tests prove the database guards (row locks, conditional updates,
  unique indexes, counter rows) and make no claim about a shared limiter store.
- Each attack sits next to its negative control (the legitimate request succeeds) and asserts
  state, not only status codes (rows in `hooks`, `donations`, `payment_events`,
  `payment_mismatches`, `abuse_flags`, `anon_daily_counters`, `personal_access_tokens`, queued jobs,
  mails, bucket objects).
- Production fixes found by the suite stay minimal and are listed with before and after behaviour
  in `docs/security/attack-report.md`. Two were made: the `redeem` and `document-presign` limiter
  keys are now built from the lower-cased shop id (an upper-case UUID opened a new bucket per
  spelling).
- Guards are checked by mutation: a guard is broken on purpose, the matching file must fail, the
  source is restored byte for byte (table in `attack-report.md` section 5).

## Consequences

- Recorded on the delivering branch: `php artisan test --compact tests/Security` 288 passed
  (3 682 assertions), 0 skipped; 12 mutations each turned their file red.
- The entry file checks each threat file as a whole; it cannot enforce a negative control or a
  state assertion per test. Per-test discipline rests on review.
- Known gaps are recorded as partial in `attack-report.md` section 6 (WebView and hostile deep
  links on the device, collusion through a second account, forged Livewire finance actions,
  forged attestation verdicts and the cross-address nonce quota, document leakage through backups
  or error reporting, the reconciliation job, deletion remnants and push abuse). Security item 23
  therefore stays `partial` in the final verification matrix (ADR-0064).
- Follow-up (test quality, not a control gap): the expiry case of
  `tests/Feature/Documents/DocumentUrlSignerTest.php` moves the clock back, so the SDK signs a
  negative `X-Amz-Expires` and MinIO answers 400 `AuthorizationQueryParametersError`; the test
  accepts any 4xx and therefore passes for the wrong reason. The attack suite proves expiry
  correctly (`Threat07`, URL signed six minutes in the past, 403 `AccessDenied`); the feature test
  should assert the same.
- Finding F3 (the account deletion form builds an absolute action URL from the request `Host`) is
  not exploitable as found and is carried in `docs/security/pentest-report.md` with its one-line
  fix.
- not exercised: real attestation verdicts and device farms, a real payment provider, PostgreSQL
  replication or a transaction pooler under the race tests, the production edge proxy and hosted
  object store, iOS.
