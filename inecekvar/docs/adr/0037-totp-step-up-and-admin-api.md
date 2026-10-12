# ADR-0037: TOTP step-up, admin API and public page data

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 4, package 4A (API work the web SSR pages and the admin UI depend on)

## Context

Section 6.18 asks for a TOTP step-up (`pyotp`, valid 15 minutes) before `admin/**` and destructive
moderation (rollback, retirement), audit rows for every moderation and admin action, and no user
management for moderators. Section 6.11 asks for TOTP secrets stored with AES-256-GCM and a key
from the environment. Until this package `Services.step_up` was None in production, so rollback
and retire approval were always denied (ADR-0021, ADR-0029). Section 7 needs public data for the
city hub (line count, popular lines, recently updated), the A to B route pages ("top 200 stop
pairs") and a sitemap index with honest `lastmod`. Phase 4 also needs a stop search for the web.

## Decision

### TOTP and step-up

1. Migration 0004 adds `users.totp_enabled_at` and `users.totp_last_counter` (replay protection,
   check `totp_enabled_at IS NULL OR totp_secret_enc IS NOT NULL`) and a table `session_step_ups`
   (`session_id` primary key, `user_id` with cascade delete, `verified_at`). `session_id` is the
   cookie session id or the bearer refresh family id (`sid`), the same value as
   `Principal.session_id`, so it has no foreign key.
2. Secrets: `pyotp.random_base32(32)`, encrypted with AES-256-GCM (`cryptography`), a 12-byte random
   nonce and the AAD `inecekvar:totp:v2:` + key id + user id, stored as version byte `0x02` + an
   8-byte key id (SHA-256 prefix of the key) + nonce + ciphertext; legacy `0x01` envelopes still
   decrypt. A ciphertext copied to another user does not decrypt. The key is
   `INECEKVAR_TOTP_ENCRYPTION_KEY` (URL-safe base64 of 32 bytes): required in production, created
   per process locally, absent means 503 `auth.totp_unavailable` (fail closed). Rotation:
   `INECEKVAR_TOTP_PREVIOUS_ENCRYPTION_KEY` holds the old key, decryption picks the key by id,
   `python -m app.auth.totp_rotation` re-encrypts every secret under the current key, and
   `totp_enabled_at` and `totp_last_counter` stay unchanged (docs/ops/env.md).
3. Routes: `GET me/totp` (status only), `POST me/totp/enrol` (201, returns the secret and the
   otpauth URI once, `Cache-Control: no-store`; needs a session or bearer family created within
   10 minutes, the same rule as `DELETE me`, else 403 `auth.reauth_required`; 409 when already
   enabled), `POST me/totp/confirm`, `POST auth/step-up` (returns `verified_at`, `expires_at`),
   `DELETE me/totp` (needs a fresh step-up of the current session).
4. Codes: six ASCII digits, one 30-second step either side, compared with `hmac.compare_digest`;
   a matched step at or below `totp_last_counter` is refused, so a code works once. Wrong and
   replayed codes answer the same 403 `auth.totp_invalid_code` (403, not 401, so clients do not
   treat it as a dead session).
5. Rate limit `auth.step_up`: 5 per 15 minutes, checked per user and per client IP before any
   verification; confirmation and step-up share it and successes count.
6. Validity window: 15 minutes (`STEP_UP_TTL`, section 6.18, inclusive, future timestamps denied).
   The production `SessionStepUpSource` reads only the row of the caller's session id and user id:
   a step-up done in another session of the same account never counts. Refresh keeps the family,
   so a step-up survives a bearer refresh within the window.
7. Revocation: logout deletes the session's row; `revoke_user` (logout-all, account deletion)
   deletes all rows of the user; disabling TOTP deletes all rows; an admin demoting a moderator or
   admin deletes the target's rows; refresh-token reuse detection deletes the row of that family. There is no password-change route yet; any future one must
   call `revoke_user`, which also clears step-ups.
8. Policy: the step-up predicate also requires TOTP to be enrolled (`ResourceContext.totp_enrolled`).
   When only `totp_step_up` fails in an otherwise satisfied cell, `authorize` answers 403
   `auth.totp_enrolment_required` (no TOTP: enrol first) or 403 `auth.step_up_required`; other
   denials are unchanged. `step_up_context` and `require_step_up(action)` (`app/security/deps.py`)
   build the stored context; `moderation.service.context_for` builds on it, so rollback and retire
   approval now work in production after a step-up.
9. Audit (`app/security/audit.py`, moved from the moderation service): `totp.enrol`,
   `totp.confirm`, `totp.confirm_failed`, `auth.step_up`, `auth.step_up_failed`, `totp.disable`,
   `admin.user_role`, `admin.export`, `admin.users_read`, `admin.audit_read` (the two reads store
   the actor, the filters and the result count, never user values). Diffs never hold the secret, the URI or a code. The log
   processor drops `secret`, `totp_secret`, `otpauth_uri`, `code`, `totp_code`, `totp_secret_enc`.

### Admin API

10. `GET admin/users` (paged, limit 1..100, optional role filter), `PATCH admin/users/{id}/role`,
    `POST admin/exports/{city}`, `GET admin/audit-logs` (paged; `action` and `target_type` match
    `^[a-z_.]{1,64}$`, UUID filters; `until` defaults to now, `since` to `until` minus 30 days,
    and every window is at most 366 days, so no query scans the whole table; offset paging is
    kept so the contract stays unchanged). Every route depends on
    `require_step_up` with `manage_users` (users, audit log) or `export_admin` (export), so the
    policy table alone decides: non-admins 403 `auth.forbidden`, anonymous 401, admins need TOTP
    and a fresh step-up of the current session. Responses are `no-store`.
11. Role changes and account deletion share one lock order (`app/security/admins.py`): an
    advisory transaction lock, all active admin rows, then the user row. The last active admin
    cannot be demoted or delete the account (409 `admin.last_admin`, also for self-demotion).
    After the locks, in the same transaction as the change, the actor is checked again: still an
    active admin with TOTP (else 403 `auth.forbidden`), the session or bearer family still live
    (else 401), a fresh step-up row of this session (else 403 `auth.step_up_required`). A demoted
    admin therefore cannot promote anyone while the demotion commits. Same role is a no-op
    without audit; deactivated targets answer 409.
12. The administrative export still runs inside the request, bounded: the city row is locked with
    `NOWAIT` (a running export of the same city answers 409 `export.in_progress`), quota
    `admin.export` 10 per hour per admin (429), at most `INECEKVAR_EXPORT_MAX_FEATURES` features
    and `INECEKVAR_EXPORT_MAX_BYTES` encoded bytes (422 `export.too_large`, nothing uploaded).
    The `exports` row and its audit row commit in one transaction. It needs the object store
    (503 otherwise).

### Stop search and public page data

13. `GET stops?city=&q=&limit=`: city required, `q` 1..64 characters, `limit` 1..50 (default 20),
    active stops only. `ILIKE` with a bound pattern in which `\`, `%` and `_` are escaped; prefix
    matches sort first. No `pg_trgm`: the extension is not installed and per-city stop counts are
    small; a trigram index is deferred until search volume needs it.
14. `GET cities/{slug}` now returns `CityDetailOut`: `published_line_count` (unchanged),
    `recently_updated_lines` (10, by current-version `published_at`), `popular_lines` (10, by
    favourites) and `lastmod`. Favourite counts are used only for ordering and never returned
    (a count of 1 would reveal one person's choice). `GET cities` is unchanged.
15. `GET cities/{slug}/stop-pairs?limit=` (1..200, default 200): unordered pairs of active stops on
    the current version of at least one shared published line, ranked by shared line count, then
    summed favourites of those lines, then slugs, in one SQL statement. The top 200 are cached in
    Redis per city and `pack_version` (a publish bumps it) with a TTL; a cold cache is computed
    once (Redis single-flight lock, at most two computations per process, `statement_timeout`,
    503 `public.busy` with `Retry-After` when busy) and the route has an IP quota
    `public.stop_pairs` of 60 per minute. The section 7 rule is "top
    200 stop pairs by search volume"; the service records no searches, so this ranking is a proxy
    and the body says so (`basis: "shared_published_lines"`). The web keeps route pages `noindex`
    below 50 published lines (section 7).
16. `GET sitemap` is the sitemap-index source: cities with at least one published line, `lastmod`
    = newest current-version `published_at` (the same helper as the city detail), `is_sample` and
    the line count. The per-city `GET cities/{slug}/sitemap` already lists line and stop lastmods
    and is unchanged.

### Deviations from the package plan

- Migration 0004 also creates `session_step_ups` (the plan named only the two user columns): the
  step-up has to be stored per session and be deletable at logout.
- The step-up window stays 15 minutes (section 6.18) rather than a shorter value.
- "Revoked on password change" is implemented through `revoke_user`, because no password-change
  route exists.
- Reading the audit log uses `manage_users`; no new policy action was added.

## Evidence

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 1 | Baseline before the package | `uv run pytest -q` (api) | 506 passed |
| 2 | Lint, types | `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy --strict app tests alembic` | all checks passed, 192 files formatted, no issues in 192 files |
| 3 | API tests | `uv run ruff check . && uv run mypy --strict app && uv run pytest -q` (Docker, `INECEKVAR_REQUIRE_DOCKER=1`) | 688 passed |
| 4 | New tests | `tests/totp` 24, `tests/auth/test_totp_helpers.py` 12, `tests/security/test_admin_routes.py` 77, `tests/domain/test_stop_search.py` 23, `tests/domain/test_public_pages.py` 6, IDOR 22 (3 new), policy matrix 151 | included in row 3 |
| 5 | Contract | `INECEKVAR_ENV=local uv run python -m app.contract`, second run compared with `cmp` | 45 paths, 52 operations; identical |
| 6 | Types fresh | `node libs/domain/scripts/build-api-types.mjs --check` | "matches docs/api/openapi.json" |
| 7 | Workspace | `pnpm nx run-many -t lint test build -p domain data-access mobile --skip-nx-cache` | 6 of 7 tasks succeed; `mobile:test` runs 460 of 460 tests green but exits 1 on an unhandled rxjs `EmptyError` from `session-bootstrap.spec.ts`; identical with the previous `api.ts` restored, so it predates this package |
| 8 | Mutation: replay counter ignored | `matching_counter` returns any matched step | 4 tests red, restored |
| 9 | Mutation: step-up not bound to the session | session id predicate removed from `SessionStepUpSource` | 2 tests red, restored |
| 10 | Mutation: secret logged | enrol logs the secret under a key not in the drop list | log-scan test red, restored |
| 11 | Mutation: admin routes without step-up | users and audit-log routes use `require_role(admin)` | 13 tests red, restored |
| 12 | Mutation: `q` interpolated into SQL | `text("stops.name ILIKE '%" + q + "%'")` | 8 tests red, restored |
| 13 | Mutation: last-admin guard off | `len(active_admins) == 0` | 1 test red, restored |
| 14 | Mutation: logout keeps the step-up | `revoke_session_step_up` call removed | 1 test red, restored |

Not exercised:

- `not exercised: the CI run` (branch not pushed).
- `not exercised: a real authenticator app` (codes come from `pyotp` in the tests).
- `not exercised: the admin and moderation UI` (phase 4 web packages).
- `not exercised: export through a queue` (the admin export runs in the request, bounded as in item 12).
- `not exercised: cursor paging of the audit log` (offset paging kept to keep the contract stable).

## Review round

A security review of this package reported eight findings and one side note. Each fix has a test
that fails when the fix is undone (revert check: fix removed, named test red, fix restored, green).
After the round: `uv run ruff check . && uv run mypy --strict app && uv run pytest -q` gives 709
passed; `ruff format --check` and `mypy --strict app tests alembic` are clean (196 files); the
contract written again by `app.contract` is identical to `docs/api/openapi.json`, so the types are unchanged.

| # | Finding | Fix | Test | Revert check |
| - | ------- | --- | ---- | ------------ |
| 1 | High: a demoted admin could re-promote itself while the demotion committed | `revalidate_admin_actor` after the locks, in the mutation transaction (role, session, TOTP, fresh step-up) | `test_demoted_admin_cannot_repromote_self_during_race` | 1 red |
| 2 | Medium: anonymous `stop-pairs` computed on every request | Redis cache per city and pack version, single flight, semaphore, `statement_timeout`, IP quota | `test_stop_pairs_are_cached_until_publish`, `test_stop_pairs_concurrent_cold_cache_computes_once`, `test_stop_pairs_ip_quota`, `test_stop_pairs_timeout_answers_503` | cache 2 red, quota 1 red, timeout 1 red |
| 3 | Medium: admin export unbounded | `NOWAIT` city lock (409), quota (429), feature and byte caps (422) | `test_export_busy_city_answers_409`, `test_export_quota_answers_429`, `test_export_size_cap_answers_422` | 1 red each |
| 4 | Medium: export row and audit row committed separately | audit written by a hook in the export transaction | `test_export_audit_failure_leaves_no_export_row` | 1 red |
| 5 | Medium: key rotation locked users out | v2 envelope with key id, previous key, `app.auth.totp_rotation`, env.md corrected | `test_previous_key_still_decrypts_after_rotation`, `test_rotation_without_previous_key_fails_closed`, `test_reencrypt_moves_secrets_to_current_key`, `test_legacy_v1_blob_decrypts` | 2 red |
| 6 | Medium: sensitive admin reads not audited | `admin.users_read`, `admin.audit_read` with filters and count only | `test_users_read_is_audited_without_pii`, `test_audit_read_is_audited` | 1 red each |
| 7 | Low: unbounded audit-log query | default window 30 days, cap 366 days in every combination | `test_audit_logs_default_window_excludes_old_rows`, `test_audit_logs_since_only_is_range_capped` | 2 red |
| 8 | Low: last admin could delete the account | shared advisory lock and check for role change and deletion | `test_concurrent_admin_self_deletions_keep_one_admin`, `test_last_admin_cannot_delete_account` | 2 red |
| 9 | Side note: refresh reuse kept the step-up | reuse detection deletes the family's step-up row | `test_refresh_reuse_clears_step_up` | 1 red |
