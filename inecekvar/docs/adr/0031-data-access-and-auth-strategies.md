# ADR-0031: Data access layer and auth strategies

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 3, package 3B

## Context

Section 4 asks for one API client in `libs/data-access` (fetch plus signals) and one
`AuthStrategy` interface with two implementations: web and PWA use the HttpOnly session cookie
plus the `X-CSRF-Token` header, native apps use a bearer access token in memory and a refresh
token in secure storage. ADR-0008 fixes the server side of both, ADR-0004 the plugin allowlist,
ADR-0007 the magic link with its token in the URL fragment, ADR-0027 the derived types and
section 6.13 the RFC 9457 error bodies. The screens of packages 3C to 3G need typed calls for
cities, packs, lines, stops, the planner, favourites, the account, edits, traces, photo uploads,
sign-in and deletion.

## Decision

1. **One HTTP entry point.** `ApiClient.request()` takes a path template that must exist in
   `docs/api/openapi.json` (a type derived from `ApiPaths`, so a removed route stops compiling),
   fills `{params}` with `encodeURIComponent`, drops empty query values and sends
   `Accept: application/json` and a fresh `X-Request-ID` (kept across its own retries). Bodies
   and responses use the `libs/domain` schemas through aliases in `api-types.ts`; the domain
   file stays generated (`--check` still passes, the contract did not change in this package).
   The endpoint services are `CatalogApi`, `AccountApi`, `ContributionApi` and `AuthApi`.
   Line, version and stop reads always send `?city=`; pack downloads send `X-Pack-Request: 1`
   and get a 60 s timeout instead of 15 s.
2. **Typed errors.** Every failure is an `ApiError` with `kind` (`problem`, `rate_limited`,
   `http`, `network`, `timeout`, `aborted`, `invalid_response`), `status` (0 without a response),
   the server `code`, the request id (problem body, then response header, then the id sent),
   `detail` and `retryAfterSeconds`. The message is `code (HTTP status)` only: no body, token or
   input is ever copied into it.
3. **Retries.** A 401, or a 403 `csrf.invalid`, on a request that carried a credential is handed
   to the strategy once; if it recovers, the request is sent again once. A 429 with a
   `Retry-After` of at most 5 s is retried once for GET, PUT and DELETE; POST is never replayed.
   Longer waits surface as the error and set the `rateLimitedUntil` signal. `busy` is a signal
   of requests in flight. Sign-in endpoints pass `auth: false`, so a wrong password is an answer
   and never triggers a refresh.
4. **Cookie strategy (web, PWA).** `credentials: 'include'`, no `Authorization` header. The
   CSRF token from the sign-in body is kept in memory; after a reload the first mutation fetches
   it with `POST /auth/csrf` (single flight). Mutations carry `X-CSRF-Token`; reads do not. A
   403 `csrf.invalid` fetches a new token once and retries once. A 401, or a 401 from the CSRF
   endpoint, ends the session. A bearer body is refused.
5. **Bearer strategy (native).** `credentials: 'omit'`. The access token and its expiry live in
   the strategy object only. The refresh token goes to `SecureTokenStore` before the new access
   token is used, because the old one is spent once the server rotates it. Refresh is single
   flight (a second use of a rotated token is reuse and revokes the family, ADR-0008), runs
   ahead of a request when the access token is missing or within 30 s of expiry, and is skipped
   when another request already rotated. A refused refresh (400, 401, 403, 422) clears memory and
   storage and ends the session; offline, 429 and 5xx keep the refresh token so being offline
   does not sign anybody out. `clear()` bumps an epoch so a refresh that finishes after logout
   cannot store its tokens. A cookie body is refused.
6. **Secure storage.** `capacitor-secure-storage-plugin` 0.13.0 (the section 4 default candidate,
   peer `@capacitor/core >= 8`, Keychain on iOS and Keystore-encrypted storage on Android) behind
   `CapacitorSecureTokenStore`. Its web fallback writes to localStorage, so the adapter refuses
   every call outside the native shell; the cookie strategy never uses the store.
7. **Strategy choice.** `provideDataAccess({ apiBase, tilesBase })` binds `AUTH_STRATEGY` to the
   bearer strategy when `Capacitor.isNativePlatform()` is true and to the cookie strategy
   otherwise. Tokens never leave the strategies: `AuthApi` hands the sign-in body to
   `establish()` and returns only the user.
8. **Session store.** `SessionStore` exposes `session`, `status` (`unknown`, `anonymous`,
   `signed-in`), `user`, `role`, `isSignedIn`, `licenceAccepted` and `hasPendingMagicLink` as
   signals. `init()` reads `#token=` and removes the fragment with `history.replaceState`
   synchronously, before its first await and before the router's first navigation (it runs in
   the app initializer); a malformed token is removed too and not kept. The session check then
   runs without blocking the first render: a 401 makes the user anonymous, a network failure
   leaves `unknown` and keeps stored credentials. `completeMagicLink(password?)` keeps the token
   pending after 401 `auth.invalid_credentials` without a password, so the UI can ask for the
   registration password (ADR-0007) and call again. Native links arrive through `appUrlOpen`
   and `consumeMagicLinkUrl`. When a strategy ends a session the store turns anonymous.
9. **Environment.** `apps/mobile/src/environments/environment.ts` holds public URLs only:
   `webApiBase: '/api/v1'` (same origin through Caddy, locally `http://127.0.0.1:8081`),
   `nativeApiBase: 'https://api.inecekvar.app/v1'` and `tilesBase: 'https://tiles.inecekvar.app'`.
   One file serves development and production because the web path is relative; no
   `fileReplacements` are needed.

## Evidence

Run on 2026-10-12 on the owner's Windows 11 machine, branch `feat/inecekvar-p3`:

| # | Command | Result |
| - | ------- | ------ |
| 1 | `pnpm add --save-exact capacitor-secure-storage-plugin@0.13.0` | 1 package added, lockfile +12 lines |
| 2 | `node libs/domain/scripts/build-api-types.mjs --check` | matches `docs/api/openapi.json` (no regeneration needed) |
| 3 | `pnpm nx run-many -t lint test build -p data-access domain mobile ui --skip-nx-cache` | exit 0; data-access 64 tests, domain 4, ui 12, mobile 35; production build with the budget warning of row 5 |
| 4 | `pnpm exec prettier --check` on the changed paths | clean |
| 5 | Production bundle | initial 645.3 kB raw, 163.7 kB transfer (3A: 619.5 kB); over the 500 kB warning budget, under the 1 MB error budget |
| 6 | Mutation: CSRF header left off cookie mutations | 5 tests fail |
| 7 | Mutation: access token also written to localStorage | 1 test fails (`keeps tokens out of web storage, cookies and the console`) |
| 8 | Mutation: refresh not single flight | 1 test fails (`shares one refresh between concurrent 401s`) |

Every mutation was reverted and the suite was green again (64 passed).

Not exercised:

- `not exercised: the plugin on a device or emulator` (unit tests use a fake plugin; `cap sync`
  was not run, so `apps/mobile/android` does not list the plugin yet).
- `not exercised: the client against the running API` (fake fetch only; the cookie path through
  Caddy and the CORS preflight with `X-Pack-Request` and `X-CSRF-Token` were not observed).
- `not exercised: iOS Keychain` (no macOS host).

## Consequences

- Screens call the endpoint services and read `SessionStore`; none of them touches tokens,
  headers or `fetch`.
- The magic-link route `/giris/baglanti` does not exist yet; until package 3G adds it the
  link lands on the not-found page with the token already captured.
- Guest favourites stay local (`FavoritesStore`); merging them into the account is part of the
  favourites package.
- The native dev build points at the production API host; an emulator against the local API
  needs a development value when the native run is set up.
