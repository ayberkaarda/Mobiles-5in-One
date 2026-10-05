# ADR-0008: Problem Details and the error code registry

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec section 6 item 13 asks for generic error bodies: no exception text, no stack, no submitted
value. The Android app maps a machine `code` to Turkish text, so codes are a public contract.
Framework defaults (Boot's `/error`, Spring's own problem details, Jackson messages) leak class
names and values and use their own shapes.

## Decision

### Body

Every error is `application/problem+json` (RFC 9457) with exactly:

```json
{
  "type": "https://cetele.app/problems/<code>",
  "title": "<generic English phrase>",
  "status": 422,
  "code": "validation.failed",
  "traceId": "<UUIDv7>",
  "errors": [{ "field": "name", "code": "required" }]
}
```

`errors` appears only for `validation.failed`. A body never contains a message, an exception class,
a stack or a submitted value. `traceId` is a UUIDv7 made by `TraceIdFilter`, put in the log context
and returned as `X-Trace-Id`; an incoming `X-Trace-Id` is ignored. `spring.mvc.problemdetails` is
off, Boot's error attributes are all `never`, and `ProblemErrorController` replaces `/error`.

### Registry

`ProblemCode` is an append-only enum: a code is never renamed or removed.

| Code                        | Status | Used for                                                           |
| --------------------------- | ------ | ------------------------------------------------------------------ |
| `auth.unauthenticated`      | 401    | missing, invalid or expired access token; deactivated user         |
| `auth.integrity_required`   | 403    | no integrity token on `otp/request`                                |
| `auth.integrity_invalid`    | 403    | undecodable, refused or mismatching integrity token                |
| `auth.otp_invalid`          | 401    | wrong, expired, consumed, exhausted code; unknown phone; same body |
| `auth.refresh_invalid`      | 401    | unknown, expired, reused refresh token                             |
| `forbidden`                 | 403    | member whose role lacks the action                                 |
| `not_found`                 | 404    | absent or foreign resource, non-member, unknown route              |
| `validation.failed`         | 422    | any validation or malformed body failure                           |
| `conflict`                  | 409    | state conflict (for example 5 open invitations)                    |
| `membership.owner_locked`   | 409    | removing the owner or oneself                                      |
| `membership.already_member` | 409    | inviting or accepting for an existing member                       |
| `rate_limited`              | 429    | a bucket is empty; `Retry-After` in seconds                        |
| `payload_too_large`         | 413    | body over 1 MiB                                                    |
| `unsupported_media_type`    | 415    | not JSON on `/v1`                                                  |
| `server_error`              | 500    | anything unexpected; logged with stack, masked                     |

Field error codes: `required`, `invalid_format`, `too_long`, `out_of_range`, `unknown_property`
(the last one was added in Phase 1 for "unknown property is 422").

### Mapping rules

- `ProblemException(code, detail?, errors, headers)` is the only thing application code throws.
  The handler also finds it in a cause chain, which is how `perm.can` yields 404 from inside a
  security expression.
- Framework exceptions are mapped onto the registry: binding, constraint and method-validation
  errors and malformed JSON are 422 (a malformed body has no `errors`); an unknown property is
  `unknown_property`; a missing non-null Kotlin property is `required`; a wrong type is
  `invalid_format`; an unknown route, unsupported method and malformed path id are 404; a
  non-JSON body is 415 (also a 406); authentication failures are 401; access denied is 403.
- 405 is deliberately answered as 404 so the route table is not probed.
- Filters render problems through `ProblemWriter`, so 401 and 403 from the security chain and
  429 and 413 from filters have the same shape.

## Consequences

- Clients see a stable, small vocabulary. Adding a code is a contract change: it is appended and
  listed in the [authorization matrix](../security/authorization-matrix.md) section 3 and in the
  OpenAPI document.
- Debugging uses `traceId` to find the masked server log line; the response itself carries no
  hint.
- Evidence: `ProblemTest` (registry statuses, generic body, no echoed values, 413, 415, streamed
  body, method security denial, 404 before 403), `HeadersTest` (headers on error responses),
  `OtpVerifyTest` and `TenantIsolationTest` (identical bodies for different causes).
