# ADR-0050: Webhooks, entitlements and nightly jobs (phase 5 gate)

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 5, packages 5A (billing core), 5B (webhook routes), 5C (suppression-aware mail and
  nightly jobs), 5D (documents and gate)

## Context

Section 10 closes phase 5 with "webhook and entitlement tests green". Section 6 item 17 asks for
`POST /v1/webhooks/revenuecat` (raw body, `Authorization` compared with `hmac.compare_digest`,
unknown `app_user_id` rejected, idempotent by `event.id`, 200 within 2 s then an `arq` job,
nightly reconciliation through RevenueCat REST) and `POST /v1/webhooks/resend` (Svix signature
with a five-minute tolerance, idempotent by `svix-id`, `email_suppressions` updated). Section 3
story 8 enforces Plus on the server for pack downloads beyond the first city (ADR-0024); section
6.21 deletes the RevenueCat subscriber at account erasure, left open by ADR-0026. No RevenueCat or
Resend account exists, so every provider interaction runs against doubles; ADR-0005 governs
evidence.

## Decision

1. **Webhook routes are provider-to-server and stay out of the public contract.** Both routes
   are mounted under `/v1/webhooks` with `include_in_schema=False`; `docs/api/openapi.json` and
   `libs/domain` do not change. They deny every human role (authorization matrix) and are
   classified in the route harness as credential-protected.
2. **Order of checks.** RevenueCat: secret configured (else 503 `webhook.not_configured`) →
   `Authorization` equal to `INECEKVAR_REVENUECAT_WEBHOOK_SECRET` byte for byte through
   `hmac.compare_digest` (401 `webhook.unauthorized`; a `Bearer ` prefix is not stripped) →
   `Content-Type: application/json` (415) → payload (400 `webhook.payload_invalid`) → known account
   (422 `webhook.unknown_subscriber`) → store → enqueue. Resend: secret configured → Svix
   headers, timestamp within ±300 s of the server clock (401 `webhook.timestamp_invalid`) and a
   `v1` signature over the raw body (401 `webhook.signature_invalid`) → JSON (415) → payload
   (400). The body limit middleware caps both routes at `INECEKVAR_MAX_WEBHOOK_BODY_BYTES`
   (64 KiB, 413) before routing; the content-type exemption for `/v1/webhooks/` from phase 1
   stays, the routes check it themselves after authentication.
3. **App user id = account id.** The app identifies purchases with the API account id
   (`apps/mobile/src/app/plus/plus.store.ts` calls `identify(user.id)`). An event must name an
   existing account (`users.id`); RevenueCat anonymous ids and aliases are not accounts. A
   `TRANSFER` needs one known id among `transferred_from` and `transferred_to`. A `TEST` event
   (dashboard button) needs none and changes nothing. A 422 makes RevenueCat retry and show the
   failure in its dashboard, which is wanted: an unknown id is a configuration fault.
4. **Store first, then trigger.** The route inserts one `webhook_events` row
   (`INSERT ... ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`) holding only the
   fields the job reads (the parsed model, not the raw provider document: prices, store ids and
   unknown fields are dropped), commits, and enqueues `revenuecat_event_job` with the arq job id
   `rc:<row id>`. The enqueue has a 1 s timeout and its failure is logged, not returned: the
   response never waits for Redis (`test_answer_within_two_seconds_even_when_the_queue_hangs`).
   A duplicate id answers 200 `duplicate` without a second enqueue. The worker's pending sweep
   (every five minutes, rows older than one minute) processes events whose enqueue was lost; a
   processing failure counts an attempt, the fifth closes the event as `failed`, and the nightly
   reconciliation repairs the subscription from the REST view. The job locks its row with
   `FOR UPDATE SKIP LOCKED` and clears the payload when done, so concurrent workers apply an
   event once.
5. **Event mapping** (`app/billing/events.py`). Plus products are those whose event names the
   entitlement `INECEKVAR_REVENUECAT_PLUS_ENTITLEMENT` (`plus`, the id the app uses) or whose
   product id is in `INECEKVAR_REVENUECAT_PLUS_PRODUCT_IDS`. `INITIAL_PURCHASE`, `RENEWAL`,
   `UNCANCELLATION`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_EXTENDED`,
   `TEMPORARY_ENTITLEMENT_GRANT`, `REFUND_REVERSED` → `active` until `expiration_at_ms`;
   `CANCELLATION` → `cancelled`, or `refunded` when `cancel_reason` is `CUSTOMER_SUPPORT`;
   `SUBSCRIPTION_PAUSED` → `cancelled`; `BILLING_ISSUE` → `grace` until
   `grace_period_expiration_at_ms` (or the expiration when the store grants no grace);
   `EXPIRATION` → `expired`; `TRANSFER` expires the source accounts' rows and loads the target
   accounts from REST; `PRODUCT_CHANGE` and every other type are recorded as `ignored` (the store
   follows a product change with a purchase or renewal of the new product). Sandbox events are
   ignored unless `INECEKVAR_REVENUECAT_ALLOW_SANDBOX` is true.
6. **Ordering.** Each subscription row keeps `last_event_at` (the provider event time or the
   snapshot time of the last reconciliation). An event older than that is `stale` and changes
   nothing; equal times apply. Rows are created with `INSERT ... ON CONFLICT DO NOTHING` and then
   locked, so two jobs cannot both insert.
7. **Entitlement rule** (`SubscriptionEntitlements.has_plus`, `entitles`). Plus while a row is
   `active`, `cancelled` (auto-renew off, the paid period still runs) or `grace` and its
   `expires_at` lies in the future, or `active` without `expires_at` (non-renewing purchase).
   `expired` and `refunded` never entitle. This changes the phase 2 rule, where `cancelled`
   never entitled; migration `0005` adds `refunded`, `last_event_at`, the webhook processing
   columns and `pack_download_stats`. The pack route keeps `403 pack.entitlement_required`; the
   app maps exactly that code (and any 402) to the paywall (`apps/mobile/src/app/packs/pack-manager.ts`),
   so no 402 is introduced and the contract is unchanged.
8. **Reconciliation** (`app/billing/reconcile.py`, nightly 04:10). Every stored subscriber is
   fetched once from `GET https://api.revenuecat.com/v1/subscribers/{id}` (host fixed in code,
   no redirects, `INECEKVAR_REVENUECAT_API_KEY` as bearer, `INECEKVAR_REVENUECAT_TIMEOUT_SECONDS`).
   Any transport error, non-200 status or unusable body changes nothing for that subscriber.
   A usable answer updates the Plus products it names and inserts the missing ones; a stored
   product the answer does not mention is left to expire by its own date, so a wrong key or
   project (which answers with empty subscribers) cannot wipe entitlements. Without a key the job
   is skipped and logs that.
9. **Subscriber deletion.** The same REST client is `Services.subscriber_deleter` when the key is
   set: `DELETE /v1/subscribers/{id}`, where 404 counts as already gone and any other failure
   defers the erasure (unchanged ADR-0026 behaviour). This closes the ADR-0026 open item against
   a transport double.
10. **Svix verification without the Svix library.** Implemented from the published scheme
    (`app/webhooks/signatures.py`): HMAC-SHA256 under the base64 key after `whsec_`, signed
    content `svix-id.svix-timestamp.body`, any of several space-separated `v1,` signatures
    (secret rotation), constant-time comparison. It reproduces the example signature of the
    Svix documentation (`test_published_svix_vector`). The tolerance is fixed at five minutes by
    the specification, not a setting.
11. **Resend events apply in the request.** One upsert per recipient digest is cheaper than a
    queue round trip; the `webhook_events` row (provider `resend`, `svix-id`) stores no payload,
    so no address is kept anywhere. `email.bounced` suppresses unless `data.bounce.type` is
    `Transient`; `email.complained` suppresses; every other type is `ignored`. Reason strength
    is manual > complaint > bounce; a weaker reason never replaces a stronger one.
12. **Suppression digest.** `email_hash = HMAC-SHA256(INECEKVAR_LOG_HASH_KEY,
    "email-suppression:" + normalized address)`, 32 bytes. Rotating the log hash key therefore
    empties the effective list; the rotation note is in `docs/ops/env.md`.
13. **Security and transactional mail.** `OutgoingMail.category` is `security` for the
    magic-link and account-exists mails (asked for by the recipient a moment ago) and
    `transactional` for everything else (the deletion confirmation today). The production
    sender (`SuppressionAwareMailSender` around SMTP) sends nothing to a `bounce` or `manual`
    address (it cannot or must not receive mail) and, after a `complaint`, still sends `security`
    mail so a passwordless account is not locked out; the request rate limits (5 per 15 minutes
    per IP and per address) bound how often that can be triggered. The caller always sees the
    same result, so suppression is no address oracle.
14. **Nightly jobs** (`app/workers/nightly.py`, Europe/Istanbul): reconciliation 04:10, expired
    entitlement sweep 04:40 (bookkeeping, `has_plus` already denies by date), retention purge
    04:50 (processed `webhook_events` after 30 days, bounce suppressions after 365 days,
    complaints and manual entries kept), pack download roll-up 05:00 (rows older than 90 days
    counted once per city and day into `pack_download_stats`, then deleted, except the earliest
    row of each account, which keeps its free first city; anonymous network rows are deleted
    completely, so an anonymous network's free city resets after 90 days, an accepted extension of
    the ADR-0024 consequence). Every job is idempotent and honours `dry_run`
    (`INECEKVAR_JOBS_DRY_RUN`, or the job argument, which wins).
15. **Logs and counters.** Webhook and job logs carry provider, event type, outcome, counts and
    keyed digests of app user ids; never an address, secret, signature or body. `signature`,
    `svix_signature` and `api_key` joined the dropped log keys. The project has no metrics
    library; counters are fields of these log events (section 8: "metrics logged").
16. **No rate limit on the webhook routes.** The provider credential is checked first in
    constant time and the body limit bounds the work per request; provider retries and bursts
    after an outage must not be refused. Recorded as a known gap for the phase 6 cost review.

## Consequences

- Plus depends on the webhook secret, the REST key and the product mapping being configured
  together; any of them missing fails closed (no Plus, 503 webhooks, deferred erasure).
- `cancelled` subscriptions now keep Plus until their period ends, matching the store's own
  behaviour; a refund removes it immediately.
- The suppression list survives account deletion as digests (no address); it is not personal
  data in readable form but is linkable by whoever holds the log hash key.
- `docs/ops/background-jobs.md` (lead) does not list the phase 5 jobs yet; `docs/ops/env.md`
  and this ADR carry the schedule.

## Evidence

Commands in `inecekvar/api` (Windows host, Docker 29.7.2, Testcontainers PostGIS 16-3.5, Redis
7.4.11 and MinIO): `uv run ruff check .` (All checks passed), `uv run ruff format --check .`
(221 files already formatted), `uv run mypy --strict app` (no issues in 105 source files),
`uv run mypy --strict app tests alembic` (no issues in 221 source files),
`INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest -q --junitxml=...`: **877 passed in
488.12s, 0 skipped** in the JUnit report (phase 4 gate: 709). `uv run python -m app.contract`
leaves `docs/api/openapi.json` unchanged (`git diff --exit-code` clean), so `libs/domain` is not
rebuilt.

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | RevenueCat rejections: secret not configured, missing, wrong, `Bearer`-prefixed, truncated and extended secret, wrong and form content type, oversized body, malformed JSON, missing event and event id, unknown, anonymous and missing app user id | `tests/webhooks/test_revenuecat_webhook.py::test_revenuecat_rejections` (15 cases: status, code, problem members, nothing stored, nothing enqueued) | passed |
| 2 | Replay across providers | `test_resend_signature_does_not_authenticate_revenuecat`, `test_resend_webhook.py::test_resend_rejections[revenuecat-secret]`, `test_same_id_in_both_providers_is_not_a_replay` | passed |
| 3 | Stored minimized, enqueued once, applied only by the job | `test_accepted_event_is_stored_enqueued_and_processed_by_the_job` | passed |
| 4 | Replayed id, also with a changed body | `test_replayed_event_id_has_one_effect` | passed |
| 5 | Concurrent delivery (`asyncio.gather`, 8 requests; then 4 concurrent jobs) | `test_concurrent_delivery_of_one_event_has_one_effect` (1 accepted, 7 duplicate, 1 row, 1 job, 1 applied), `tests/billing/test_events.py::test_processing_is_idempotent_per_stored_event` | passed |
| 6 | 200 within 2 s with a hanging queue; lost enqueue processed by the sweep | `test_answer_within_two_seconds_even_when_the_queue_hangs`, `test_broken_queue_still_answers_and_the_sweep_processes` | passed |
| 7 | Constant-time comparison is used | `test_secret_comparison_is_constant_time`, `test_signature_comparison_is_constant_time` (spies on `hmac.compare_digest`) | passed |
| 8 | Resend rejections: missing headers, wrong key, tampered body, stale and future timestamp (301 s), non-numeric timestamp, signature for another id, unknown version, empty signature, wrong content type, oversized, malformed JSON, too many recipients; not configured | `test_resend_webhook.py::test_resend_rejections` (16 cases), `test_not_configured_accepts_nothing`; 299 s either way accepted (`test_timestamp_inside_tolerance_is_accepted`); rotation list (`test_rotated_secret_list_accepts_any_valid_signature`) | passed |
| 9 | Published Svix example signature | `test_published_svix_vector` | passed |
| 10 | Suppression stores the digest only; kinds; precedence; replay; concurrency | `test_bounce_suppresses_digest_only` (no address in either table), `test_event_kinds` (8), `test_complaint_is_not_downgraded_by_a_later_bounce`, `test_replayed_svix_id_has_no_second_effect`, `test_concurrent_delivery_has_one_effect` | passed |
| 11 | Mailer honours the list | `tests/webhooks/test_suppressed_mail.py` (8-cell matrix, bounce stops magic links with the same 202, complaint keeps sign-in links and stops the deletion mail, production composition wraps SMTP) | passed |
| 12 | Event mapping, lifecycle, out-of-order, no-effect events, product mapping, sandbox, transfer, retries | `tests/billing/test_events.py` (32: 18 mapping cases and 14 more) | passed |
| 13 | Entitlement matrix through the pack route | `tests/billing/test_entitlement_matrix.py` (12 cases: free tier, active, lifetime, active past expiry, cancelled within and after the period, grace within and after, expired, expired with a future date, refunded, cancelled without date; plus the row rule and another account's Plus), `tests/export/test_entitlements.py` (20) | passed |
| 14 | Reconciliation: drift fixed, second run no-op, dry run, snapshot states, REST failures (fake, 500, 401, 429, HTML, wrong shape, connect timeout) change nothing, empty snapshot wipes nothing, request URL and bearer, id quoting, delete 200/404/500 | `tests/billing/test_reconciliation.py` (16) | passed |
| 15 | Deletion removes the subscriber | `tests/deletion/test_subscriber_rest.py` (DELETE sent, rows and account gone for 200 and 404; 503 defers; composition wires the client) | passed |
| 16 | Nightly jobs idempotent with dry run | `tests/workers/test_nightly.py` (sweep, retention, roll-up keeps the account first city, setting and argument, reconciliation needs a key, schedule), `tests/workers/test_main.py::test_schedule` | passed |
| 17 | Harness | `tests/security/test_webhook_routes.py` (route table exact, absent from OpenAPI, anonymous and every role with a bearer token get 401 from both routes, nothing stored), `tests/privacy/test_public_responses.py::test_every_route_is_classified` | passed |
| 18 | Logs | `tests/webhooks/test_webhook_logs.py` (no address, secret, signature or account id in the captured JSON logs) | passed |

Mutation checks (script outside the repository; each mutation applied, the named tests run, the
file restored and `git diff --quiet` confirmed):

| # | Mutation | Result |
| - | -------- | ------ |
| M1 | RevenueCat secret compared with `!=` instead of `hmac.compare_digest` | 1 failed (`test_secret_comparison_is_constant_time`); restored |
| M2 | RevenueCat idempotency key replaced by a fresh id | 2 failed (`test_replayed_event_id_has_one_effect`, `test_concurrent_delivery_of_one_event_has_one_effect`); restored |
| M3 | Svix timestamp tolerance removed | 2 failed (`test_resend_rejections[stale-timestamp]`, `[future-timestamp]`); restored |
| M4 | Suppression ignored by the mailer | 7 failed (the blocked cells of `test_suppression_matrix` and both route tests); restored |
| M5 | Unknown app user id accepted | 4 failed (`[unknown-app-user-id]`, `[anonymous-app-user-id]`, `[missing-app-user-id]`, `test_transfer_needs_one_known_account`); restored |
| M6 | Reconciliation expires rows on a REST error | 7 failed (`test_rest_failure_does_not_wipe_entitlements`, the `test_rest_client_errors_change_nothing` cases, `test_rest_client_network_error_changes_nothing`); restored |
| M7 | Stale-event check removed | 1 failed (`test_out_of_order_event_is_stale`); restored |
| M8 | `refunded` added to the entitling statuses | 2 failed (`test_pack_entitlement_matrix[refunded]`, `test_has_plus_matches_row_rule[refunded]`); restored |
| M9 | Svix signature value not compared | 5 failed (`[wrong-secret]`, `[tampered-body]`, `[signature-for-other-id]`, `[empty-signature]` and one more); restored |
| M10 | Resend idempotency key replaced by a fresh id | 2 failed (`test_replayed_svix_id_has_no_second_effect`, `test_concurrent_delivery_has_one_effect`); restored |

Secret scan: `gitleaks git --redact --config .gitleaks.toml --log-opts="d8276d08..HEAD"` reports
one `generic-api-key` finding in commit `8197119d` (`tests/webhooks/test_resend_webhook.py`): the
example signing values printed in the Svix documentation, not a credential. Commit `48fdbba3`
removes the literal from the tree (`gitleaks dir` on `api/app`, `api/tests`, `api/alembic` and
`docs`: no leaks). The history finding stays until the lead either allowlists that fingerprint
in the root `.gitleaks.toml` or the branch history is rewritten; neither is in this package's
scope.

Not exercised:

- `not exercised: real RevenueCat and Resend accounts` (none exist; providers are doubles: the
  fake directory, `httpx.MockTransport` with the documented v1 response shape, and locally signed
  Svix requests).
- `not exercised: payloads signed or sent by the real providers` (payloads follow the documented
  shapes; only the Svix documentation example signature is an external vector).
- `not exercised: Svix library` (not a dependency; the scheme is implemented directly, item 10).
- `not exercised: a store purchase and the app's RevenueCat SDK against this API` (no account, no
  device run).
- `not exercised: arq worker process and cron firing over real time` (jobs are called directly in
  tests; the schedule is asserted; no compose stack was started for this phase).
- `not exercised: GitHub CI on this branch` (not pushed).
