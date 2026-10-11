# ADR-0010: Problem details and log masking

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 1, package 1C (contract in `app/core/errors.py`)

## Context

Section 6 item 13 asks for RFC 9457 bodies `{type,title,status,code,request_id}` and never a
traceback; item 14 asks for structlog JSON with `authorization`, cookies and CSRF tokens
dropped, emails hashed, coordinates rounded to 3 decimals, no bodies for `/auth/*` and
`/traces`, a request id on every line and the uvicorn access log through the same processors.
Section 0.6 repeats the coordinate rule.

## Decision

- `ProblemError(code, status, detail=None, headers=None)` is the only way code signals an
  error. Bodies have exactly `type` (`https://api.inecekvar.app/problems/<code>`), `title` (the
  HTTP reason phrase), `status`, `code`, `request_id`, plus `detail` only when the raising code
  passes a fixed sentence. Content type `application/problem+json`. Codes are stable dotted
  identifiers (`auth.invalid_credentials`, `csrf.invalid`, `rate_limited`, ...) that the
  clients map to Turkish copy.
- Handlers (`app/core/handlers.py`): validation errors become `422 validation.failed` without
  locations, messages or input; Starlette HTTP errors keep their status and headers (`Allow`)
  with codes `not_found`, `method_not_allowed` or `http.<status>`. Unhandled exceptions are
  caught by a pure ASGI middleware that sits inside the request id, header and CORS layers, so
  the generic `500 internal` answer still carries `X-Request-ID`, the security headers and CORS;
  the exception is logged server-side with `exc_info` and never re-raised to the client.
- Request ids: an inbound `X-Request-ID` matching `^[A-Za-z0-9-]{8,64}$` is kept, anything else
  is replaced by a UUIDv7; the id is bound to structlog context vars and returned on every
  response.
- Logging (`app/core/logging.py`): one processor chain for structlog and stdlib records
  (uvicorn included) rendering JSON. The masking processor drops keys `authorization`, `cookie`,
  `set-cookie`, `x-csrf-token`, `csrf_token`, `password`, `token`, `access_token`,
  `refresh_token`, `session`, `body`, `email_token` (case-insensitive, recursive); replaces
  `email` keys and any email found in text by `email_hash` (first 16 hex of
  HMAC-SHA256(`log_hash_key`, normalized email)); rounds coordinate fields to 3 decimals; and
  removes every query string from any logged path or line, before and after percent-decoding
  and including an encoded `%3F`, so tokens, emails and exact coordinates in queries never reach
  a log (review findings M5 and its follow-up). The access middleware logs method, path without
  query, status, duration and `client_ip_hash`; no bodies or headers are logged for any route.
  Uvicorn access records pass a handler filter that replaces the client address by its digest
  before formatting.
- The process entry (`app.main:app`, built on first access) calls `configure_logging` once;
  importing `app.main` has no side effects.

## Consequences

- Clients get no diagnostic detail; support uses the `request_id` to find the server log line.
- Query parameters are not available in logs for debugging (deliberate).
- Retention (30 days), production console policy and Sentry scrubbing are deployment and phase
  6 work; they are not implemented here.

## Evidence

Logs in the owner's job folder (`p1c-gate.log`, `p1-final-gate.log`, `p1c-mutation.log`,
`p1-final-mutation.log`).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Forced exception, generic body only | `tests/core/test_handlers.py::test_forced_exception_returns_generic_body` | passed: 500, keys exactly `type,title,status,code,request_id`, no exception text, no `Traceback`, headers and `X-Request-ID` present |
| 2 | Other problem paths | `test_validation_error_does_not_echo_input`, `test_not_found_is_problem_json`, `test_problem_error_extra_headers_kept`, `test_method_not_allowed_keeps_allow`, `test_request_id_propagates`, `test_invalid_request_id_replaced`, `tests/core/test_middleware.py` (4 tests), `tests/auth/test_accounts.py::test_validation_errors_never_echo_credentials` | passed |
| 3 | Log sample of a real login and `GET /v1/me` | `tests/core/test_log_sample.py::test_log_sample_has_no_email_token_or_precise_coordinate` (register, verify, bearer and cookie login, `/me`, refresh, plus a coordinate route) | passed: no `@`, no password or token, no `41.0123456`; `41.012`, `email_hash` and the request id present |
| 4 | Masking rules | `tests/core/test_logging.py::test_mask_sensitive_unit` (parametrized, encoded-space, quote and `%3F` query cases included), `test_email_hash_recursive`, `test_uvicorn_access_log_masked` | passed |
| 5 | Mutation | M5: email hashing removed (key and free text) | `test_log_sample_has_no_email_token_or_precise_coordinate` and `test_email_hash_recursive` fail; restored, hash identical |

Not exercised:

- `not exercised: trace and plan log samples` (the endpoints arrive in phase 2; the spec 6.14
  sample covers login, trace and plan, so item 14 stays partial).
- `not exercised: a running uvicorn process with --log-config` (the formatter and filter were
  exercised through the stdlib logger in tests and one in-process ASGI smoke of `app.main:app`).
- `not exercised: Sentry scrubbing and log retention` (phase 6, no Sentry account per ADR-0005).
