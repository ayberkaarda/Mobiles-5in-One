# ADR-0009: Password hashing, breach check and abuse limits

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification items 5 and 11 require a modern password hash, a password policy with a breach check,
and limits on sign-in attempts that cannot be bypassed by spoofing the client address.

## Decision

### Hashing

- The hash driver is fixed to Argon2id with memory 65536 KiB, time 4, one thread. The `ARGON_*`
  environment variables exist only so tests can lower the cost; production values are the defaults.
- Tests lower the cost (`ARGON_MEMORY=1024`, `ARGON_TIME=1` in `phpunit.xml`). A dedicated test
  loads `config/hashing.php` with those variables removed and asserts the production values, so the
  override cannot silently reach production.
- Redemption codes and one-time codes are HMAC-SHA256 values, not password hashes (ADR-0008, later
  phases).

### Password policy and breach check

- `PasswordPolicy::rules()` applies: string, minimum 10 and maximum 128 characters, and an
  `Uncompromised` rule. It is equivalent to `Password::min(10)->uncompromised()` but returns stable
  rule codes for the error contract (ADR-0010).
- The breach check uses the k-anonymity range API (only a five-character hash prefix leaves the
  server, with padding), with a 3 second timeout. It is switchable with `BREACHED_PASSWORD_CHECK`.
- It fails open: when the service is unreachable or answers an error, the password is accepted and a
  warning is logged ("Breached password check unavailable; the password was accepted without it.").
  Fail-open is acceptable because the check is an extra layer on top of length rules, the lockout and
  the limiter; failing closed would make account creation and reset depend on a third party and let
  an outage of that party lock every user out. Tests fake the service.

### Limiters

- Limiter `auth`: 5 requests per minute per client address and 5 per minute per e-mail (key is the
  SHA-256 of the lower-cased e-mail). It is applied to register, login, Apple, Google, verify, forgot
  and reset. Responses are `rate_limited` problems with `Retry-After`.
- Progressive lockout on login: failures are counted per (e-mail, address) pair; at 10 failures the
  pair is locked for 15 minutes (`AUTH_LOCKOUT_ATTEMPTS`, `AUTH_LOCKOUT_MINUTES`) and answers 429
  `auth.locked` with `Retry-After`. A success clears the counter. State is in the default cache store
  (Redis).
- The address key uses the framework's client address after trusted-proxy handling (ADR-0011). A
  spoofed `X-Forwarded-For` from an untrusted caller is ignored.
- `anon/attest`, `hooks/reserve` and `redeem` limiters belong to Phase 2 and are not implemented.

## Consequences

- Hashing takes roughly tens of milliseconds at production cost; tests stay fast through the override.
- A shared network address (a café or a carrier-grade NAT) shares the per-address bucket; the
  per-e-mail bucket and the pair-based lockout keep honest users from being blocked by others' typos.
- Lockout state loss (cache flush) resets counters; the limiter still applies.

## Not exercised / limits

- The real breach service was not called; tests fake it and test the fail-open path.
- Limiter evidence: `tests/Feature/Api/Auth/RateLimitTest.php`, `tests/Feature/Api/Auth/LoginTest.php`
  and the seam tests in `tests/Feature/Security/SeamsTest.php`.
- Limiters for reserve, redeem and attestation are not implemented (Phase 2), so item 5 stays partial.
