# ADR-0012: Account state checked on every authenticated request

- Status: Accepted; amended by [ADR-0025](0025-session-family-checked-per-request.md) (session family check)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §1.1, §2; threat model T-AUTH-13, T-DEL-02

## Context

Mobile access JWTs live 15 minutes. The Phase 0 draft said a deactivated account receives 401 on
every protected endpoint, while the threat model accepted up to 15 minutes of read access after
deactivation. The same gap applies to role changes: a demoted moderator would keep role claims
until the token expires.

## Decision

- The authentication step of every protected Route Handler verifies the access JWT (or web
  session) and then loads the user by primary key: `role`, `email_verified_at`, `deactivated_at`.
- `deactivated_at IS NOT NULL` → 401 `account_deactivated` on every endpoint, reads included.
- `role` and email verification are taken from this row, never from token claims. The access JWT
  carries only `sub`, `sid` (refresh family or session id), `iat`, `exp`, `aud`, `iss`.
- Deactivation also revokes all refresh tokens and sessions and deletes push tokens, so the client
  cannot obtain a new access token.
- `POST auth/login` during a self-initiated deletion grace period cancels the deletion and clears
  `deactivated_at`. An account deactivated by an admin cannot log in (401 `account_deactivated`).

## Consequences

- One indexed primary-key lookup per authenticated request; acceptable at MVP scale and shared with
  the actor context the policy check needs anyway.
- Deactivation and demotion take effect on the next request; residual risk RR-1 is closed.
- The attack-suite case "deletion grace bypass" expects 401 on reads and mutations.
