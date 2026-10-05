# ADR-0061: History purge and rotation plan

- Status: Accepted (procedure; the purge is not executed)
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 2 asks for a runbook with `git filter-repo` targets and a rotation list,
never executed without the owner's approval, and a CI history scan. Rewriting history needs a
force-push, which the repository rules forbid without the owner. Rotating `APP_KEY` would make the
encrypted columns unreadable unless they are re-encrypted, and the old key must not leak while
that happens.

## Decision

- `docs/security/history-purge-runbook.md`: rotation first (a secret that reached a remote is
  compromised whatever happens to history), then a dry run and the rewrite in a fresh mirror clone
  (targets: `askida/server/.env`, `askida/app/env/dev.json`, `*.jks`, `*.p8`, `*.p12`,
  `google-services.json`, `GoogleService-Info.plist`, service-account JSON), the force-push
  consequence stated plainly (every collaborator re-clones), and a closing gitleaks run. Status
  "Not executed: requires the owner's approval".
- Rotation order: `APP_KEY`, database, Redis, object storage keys, backup key and archive password,
  payment provider, mail provider, Apple key, Google service account, `HOOK_CODE_PEPPER` (rotating
  the pepper invalidates every live reservation; stated with its effect).
- `php artisan askida:rotate-app-key {--stdin} {--dry-run}` re-encrypts `shops.tax_number_enc`,
  `shops.iban_enc` and `users.two_factor_secret` in one transaction:
  - the old key is **never** a command-line option (process lists and shell history would keep
    it); it comes from the first entry of Laravel's native `APP_PREVIOUS_KEYS`, or from standard
    input with `--stdin`, which must be a pipe or a file (an interactive terminal is refused);
  - the command refuses to run when the old key equals `APP_KEY`, rejects a malformed old key, and
    aborts without writing anything when a value decrypts under neither key;
  - idempotent: a value that the old key cannot open but the new key can is already rotated;
  - `--dry-run` reports counts only.
- The CI history scan is the full-history `gitleaks` job of `askida-security.yml` (and the one in
  `askida-ci.yml`).

## Consequences

- Tests: `tests/Feature/Ops/RotateAppKeyTest.php` (no option that could carry the key,
  re-encryption from `APP_PREVIOUS_KEYS` and from standard input, idempotence, dry run, refusals);
  recorded on the delivering branch: 10 passed (46 assertions). The terminal refusal is tested
  through an overridable method, not a real terminal.
- `docs/ops/env.md` documents `APP_PREVIOUS_KEYS`.
- Item 2 stays `partial`: the runbook exists and is not executed, by design; the GitHub run of the
  history scan is recorded only after the push.
- not exercised: the purge, the force-push and every provider-side rotation (no production secret
  and no provider account exist).
