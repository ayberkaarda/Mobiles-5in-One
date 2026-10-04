# ADR-0010: Error contract

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification item 13 asks for trimmed error messages: no stack traces, SQL, class names or debug
output outside local development, and a stable machine-readable shape that the Flutter app maps to
Turkish copy.

## Decision

### Shape

Every API error (path `api/*` or a request that accepts JSON) is a problem details document (RFC 9457) with `Content-Type: application/problem+json`:
`{type, title, status, code, request_id[, errors]}`. `type` is `https://askida.app/problems/<code>`.
`title` is a fixed English sentence per code. The client maps `code`, never `title`, to copy.

### Code catalogue

| Code                       | Meaning                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `validation.failed`        | Request data failed validation (422); `errors` lists field and rule code            |
| `auth.invalid_credentials` | Wrong, unknown, deactivated or provider-only credentials (401, identical bodies)    |
| `auth.locked`              | Too many failed sign-ins for this e-mail and address (429, `Retry-After`)           |
| `auth.unauthenticated`     | Missing, expired, revoked or refused bearer token (401)                             |
| `auth.email_unverified`    | The action needs a verified e-mail address                                          |
| `auth.token_invalid`       | A one-time code or identity token is wrong, used, expired or invalid                |
| `forbidden`                | The caller's ability or role cannot do this (403)                                   |
| `not_found`                | The resource does not exist or is not visible to the caller (404)                   |
| `conflict`                 | The request conflicts with current state, such as an account-linking conflict (409) |
| `rate_limited`             | A rate limiter refused the request (429, `Retry-After`)                             |
| `payload_too_large`        | The body exceeds the limit (413)                                                    |
| `unsupported_media_type`   | The media type is not supported (415)                                               |
| `server_error`             | Any unexpected failure (500); detail is never exposed                               |
| `bad_request`              | Any other 4xx without a more specific code                                          |
| `method_not_allowed`       | Method not allowed for the route (405, `Allow` kept)                                |
| `https_required`           | A plain-HTTP API request outside local (403)                                        |
| `service_unavailable`      | A dependency such as a provider key set is unreachable (503)                        |

The first thirteen codes were fixed in the Phase 1 contract; the last four were added because 400,
405, a plain-HTTP rejection and 503 had no code.

### Validation errors

`errors` is a list of `{field, code}`. `code` is the snake-case rule name (`required`, `email`,
`max`, `min`, `in`, `enum`, `regex`, `unique`, `prohibited`, `uncompromised`, `email_missing`; for a
rule class its basename). The submitted value and the translated message are never included.

### Request id

A middleware gives every request an id: an inbound `X-Request-Id` matching `^[A-Za-z0-9._-]{8,64}$`
is kept, otherwise a UUIDv7 is created. It is stored as a request attribute, returned in the
`X-Request-Id` response header, placed in problem bodies and written to log lines.

### Handler behaviour

- Unknown exceptions render 500 `server_error` with no message, class, SQL or trace; they are
  reported with the request id in the log context.
- Only `Retry-After`, `Allow` and `X-RateLimit-*` headers pass through from framework exceptions.
- An `HttpResponseException` (such as the response built by a limiter) passes through unchanged on API
  and web. An earlier version turned it into a 500; this was found by an integration test and fixed.
- `ProblemException` (and its identity-token subclass) is not reported to the log: it is an expected
  outcome, not a fault.
- Web routes: every exception except validation (redirect back) and authentication (redirect to the
  panel login, which the admin panel needs) renders a generic Turkish error page with a status
  sentence and the request id. The framework debug page appears only when the environment is `local`
  and `APP_DEBUG=true`; `app.debug` is forced to false elsewhere.
- Guests: an unauthenticated API call answers 401 `auth.unauthenticated`. `redirectGuestsTo` returns
  no redirect for API requests (otherwise a missing named route caused a 500) and `/admin/login` for
  web requests.

## Consequences

- Clients can rely on `code` as a stable key; new codes are additive.
- Anything inside a request that throws is invisible to the caller but traceable by request id.
- Over-masking of validation values means a client cannot show the wrong value back from the server;
  it keeps its own input.

## Not exercised / limits

- Evidence: `tests/Feature/Security/ErrorsTest.php`, `ErrorsRequestIdTest.php`, `ErrorsBodySizeTest.php`,
  `SeamsTest.php`, `tests/Unit/Support/ProblemExceptionTest.php`.
- Mapping of codes to Turkish app copy is a Phase 4 task and not exercised here.
