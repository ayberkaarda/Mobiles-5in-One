# ADR-0008: Session cookie, CSRF, access tokens and refresh rotation

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 1, package 1B (contracts in `app/core/deps.py`)

## Context

Section 4 fixes two auth strategies: web/PWA use an HttpOnly session cookie on the same origin
(`/api/*` proxied by Caddy) plus a CSRF header, native apps use a bearer access token in memory
and a refresh token in secure storage. Section 6 item 12 fixes the cookie name and flags, the
7-day rolling session, the `X-CSRF-Token` double-submit header, a 15 minute access token, a
30 day refresh token with rotation and reuse detection, and a logout-everywhere endpoint.

## Decision

- Mode is chosen per sign-in request (`mode: "cookie" | "bearer"` on login and magic-link
  verify). Cookie mode never returns a token in the body; bearer mode never sets a cookie.
- Cookie: `__Host-iv_session` = 32 random bytes, stored only as SHA-256 in `sessions`;
  `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`, no `Domain` (the `__Host-` prefix
  rules). Rolling: `GET /v1/me` and `POST /v1/auth/csrf` re-issue the cookie with a fresh
  `Max-Age` and move `sessions.expires_at` to now + 7 days; any authenticated use extends it
  when `last_seen_at` is older than one hour.
- CSRF: a session-bound token `base64url(HMAC-SHA256(csrf_secret, "csrf:" + session id))`,
  returned by `POST /v1/auth/csrf` and in the cookie-mode sign-in body. `optional_principal`
  verifies it with `hmac.compare_digest` on every cookie-mode POST, PUT, PATCH and DELETE, so a
  route cannot forget the check. `POST /v1/auth/csrf` is the only CSRF-exempt cookie route (it
  only reads a value bound to the session; the response is not readable cross-origin).
  Cookie mode is also refused when an `Origin` header is present and is not one of the two web
  origins (`403 origin.not_allowed`), which keeps the Capacitor origins bearer-only and adds an
  origin check in front of the token check. The body layer requires `application/json` for
  bodies on mutations (form posts are refused with 415).
- Access token: ES256 JWT, 15 minutes, claims `iss`, `aud`, `sub`, `sid` (refresh family id),
  `iat`, `nbf`, `exp`, `jti`, `typ=access`; decoding accepts only `ES256` and requires every
  claim; times are checked against the injected clock with no leeway. The authenticator also
  requires a live (unrevoked, unexpired) refresh token in the `sid` family, so logout,
  logout-everywhere, reuse detection and account deletion end access tokens at once. The role
  is read from the database on every request, never from the token. A request with both an
  `Authorization: Bearer` header and a cookie is authenticated by the bearer token.
- Refresh: 32 random bytes, SHA-256 stored, 30 days, rotated on every use inside a
  transaction that locks the user and the token row (`FOR UPDATE`). A token that was already
  used or revoked is reuse: every token of its family is revoked with `reuse_detected` and the
  change is committed before the `401`. Reuse is checked before expiry, so replaying an expired,
  already rotated token still revokes its living descendants (review finding M4). Refresh is
  limited per IP and per family (5 per 15 minutes).
- Logout revokes the current session (cookie) or family (bearer); `POST /v1/auth/logout-all`
  revokes every session and refresh token of the account.
- Keys: the ES256 pair comes from `INECEKVAR_JWT_PRIVATE_KEY_PEM|_PATH` and
  `INECEKVAR_JWT_PUBLIC_KEY_PEM|_PATH`; tests create a P-256 pair per process; `env=local`
  without keys creates a pair per process (`app/main.py::with_local_defaults`). Missing keys
  are a startup error in `test` and `production`.

## Consequences

- Every authenticated request costs one or two indexed lookups (user, session or live family);
  in exchange revocation is immediate and roles are never stale.
- Clients in cookie mode must call `POST /v1/auth/csrf` after load (or keep the token from the
  sign-in response) and send `X-CSRF-Token` on mutations.
- Native clients must store the newest refresh token atomically; a lost race shows up as reuse
  and signs the device out.

## Evidence

Same runs as ADR-0007 (`p1-final-gate.log`: 330 passed; `p1-final-mutation.log`).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Cookie attributes | `tests/auth/test_sessions.py::test_cookie_attributes`, `test_bearer_mode_sets_no_cookie`, `test_cookie_session_rolls_on_me_and_csrf` | passed (raw `set-cookie` parsed: name, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=604800, no Domain) |
| 2 | CSRF-less cookie mutation | `test_cookie_mutation_without_csrf_is_403`, `test_csrf_token_is_bound_to_session`, `test_csrf_endpoint_requires_cookie_session` | passed (403 `csrf.invalid`); mutation M2 (check disabled) fails the first two |
| 3 | Capacitor origins bearer-only | `test_cookie_mode_refused_for_capacitor_origin` | passed (403 `origin.not_allowed` with the cookie, 200 with bearer) |
| 4 | Refresh reuse revokes the family | `tests/auth/test_refresh_jwt.py::test_refresh_reuse_revokes_family`, `test_refresh_rotates_and_old_token_is_single_use`, `tests/auth/test_review_findings.py::test_expired_rotated_token_replay_revokes_family` | passed; mutation M3 (reuse branch disabled) fails these three and `test_logout_all_revokes_everything` |
| 5 | JWT handling | `test_jwt_alg_none_and_hs256_rejected`, `test_jwt_expired_rejected`, `test_jwt_wrong_audience_rejected`, `test_refresh_expired_is_rejected` | passed |
| 6 | Logout | `test_logout_revokes_session`, `test_logout_all_revokes_everything`, `test_deactivated_user_cannot_authenticate`, `test_authorization_header_wins_over_cookie` | passed |

Not exercised:

- `not exercised: the cookie through Caddy on the real web origins` (no TLS host; ADR-0005
  class N for hosting). The `__Host-` and Secure rules were asserted on the API response only.
- `not exercised: native secure storage of the refresh token` (phase 3, ADR-0004).
