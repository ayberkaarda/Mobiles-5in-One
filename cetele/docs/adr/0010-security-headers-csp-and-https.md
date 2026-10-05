# ADR-0010: Security headers, CSP nonce, CORS off and HTTPS

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec section 6 items 8, 9 and 10 ask for no CORS, a fixed set of response headers with a
per-request CSP nonce, and HTTPS only outside local work. The server is an API for one native
client and serves HTML later (the statement page in Phase 2, the admin console in Phase 4), so the
header baseline is set now for every response, including errors.

## Decision

### Headers on every response

| Header                      | Value                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`, on secure requests only                                                                                                               |
| `Content-Security-Policy`   | `default-src 'none'; script-src 'self' 'nonce-<n>'; style-src 'self' 'nonce-<n>'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                             |
| `X-Frame-Options`           | `DENY`                                                                                                                                                                                |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                                     |
| `Permissions-Policy`        | `camera=(), geolocation=(), microphone=()`                                                                                                                                            |

Responses under `/v1/**` also carry `Cache-Control: no-store` and `Pragma: no-cache`.

- The nonce is 128 bits from `SecureRandom`, new per request, set by `CspNonceFilter` as the
  request attribute `cspNonce` for the templates of later phases.
- HSTS is written by a static header writer because Spring's own writer inserts spaces
  (`max-age=... ; includeSubDomains ; preload`) and the documented value is exact. A plain HTTP
  request gets no HSTS, as the specification of the header requires.
- Spring's default cache-control headers are off, so the API rule above is the only one.

### CORS is off

No `CorsFilter` and no configuration source exist. A preflight or a request with an `Origin`
header never receives an `Access-Control-*` header. The only client is the native app, which does
not need CORS; the web pages of later phases are same origin.

### HTTPS only

- `cetele.security.require-https` defaults to `true` and is `false` only in the profiles `local`
  and `test` (`application.yml`). When on, `requiresSecure()` applies to every request and a plain
  HTTP request is redirected to HTTPS before anything else, including the health endpoint.
- Whether a request is secure is decided by the scheme after the trusted proxy rewrite
  ([ADR-0009](0009-rate-limiting-and-client-ip.md)). A production deployment without
  `CETELE_TRUSTED_PROXIES` therefore redirects every request forever; the setting is mandatory
  there and is stated in [env.md](../ops/env.md).
- The OpenAPI document is served only in `local` and `test`.

## Consequences

- Evidence: `HeadersTest` (public and 401 responses carry every header, `no-store` on the API, HSTS
  only over HTTPS with `secure(true)`, nonce size and freshness), `CorsTest` (preflight, simple and
  credentialed requests, no filter bean), `HttpsTest`, `PublicSurfaceTest`.
- `HttpsTest` runs the real security configuration in a small web context with the rule switched
  on, because the shared integration context runs plain HTTP in profile `test`. The redirect
  therefore is proven for that configuration, not through a running server behind a proxy.
- Not exercised: real TLS, a real HSTS preload submission (`not exercised: no domain`,
  [ADR-0004](0004-portfolio-delivery-scope.md) G5) and a real reverse proxy. The `preload`
  directive is set but nothing was submitted to a preload list.
- The CSP is strict and the API serves no HTML yet, so no page was ever rendered under it; the
  statement page (Phase 2) and the admin console (Phase 4) must be built to fit it.
