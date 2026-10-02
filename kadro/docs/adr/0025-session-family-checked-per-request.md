# ADR-0025: Session family checked on every authenticated request

- Status: Accepted; amends [ADR-0012](0012-account-state-checked-per-request.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0014, ADR-0019; authorization matrix §2, §3.1; threat model T-AUTH-05, T-AUTH-13

## Context

ADR-0012 loads the user row on every request, so deactivation and role changes act immediately.
Logout and password reset revoke the refresh family (mobile) or the session row (web), but a mobile
access JWT that was already issued would stay valid until its `exp`, up to 15 minutes. A stolen
access token would therefore survive the user's "log out" or "reset password" for that window.

## Decision

- The authentication step also verifies that the access token's `sid` still has an active row:
  `refresh_tokens.family_id = sid AND revoked_at IS NULL AND expires_at > now()`, issued to the same
  client type. No such row → 401 `unauthenticated`.
- Web sessions already authenticate by looking up the session row, so the rule is the same for both
  clients: a revoked family or session ends every credential derived from it on the next request.
- The check runs in the same query as the ADR-0012 user lookup (indexed on `family_id`), so the cost
  is one round trip per request.

## Consequences

- Logout, password reset, reuse detection, deactivation and "log out everywhere" take effect on the
  next request for access tokens as well; the 15-minute residual window is closed.
- The 15-minute access-token lifetime remains as a bound on signature validity only; revocation no
  longer depends on it.
- Attack-suite case: access token used after logout → 401.
