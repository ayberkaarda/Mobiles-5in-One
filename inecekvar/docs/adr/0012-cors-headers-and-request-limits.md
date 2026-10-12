# ADR-0012: CORS, API security headers and request limits

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 1, package 1C

## Context

Section 6 item 8 fixes the CORS allowlist (`https://inecekvar.app`, `https://app.inecekvar.app`,
`capacitor://localhost`, `https://localhost`; `http://localhost:4200|8100` in local only),
credentials only for the two web origins, explicit methods and headers, never `*`. Item 9 asks
the API for `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and HSTS. Item 6 asks
for a 1 MB body limit (2 MB for traces).

## Decision

- A pure ASGI CORS middleware (`app/core/cors.py`) replaces Starlette's, which cannot vary
  credentials per origin. Origins match exactly (no suffix or pattern matching; a repeated
  `Origin` header counts as none). Web origins get `Access-Control-Allow-Origin: <origin>`,
  `Access-Control-Allow-Credentials: true` and `Vary: Origin`; the Capacitor origins get the
  origin without credentials; every other origin, including `null`, gets no `Access-Control-*`
  header at all, and its preflight is refused with `403 origin.not_allowed`. Preflights are
  allowed only for `GET, POST, PUT, PATCH, DELETE` and the headers `Authorization`,
  `Content-Type`, `X-CSRF-Token`, `X-Request-ID`; `Retry-After` and `X-Request-ID` are exposed;
  max age 600 s. The local development origins are added only when `INECEKVAR_ENV=local`.
- Server side, cookie authentication from a Capacitor or foreign `Origin` is refused
  (ADR-0008), so the Capacitor origins are bearer-only in the browser and at the API.
- Every response, errors and preflights included, gets `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`,
  `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and
  `Cross-Origin-Resource-Policy: same-site`.
- Bodies: 1 MiB, 2 MiB for paths under `/v1/traces`; a larger `Content-Length` is refused
  before reading and streamed or misdeclared bodies are counted chunk by chunk (413
  `request.body_too_large`). Mutations with a body must be `application/json` (415), which also
  blocks HTML form posts; `/v1/webhooks/` is exempt from the type rule only.
- Order from the outside in (`app/core/setup.py`): request id, access log, security headers,
  CORS, client IP, body limit, unhandled-error catcher, application.
- The environment is required (`INECEKVAR_ENV`); a missing value fails at startup instead of
  enabling the local origins and local secret defaults (review finding M7).

## Consequences

- Adding an origin is a code change in `app/core/settings.py`, reviewed like any other.
- Browsers on unlisted origins can still send simple requests; the API answers without CORS
  headers, so the page cannot read the answer, and cookie mode refuses the request.
- The SSR web headers (helmet, CSP nonce) of item 9 belong to the web app and phase 4.

## Evidence

Logs in the owner's job folder (`p1c-gate.log`, `p1-final-gate.log`).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Evil origin gets no CORS headers | `tests/core/test_cors.py::test_evil_origin_gets_no_cors_headers` (`https://evil.example`, `null`, `https://inecekvar.app.evil.example`, `http://inecekvar.app`, simple and preflight) | passed |
| 2 | Capacitor origins bearer-only | `test_capacitor_origins_are_bearer_only`, `tests/auth/test_sessions.py::test_cookie_mode_refused_for_capacitor_origin` | passed |
| 3 | Web origins and preflight lists | `test_web_origins_get_credentials`, `test_preflight_rejects_unlisted_header_and_method`, `test_preflight_explicit_lists`, `test_local_origins_only_in_local_env` (3), `test_error_responses_keep_cors` | passed |
| 4 | Header assertions | `tests/core/test_headers.py::test_api_security_headers` (200, 404, 413, 429, 500, preflight), `tests/core/test_middleware.py::test_security_headers_overwrite_route` | passed |
| 5 | Body limits | `tests/core/test_body_limit.py::test_body_limit_1mb`, `test_trace_body_limit_2mb`, `test_non_json_body_rejected`, `test_json_parameters_allowed`, `test_webhooks_exempt_only_from_media_type` | passed |
| 6 | Settings | `tests/core/test_settings.py::test_environment_must_be_explicit`, `test_production_requires_smtp_tls`, `test_production_requires_secrets` | passed |
| 7 | In-process smoke | `app.main:app` with env local, `GET /v1/health` with `Origin: https://evil.example` and a spoofed `X-Forwarded-For` | 200, no `access-control-*` header, security headers and `X-Request-ID` present, one JSON access line with `client_ip_hash` |

Not exercised:

- `not exercised: HSTS preload and HTTPS redirect` (no production host; ADR-0005 class N).
- `not exercised: refusing plain http behind the proxy` (item 10 is not implemented in this
  package).
- `not exercised: Playwright header assertions for the SSR web` (phase 4).
