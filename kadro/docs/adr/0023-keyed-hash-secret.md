# ADR-0023: Separate `HASH_SECRET` for keyed hashes of IPs and emails

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 items 2, 5, 14; threat model AS-03, T-PLT-11

## Context

Rate-limit keys (`rate_limit_buckets.key`) contain client IPs and email addresses, and
`audit_logs.ip_hash` contains client IPs. A plain SHA-256 of an IPv4 address or an email is
reversible by enumeration, so these values need a keyed hash. Reusing an existing secret such as
`CSRF_SECRET` or the JWT key would couple unrelated rotations.

## Decision

- A dedicated `HASH_SECRET` (base64url, at least 256 bits, validated by `@kadro/config`) is the
  input key material for all keyed hashes.
- Each purpose (`rate-limit`, `audit-ip`) derives its own HMAC-SHA256 key with HKDF-SHA256
  (`info = purpose`), so values hashed for one purpose cannot be correlated with another.
- `HASH_SECRET` is added to the secret rotation list in the history-purge runbook.

## Consequences

- Rotating `HASH_SECRET` resets rate-limit buckets (acceptable, they are short-lived) and breaks
  correlation of `ip_hash` values across the rotation boundary in audit logs (accepted).
- A leaked database alone does not reveal IPs or emails from these columns.
