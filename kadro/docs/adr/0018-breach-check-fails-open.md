# ADR-0018: Password breach check fails open

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 item 11; threat model T-AUTH-01, T-AUTH-15

## Context

Registration and password reset check the new password against the Have I Been Pwned "Pwned
Passwords" range API (§6 item 11). The service is a third party outside our control. When it is
unreachable we must either refuse the password (fail closed) or accept it (fail open).

## Decision

- `packages/auth` queries the range API with k-anonymity: only the first 5 hex characters of the
  password's SHA-1 leave the server, with `Add-Padding: true` so the response size does not reveal
  the bucket, and a 1.5 s timeout.
- A breached password (any occurrence count above 0) is refused with 422 `password_breached`.
- When the service is unreachable, times out, answers non-2xx or returns a body that does not match
  the documented `SUFFIX:COUNT` format, the password is **accepted**. The verdict carries
  `breachCheck: 'unavailable'` with the reason (`network`, `timeout`, `http_status`, `malformed`),
  and the API logs it as a structured event and metric. The password itself and its hash prefix are
  never logged.

## Reasoning

Failing closed would turn an outage of a third-party service into a registration and reset outage
for every user, including users locked out and trying to reset. The controls that do not depend on
the service remain in force during an outage: length 10..128, Argon2id (64 MiB, t=3, p=1) and the
group A auth rate limits (5 / 15 min per IP and per email).

## Consequences

- Risk accepted: during an outage a user can set a password that appears in a breach corpus, and it
  is not re-checked later. Credential stuffing against such an account is still bounded by the
  login rate limits.
- An alert fires when `unavailable` verdicts exceed 5 % of checks over 15 minutes, so a prolonged
  outage is noticed rather than silently weakening the control.
