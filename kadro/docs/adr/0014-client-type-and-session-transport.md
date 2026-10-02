# ADR-0014: Client type header and session transport

- Status: Accepted; exempt-route list amended by [ADR-0020](0020-client-header-exempt-routes.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §4 (auth), §6 items 8, 12; authorization matrix §1.1, §2; threat model T-AUTH-09, T-AUTH-14

## Context

The API serves two kinds of clients with different credential transports: the mobile app (access
JWT + opaque refresh token in `expo-secure-store`) and the web app (`__Host-kadro_session` cookie
with CSRF double-submit). Auth endpoints must know which transport to issue, and protected
endpoints must not accept a credential through the wrong transport. Guessing from browser
identification headers or the presence of cookies is unreliable.

## Decision

- Every request to `/api/v1/**` carries `x-kadro-client: mobile` or `x-kadro-client: web`. A missing
  or unknown value → 400 `validation_failed`. Exempt routes are listed in ADR-0020
  (`GET health`, `POST webhooks/revenuecat`).
- `mobile`: auth endpoints return an ES256 access JWT (15 min) and an opaque refresh token (30 days,
  rotated, reuse revokes the family) in the JSON body. Protected endpoints accept only
  `Authorization: Bearer`; cookies are ignored.
- `web`: auth endpoints set `__Host-kadro_session` (HttpOnly, Secure, SameSite=Lax, Path=/, 7-day
  rolling) and the CSRF cookie; no token appears in the body. Protected endpoints accept only the
  session cookie and require the CSRF header on every non-GET request; `Authorization` is ignored.
- `x-kadro-client: mobile` together with an `Origin` header → 400. Browsers always send `Origin` on
  cross-origin and non-GET requests, so a page cannot ask for JS-readable tokens.
- Web sessions are rows in `refresh_tokens` with `client = 'web'` (mobile rows have
  `client = 'mobile'`): the cookie value is an opaque 256-bit token stored as a SHA-256 hash, and
  `expires_at` is extended to `now() + 7 days` at most once per hour of use. Logout, password reset,
  deactivation and reuse detection revoke web and mobile rows through the same code path. The
  session row id is the `sid` that step-up records bind to.
- The header selects a transport only; it never grants or removes permissions.

## Consequences

- One revocation model and one table for all sessions; "log out everywhere" covers both clients.
- `packages/db` adds `refresh_tokens.client` (`mobile` | `web`); `packages/contracts` defines the
  header schema; CORS allows the `x-kadro-client` request header for the web origin only.
- Tests: wrong-transport credentials → 401; `mobile` + `Origin` → 400; web mutation without CSRF
  header → 403.
