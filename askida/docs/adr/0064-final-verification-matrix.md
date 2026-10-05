# ADR-0064: Final verification matrix: method and closing status

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The Definition of Done (specification section 12) asks for "23/23 items done with evidence".
Several proofs need systems this portfolio project does not have (ADR-0006): a payment provider
account, store accounts, an Apple team and macOS, a domain and a host, error-tracking and mail
provider accounts, a production bucket. The matrix was last updated at the end of Phase 2; Phases 3
to 5 added endpoints, the app and the web without a matrix update, and Phase 6 added the attack
suite, the scans, backups and guards.

## Decision

- `docs/security/verification-matrix.md` is rewritten for the moment "End of Phase 6 (final)" on
  `feat/askida-p6` at `9c5dd5d` plus the documentation change. Each row has a status
  (`done | partial | not-started`), the evidence (test path, command, recorded result) and the
  missing proof (`not exercised: <reason>` where an external system is needed).
- A row is `done` only when the specification's **Verify** proof exists and passed in a recorded
  run without depending on an external system. A workflow that has not run on GitHub is never
  evidence. Runs on delivering branches are named as such; the whole-suite run on the final tree is
  recorded separately and, until it exists, the matrix says so in one marked line and makes every
  `done` provisional on it.
- A residual risk that does not belong to the item's Verify proof (for example one PostgreSQL
  instance under the race tests) is written in the Missing column without lowering the status.

## Closing status

**15 done, 8 partial, 0 not-started** (done: 1, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 18, 21).

| Item | Why it stays partial                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 2    | The history purge is documented and never executed without the owner; the CI history scan runs only after the push.                  |
| 10   | No published origin with TLS, edge redirect or HSTS preload (no domain); iOS App Transport Security not exercised (no macOS).        |
| 14   | Error tracking with scrubbing is not connected (no account); production must switch `LOG_STACK` to `daily`.                          |
| 17   | The provider's real signature scheme and sandbox are not exercised (no iyzico account); fixtures prove our own consistency only.     |
| 19   | The audit workflow and Renovate have not run on GitHub (need the push); `npm audit` has no lockfile to read; CocoaPods needs macOS.  |
| 20   | Shop documents are not in the backup archive (owner-side bucket versioning and replication); no production bucket or credentials.    |
| 22   | Provider billing and quota alerts are not set (no accounts).                                                                         |
| 23   | The attack suite's own known gaps, the IPA scan (no macOS), the 60-minute cap on ZAP API run 2 and the GitHub `zap` job not yet run. |

Item 23 differs from the shape planned at the start of Phase 6 (which expected it `done`): its
own report lists gaps that stay partial, and the specification's proof includes an IPA scan that
cannot run here. The planned shape is not forced.

## Consequences

- "23/23 done" is not claimed. The remaining items are owner decisions or need accounts: the push
  (CI and Renovate runs), approval of a history purge if ever needed, a domain and host, provider,
  store and error-tracking accounts, a production backup bucket, a macOS machine.
- Deviations recorded in Phase 6 and where they live: threat file names with the `Threat` prefix
  (ADR-0053); two `{!! !!}` sites instead of one, admin CSP relaxations and push text with shop
  names (ADR-0054); `APP_ENV=local` on the scan stack (ADR-0055); the `s3-backups` listing driver
  and documents outside the archive (ADR-0058); the corrected anonymous-mode privacy wording and
  the server-created `anon_id` (ADR-0063); the in-house page cache and sitemap writer on PHP 8.3
  (Phase 5, ADR-0043, referenced only).
- Follow-ups that change no status: the deletion form's absolute action URL built from the request
  host (pentest finding F3); the document signer expiry test that passes for the wrong reason
  (ADR-0053); the privacy-label rows written before the nginx log change (ADR-0063).
- The matrix keeps its update rules; a later change that adds a proof moves a row in the same
  change.
