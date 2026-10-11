# ADR-0007: Authentication model (passwords, magic links, registration)

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 1, package 1B

## Context

Section 3 story 5 asks for email + password or magic link; section 6 item 11 fixes Argon2id
parameters, SHA-256 storage for magic-link and refresh tokens and a password policy of at least
10 characters with an HIBP k-anonymity check; item 5 limits the auth entry points. The service
must not reveal which addresses have accounts, and an account must not be claimable by someone
who does not control its mailbox.

## Decision

Libraries (resolved in `api/uv.lock`): argon2-cffi 25.1.0, PyJWT 2.15.1 with cryptography
50.0.2, aiosmtplib 5.1.3, httpx 0.28.1, email-validator 2.3.0.

- Passwords: Argon2id `time_cost=3, memory_cost=65536 KiB, parallelism=1`
  (`app/core/settings.py`), NFC-normalized before hashing, `needs_rehash` checked on every
  successful login and the hash replaced. Hashing runs in worker threads with at most 4 at once
  per process (`app/auth/passwords.py`), so it never blocks the event loop.
- Policy: 10 to 128 characters after NFC normalization, not equal to the email or its local
  part, not in the HIBP corpus. The HIBP client sends only the first 5 hex characters of the
  SHA-1 to the fixed host `https://api.pwnedpasswords.com/range/`, with `Add-Padding: true`, no
  redirects, a 2 s timeout. It fails open (an HIBP outage does not block registration) and logs
  `hibp.unavailable` without password data.
- Registration creates no user row. `POST /v1/auth/register` stores the Argon2id hash on a
  `magic_links` row with `purpose = register` (migration `0002`; CHECK constraints allow a
  password hash only on register links and only as `$argon2id$`). The account is created when
  the link is verified **and the verifying client repeats the password chosen at
  registration**; without it the link stays unused and the answer is
  `401 auth.invalid_credentials`. These password checks use the login rule per client IP
  before hashing. A person who opens a registration link they did not start
  therefore cannot activate somebody else's password (account pre-hijacking, review finding
  H1). An address that already has an account receives an "account exists" mail with a sign-in
  link instead; both cases answer `202 {"status": "check_email"}` with identical bodies and
  hash the password in both branches.
- Magic links: 32 random bytes (`secrets.token_urlsafe(32)`), stored as SHA-256 (32 bytes), single
  use (`SELECT ... FOR UPDATE`, `used_at`), 15 minutes. The emailed link carries the token in the
  URL fragment (`#token=`), which browsers never send to a server or in `Referer`. A link for an
  unknown address creates a passwordless account at verification; a deactivated account gets a
  link like any other address (same path and timing) but verification refuses it.
- Login: per-IP and per-normalized-email limits are applied before any database work; unknown
  email, passwordless account, wrong password and deactivated account all answer
  `401 auth.invalid_credentials` with one body, and a missing hash is replaced by a dummy hash
  of the configured cost so the timing matches.
- Account deletion (`DELETE /v1/me`) is re-authenticated: password accounts send the password
  (rate-limited by account through the `auth.login` budget before hashing), passwordless
  accounts need a session or token family created within 10 minutes. It deactivates the
  account, revokes every session and refresh token, deletes favorites and private traces now,
  withdraws pending edits, schedules a `deletion_requests` row 7 days ahead and writes an audit
  row without PII. The hard delete and the grace-period login are phase 2.
- `POST /v1/me/licence-accept` records the acceptance once and promotes `user` to
  `contributor`; moderator and admin roles are never changed.
- Mail goes through the `MailSender` interface: `SmtpMailSender` (Mailpit locally, STARTTLS
  required in production by a settings check) and an in-memory recorder in tests.

## Consequences

- No unverified user rows exist; `users.email_verified_at` is always set for accounts created
  through the API.
- A registrant must use the same client (or remember the password) to finish registration;
  anyone else with the mailbox signs in with a passwordless magic link.
- HIBP availability is not a dependency of registration; a breached password may be accepted
  during an HIBP outage (logged).
- Live mail delivery is not part of this phase (ADR-0005, Resend is class P).

## Evidence

Commands ran in `inecekvar/api` on Windows 11 with Docker Desktop, Testcontainers
`postgis/postgis:16-3.5` and `redis:7.4.11-alpine`. Logs are kept outside the repository in the
owner's local job folder (`jobs/b7093590/tmp/iv`: `p1b-gate.log`, `p1-final-gate.log`,
`p1b-mutation.log`, `p1-final-mutation.log`).

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 1 | Gate after package 1B | `uv run ruff check .`, `ruff format --check .`, `mypy --strict app tests alembic`, `INECEKVAR_REQUIRE_DOCKER=1 uv run pytest` | exit 0, 61 files; 101 passed |
| 2 | Final gate (after review fixes) | same commands | exit 0, 91 files; 330 passed, 0 skipped; `tests/auth` 56 |
| 3 | Hash storage | `tests/auth/test_storage.py::test_db_dump_contains_only_argon2id_and_hashes` | passed: every password hash starts `$argon2id$`, every token hash is 32 bytes, no raw password or token in any column |
| 4 | Parameters and rehash | `test_argon2_production_parameters`, `test_dummy_hash_uses_configured_cost`, `test_login_rehashes_outdated_hash` | passed (`$argon2id$v=19$m=65536,t=3,p=1$`) |
| 5 | Enumeration | `test_register_does_not_reveal_existing_accounts`, `test_login_uniform_error_for_unknown_and_wrong_password`, `test_magic_link_unknown_email_same_response` | passed |
| 6 | Magic links | `test_magic_link_single_use`, `test_magic_link_expires_after_15_minutes`, `test_magic_link_stored_as_sha256` | passed |
| 7 | Pre-hijacking | `tests/auth/test_review_findings.py::test_register_link_requires_the_registrant_password` and `test_registration_verify_password_attempts_are_rate_limited` | passed; mutation M6 (check removed) fails both |
| 8 | Policy and HIBP | `test_register_rejects_weak_passwords` (3 cases), `test_hibp_range_query_uses_prefix_only`, `test_hibp_failure_fails_open`, `test_hibp_never_follows_redirects`, `test_hibp_disabled_makes_no_request` | passed (HIBP through `httpx.MockTransport`) |
| 9 | Deletion | `test_delete_me_requires_reauthentication`, `test_delete_me_deactivates_and_revokes`, `test_recent_passwordless_session_can_delete` (2), `test_delete_me_reauthentication_is_rate_limited` | passed |

Not exercised:

- `not exercised: live HIBP range API` (tests use a mock transport; no network calls in tests).
- `not exercised: SMTP delivery to Mailpit` (`test_smtp_mail_sender_builds_message` patches
  `aiosmtplib.send`; the compose Mailpit was not started for this run).
- `not exercised: timing measurements` (equal work is ensured by construction, not measured).
