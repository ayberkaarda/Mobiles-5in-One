# Logging

Spec section 6 item 14. What the API, the worker and the clients write, what is removed before a
line leaves the process, how long lines are kept and how to read them. Policy:
[ADR-0010](../adr/0010-error-and-logging-policy.md); scrub hook and error reports:
[ADR-0054](../adr/0054-cost-guards-and-degrade-mode.md).

## What is logged

| Producer | Lines | Fields |
| --- | --- | --- |
| API access log (`AccessLogMiddleware`) | one `http.request` per request | method, path without query, status, duration, `client_ip_hash`, `request_id` |
| uvicorn access log | through the same formatter | client address replaced by `client_ip_hash`, path without query |
| API events | `auth.login.failed`, `plan`, `webhook.received`, `auth.account.delete_requested`, ... | event name, outcome, counts, ids, keyed digests (`email_hash`, `client_ip_hash`) |
| Worker jobs | `worker.*`, `backup.verify.*`, `cost.guard.*` | counts, ids, thresholds, error class names |
| Ops command | `ops.planner_degrade` on stderr | action, previous state, source, reason slug, lifetime, operator slug |
| Database errors | class and SQLSTATE only | no parameters, no row values (`hide_parameters`) |
| Web SSR server (`apps/web/src/server.ts`) | the listening address once at start-up | no request log |
| Mobile and web browser code | nothing in production; `console.error` only for a failed bootstrap | no user data |
| Caddy | no access log (no `log` directive in `ops/Caddyfile`) | none |

Request and response bodies are never logged, so the `/auth/*` and `/traces` bodies never reach a
line. Every line inside a request carries the `request_id` (bound by `RequestIdMiddleware`).

## What is scrubbed

`app/core/logging.py` runs one processor, `mask_sensitive`, as the last step before JSON
rendering, for structlog and stdlib (uvicorn) records alike:

| Rule | Example in | Out |
| --- | --- | --- |
| Drop keys (any depth, case-insensitive): `authorization`, `proxy-authorization`, `cookie(s)`, `set-cookie`, `x-csrf-token`, `csrf_token`, `password`, `password_hash`, `token`, `access_token`, `refresh_token`, `id_token`, `session`, `body`, `email_token`, `secret`, `client_secret`, `private_key`, `webhook_secret`, `totp_*`, `otpauth_uri`, `code`, `signature`, `svix_signature`, `api_key`, `x-api-key`, `dsn` | `{"token": "..."}` | key removed |
| `email` key | `{"email": "a@b.example"}` | `{"email_hash": "<16 hex>"}` (HMAC-SHA256 under `INECEKVAR_LOG_HASH_KEY`) |
| Email in text | `login a@b.example` | `login email_hash=<16 hex>` |
| Query strings, also encoded (`%3F`) | `/v1/near?lat=41.0123456` | `/v1/near` |
| Header values in text | `Authorization: Bearer x` | `Authorization: [redacted]` |
| Bearer and basic credentials in text | `Bearer abcdefgh...` | `Bearer [redacted]` |
| JSON Web Tokens in text | `eyJ...` | `[redacted-jwt]` |
| Coordinate collections: `coordinates`, `points`, `geometry`, `polyline`, `trace_points`, `location(s)` holding a list or object | `{"geometry": {...}}` | key removed (a number under the same key, a count, stays) |
| Coordinate keys `lat`, `lng`, `lon`, `latitude`, `longitude` | `41.0123456` | `41.012` |
| Any pair of floats | `[41.0123456, 29.0987654]` | `[41.012, 29.099]` |
| Long decimal pairs in text | `at 41.0123456, 29.0987654` | `at 41.012, 29.099` |
| Secret key families by substring (review F5): any key containing `password`, `passwd`, `pwd`, `secret`, `token`, `credential`, `apikey`, `api_key`, `access_key`, `private_key`, `signing_key`, `encryption_key` or `hash_key` (a bare `key` such as `newest_key` stays) | `{"new_password": "..."}`, `{"access_key_id": "..."}` | key removed |
| The same families as a pair inside text | `retry with api_key=abc`, `"token": "abc"` | `api_key=[redacted]`, `"token": [redacted]` |
| Bytes, sets, tuples, exceptions and other objects (review F5) | `b'{"email": ...}'`, `{"a@b.example"}`, `ValueError("... a@b.example")` | bytes decoded as UTF-8, sets and tuples treated as lists, exceptions as `Type: message`, any other object as `str()`; the text rules run on every string leaf |

Tests: `tests/core/test_logging.py`, `tests/core/test_log_scrub.py`, and the combined production
stream scan `tests/security/test_dump_and_log_scan.py::test_combined_session_log_has_no_email_token_coordinate_or_secret`
(registration, sign-in, trace upload, normal and degraded plans, both webhooks, deletion, a
`cost.guard` run and a probe line carrying a bearer header, the access token and a coordinate
collection: no `@`, token, secret, signature or coordinate with more than three decimals).

## Error reports (Sentry `beforeSend`)

No error reporting SDK is a dependency of any part of the project and no DSN exists (ADR-0005).
The scrubbers are ready and inert:

- **API and worker:** `configure_logging` calls `init_error_reporting(ErrorReportingSettings())`.
  Without `INECEKVAR_SENTRY_DSN` it returns at once and imports nothing. With a DSN it imports
  `sentry_sdk` and calls `init(dsn, environment, before_send=scrub_event, send_default_pii=False,
  include_local_variables=False)`; when the SDK is not installed it logs one
  `error_reporting.sdk_missing` warning and reports nothing. `scrub_event` applies the log rules
  above (addresses become `[email]`), keeps only `user.id`, drops `request.data`, `cookies`,
  `query_string` and `env`, and removes `server_name`.
- **Mobile and web:** `apps/mobile/src/app/core/error-scrub.ts` and `apps/web/src/app/error-scrub.ts`
  export `scrubEvent` and `beforeSendFor(dsn)` (undefined without a DSN). Nothing imports them
  yet. Wiring point when an owner adds an SDK: in `apps/mobile/src/main.ts` and
  `apps/web/src/main.ts`, before `bootstrapApplication`, initialise the SDK only when the public
  config carries a DSN and pass `beforeSend: beforeSendFor(dsn)`; the SSR server
  (`apps/web/src/server.ts`) would use the API-side rules through the same function.

Enabling it means: add the SDK dependency, a DSN in the environment, a Sentry project with
spike protection and a quota (docs/ops/cost-alerts.md), and a check that a real event arrives
scrubbed. None of that is exercised here.

## Retention

Log lines are kept **30 days**, then deleted. The application writes JSON to stdout only and
keeps no log file; retention is the setting of whatever collects stdout on the host:

- Docker's `json-file` driver: rotate by size (for example `max-size: 10m`, `max-file: 5`) and
  ship to the collector daily; the collector deletes after 30 days.
- systemd journal: `MaxRetentionSec=30day` in `journald.conf`.
- A hosted collector: a 30-day retention policy on the index or bucket.

Database rows with personal data follow their own retention (traces 30 days, webhook events 30
days, bounce suppressions 365 days, pack downloads 90 days; docs/ops/background-jobs.md), not
this one. `not exercised: no host`, so no collector has been configured yet.

## How to read

- Every line is one JSON object: `event`, `level`, `timestamp` (UTC ISO 8601), `request_id`
  inside requests, then the fields of the table above.
- Follow one request: filter on `request_id` (also returned to the client as `X-Request-ID`).
- Find one account's lines: compute the digest with the same key,
  `uv run python -c "from app.core.logging import hash_for_log; from app.core.settings import load_settings; print(hash_for_log(load_settings(), 'address'))"`,
  and filter on `email_hash`. Never paste an address into a log query tool that keeps history.
- Alerts: `level` `error` with `event` starting with `cost.guard.` or `backup.verify.`.
- Locally: `uv run uvicorn app.main:app --no-proxy-headers --forwarded-allow-ips 127.0.0.1` prints the lines to the console; pipe them through `jq`.
