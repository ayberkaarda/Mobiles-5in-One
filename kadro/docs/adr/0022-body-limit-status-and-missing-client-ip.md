# ADR-0022: 413 for oversized bodies; shared rate-limit bucket when the client IP is missing

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 items 5, 6; ADR-0002; authorization matrix §2, §8; threat model
  T-PLT-12, T-AUTH-17, RR-7

## Context

Two edge cases of the request pipeline needed a fixed answer:

1. A JSON body above the 1 MB limit was described as both 400 and 413 in the drafts.
2. The client address comes only from the configured `CLIENT_IP_HEADER`, read through
   `TRUSTED_PROXY_CIDRS` (ADR-0002, Caddy). When the header is absent or malformed, there is no
   address to key IP-based rate limits on.

## Decision

- **Oversized body → 413** `payload_too_large`, not 400. The limit is checked against
  `Content-Length` before reading, and enforced while streaming for chunked bodies, so an oversized
  body is never parsed. 400 `validation_failed` remains for well-sized bodies that fail the schema.
  A wrong `Content-Type` on a JSON route → 415 `unsupported_media_type`.
- **Missing or malformed client IP → shared bucket.** The rate-limit subject becomes the constant
  `unknown`, so all such requests share one IP bucket per rate-limit group. Requests are not
  rejected. Email-keyed limits (group A) and user-keyed limits are unaffected. IPv6 addresses are
  bucketed per `/64`.

## Accepted risk and monitoring

- In production Caddy always sets the header and the web container is not published on the host,
  so `unknown` only occurs through misconfiguration. In that state one client can exhaust the
  shared bucket and throttle every other header-less client; this is accepted because the failure
  mode is "too strict", never "no limit".
- Every request resolved to `unknown` increments the metric `client_ip_missing` and logs a warning
  with the request id (no header values). In `production` and `preview` any non-zero count over 5
  minutes raises an alert. Audit rows written in that state carry `ip_hash = NULL`.

## Consequences

- Attack-suite case "oversized JSON" expects 413; fuzz tests expect 413 above the limit and 400 for
  schema failures.
- A proxy misconfiguration is visible within minutes instead of silently weakening rate limits.
