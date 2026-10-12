# İnecek Var — Phase 5 Report

## Summary (5 lines max)

API only: `POST /v1/webhooks/revenuecat` (constant-time shared secret, known accounts only, stored once per `event.id`, 200 before the `arq` job applies it) and `POST /v1/webhooks/resend` (Svix signature within five minutes, once per `svix-id`, hashed suppression list).
Plus comes from the `subscriptions` rows (active, cancelled within the period, grace; never expired or refunded), kept current by ordered events and a nightly RevenueCat REST reconciliation that never downgrades on provider errors; packs beyond the first city keep answering `403 pack.entitlement_required`.
Account erasure deletes the RevenueCat subscriber over REST; the mailer consults the suppression list (security versus transactional mail, ADR-0050); four idempotent nightly jobs with a dry-run switch.
Gate: API 877 passed, 0 skipped (709 at phase 4); ruff, format, mypy --strict clean; OpenAPI unchanged; 10 mutations red and restored.
Security matrix after phase 5: 10 done, 10 partial, 3 not-started (item 17 done). Open: one gitleaks history finding on a public test vector (see risks).

## Files created / modified (grouped by owner, full paths)

Paths are under `inecekvar/`.

**api (5A, billing core)**: `api/alembic/versions/0005_webhooks_entitlements.py`; `api/app/billing/entitlements.py`, `api/app/billing/revenuecat.py`, `api/app/billing/subscriptions.py`, `api/app/billing/events.py`, `api/app/billing/reconcile.py`; `api/app/models/{enums,billing,ops,__init__}.py`; `api/app/core/settings.py`, `api/app/core/deps.py`, `api/app/main.py`; tests `api/tests/billing/*` (new), `api/tests/deletion/test_subscriber_rest.py` (new), `api/tests/support/billing.py`, `api/tests/export/test_entitlements.py`, `api/tests/migrations/test_migrations.py`, `api/tests/models/test_metadata.py`.

**api (5B, webhook routes)**: `api/app/webhooks/{__init__,router,signatures}.py`, `api/app/core/jobs.py`, `api/app/auth/suppression.py`, `api/app/core/{body_limit,logging,deps}.py`, `api/app/main.py`, `api/app/workers/main.py`; tests `api/tests/webhooks/{conftest,test_revenuecat_webhook,test_resend_webhook,test_webhook_logs}.py`, `api/tests/security/test_webhook_routes.py`, `api/tests/privacy/test_public_responses.py`, `api/tests/workers/test_main.py`.

**api (5C, mail and jobs)**: `api/app/auth/{mail,suppression}.py`, `api/app/core/deps.py`, `api/app/main.py`, `api/app/workers/{main,nightly}.py`; tests `api/tests/webhooks/test_suppressed_mail.py`, `api/tests/workers/test_nightly.py`.

**lead / security / ops docs (5D)**: `docs/adr/0050-webhooks-and-entitlements.md`, `docs/handoffs/phase-5-report.md`, `docs/security/verification-matrix.md`, `docs/security/authorization-matrix.md`, `docs/security/threat-model.md`, `docs/ops/env.md`, `.env.example`, `README.md`, `README.tr.md`. `docs/api/openapi.json` and `libs/domain` unchanged (webhook routes are outside the public contract).

## Decisions & ADRs added

- ADR-0050 (one ADR for the phase): routes out of the OpenAPI contract; check order and problem codes; app user id equals the account id; store-then-trigger with a 1 s enqueue timeout, a five-minute pending sweep and five attempts; event-to-status mapping (refund = cancellation with `CUSTOMER_SUPPORT`, billing issue = grace, product change informational, sandbox off by default); per-row `last_event_at` ordering; the entitlement rule (cancelled keeps the paid period, new `refunded` status); reconciliation that leaves unmentioned products alone; REST subscriber deletion closing the ADR-0026 open item; Svix scheme implemented without the library; Resend applied in the request with no payload stored; digest under the log hash key; complaint still allows security mail, bounce and manual block all; nightly schedule and retention numbers; no rate limit on the webhook routes.
- Lanes: the writer lanes were out of quota until 2026-10-18, so one session wrote 5A to 5D and ran the gates; no independent review of this phase yet.

## Security checklist status

| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
| - | ---- | ------------------------------------- | ------------------------------ |
| 1 | Remove secrets from source | partial | provider secrets env-only, no example values (`docs/ops/env.md`); gitleaks range finding on a public Svix test vector in history (ADR-0050); pre-commit and CI scan not exercised |
| 2 | Purge secrets from history | not-started | phase 6 |
| 3 | Define authorization rules | done | `test_policy_matrix.py` (ADR-0011) |
| 4 | Enforce authorization on server | done | `test_idor.py`, `test_admin_routes.py`; webhooks: `test_no_human_role_reaches_webhooks` |
| 5 | Rate limit entry points | done | earlier tests; webhook routes deliberately unlimited (ADR-0050 item 16) |
| 6 | Validate input | partial | API tests; webhook payload bounds (`test_revenuecat_rejections`, `test_resend_rejections`) |
| 7 | Constrain uploads | done | `tests/media` (ADR-0023); R2 not exercised |
| 8 | Lock down CORS | done | `tests/core/test_cors.py` |
| 9 | Set security headers | done | `test_api_security_headers`, `headers.spec.ts` (ADR-0042) |
| 10 | Require HTTPS | partial | unchanged from phase 4 |
| 11 | Hash passwords | partial | unchanged from phase 4 |
| 12 | Secure cookies | partial | unchanged from phase 4 |
| 13 | Limit error details | done | problem bodies asserted on every webhook rejection |
| 14 | Sanitize logs | partial | `test_webhook_logs_hold_no_address_secret_or_signature`; Sentry phase 6 |
| 15 | Parameterize queries | partial | SQLAlchemy expressions only; bandit and semgrep phase 6 |
| 16 | Escape against XSS | partial | unchanged; payload sweep phase 6 |
| 17 | Verify webhook signatures | done | `tests/webhooks/*`, `tests/billing/test_reconciliation.py`, 10 mutations (ADR-0050); real providers not exercised |
| 18 | Assign admin roles | done | unchanged from phase 4 |
| 19 | Audit packages | not-started | phase 6 |
| 20 | Automate backups | not-started | phase 6 |
| 21 | Delete accounts | partial | `test_hard_delete_removes_subscriber_through_rest`, `test_provider_error_defers_erasure`; real RevenueCat, web deletion and backup expiry not exercised |
| 22 | Set spending alerts | partial | caps as before; pack download roll-up; cost guard phase 6 |
| 23 | Test as an attacker | partial | webhook forgery and pack entitlement bypass items of the threat model executed (`docs/security/threat-model.md`); attack suite, ZAP, MobSF phase 6 |

## SEO/GEO status (Phase 4+)

No change in phase 5 (API only).

## Tests executed (command + result counts)

- `uv run ruff check .`: All checks passed. `uv run ruff format --check .`: 221 files already formatted.
- `uv run mypy --strict app`: no issues in 105 source files; `uv run mypy --strict app tests alembic`: no issues in 221 source files.
- `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest -q --junitxml=...`: 877 passed in 488.12s; 0 `<skipped` in the JUnit report.
- `uv run python -m app.contract`: `docs/api/openapi.json` unchanged; the workspace type build was therefore not rerun (`not exercised: pnpm nx run-many for domain, data-access, web, mobile`, no contract change and no `node_modules` in this worktree).
- Mutations M1 to M10 (table in ADR-0050): every one red on its named tests, file restored, `git diff --quiet` true.
- CI greps over the changed files under `inecekvar/` (banned words, placeholder markers): no match.
- `gitleaks git --config .gitleaks.toml --log-opts="d8276d08..HEAD"`: 1 finding (see risks); `gitleaks dir` on `api/app`, `api/tests`, `api/alembic`, `docs`: no leaks.

## Known gaps / risks

- Gitleaks history finding: commit `8197119d` contains the Svix documentation example secret in a test (a public vector, not a credential); the tree no longer holds it, but the range scan and the CI full-history scan will report it until the lead allowlists the fingerprint in the root `.gitleaks.toml` or the branch is rewritten before the pull request.
- No real RevenueCat or Resend account: payload shapes follow the providers' documentation; only the Svix example signature is an external vector.
- Worker process and real-time cron firing not run for this phase; `docs/ops/background-jobs.md` (lead) does not list the phase 5 jobs yet.
- Webhook routes have no rate limit (ADR-0050 item 16); an anonymous network's free pack city resets after 90 days of retention.
- No independent review lane ran on phase 5.

## Open questions / proposals (scope, cost, legal)

- RevenueCat setup for the owner: entitlement id `plus`, webhook `Authorization` value and secret REST key in the deployment environment; product ids into `INECEKVAR_REVENUECAT_PLUS_PRODUCT_IDS` if store products are not attached to the entitlement.
- KVKK text: mention that bounced or complaining addresses are kept as keyed digests after account deletion.
- Decide how to clear the gitleaks history finding (allowlist versus rewrite before the pull request).

## Proposed Conventional Commits (not executed)

Already committed locally on `feat/inecekvar-p5` (not pushed): `feat(api): add subscription entitlements, RevenueCat events, reconciliation and REST subscriber deletion`; `feat(api): add RevenueCat and Resend webhooks with provider authentication and idempotent delivery`; `feat(api): honour the suppression list in the mailer and add idempotent nightly jobs with dry run`; `test(api): build the Svix example values from parts`; `docs: record the phase 5 gate, the report, the security matrices and the readme status`.

## Next phase preview (3 lines)

Phase 6: attack suite including the item-16 payload sweep, ZAP, MobSF, bandit and semgrep, dependency audits.
Backups and the restore drill, cost guards (`cost.guard` counting mails and pack downloads), planner degrade trigger.
History-purge runbook (adds the RevenueCat and Resend secrets to the rotation list), ASO and store copy, final 23-item matrix.

STOPPED — waiting for "devam".
