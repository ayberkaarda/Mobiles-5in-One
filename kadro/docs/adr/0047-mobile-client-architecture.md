# ADR-0047: Mobile client architecture: API client, session, query cache and test setup

- Status: Proposed
- Date: 2026-10-02
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §4 (mobile), §6 items 10, 12, 13, §8; ADR-0014, ADR-0019, ADR-0039;
  threat model T-MOB-01, T-MOB-04

## Context

Phase 3 builds the Expo app on top of the Phase 1-2 API. Every feature screen needs the same
foundation: one way to call `/api/v1`, one owner of the credentials, one server-state cache that
survives a weak signal on the pitch, and a component test setup. ADR-0014 fixes the transport
(`x-kadro-client: mobile`, bearer access JWT of 15 minutes, opaque refresh token of 30 days) and
ADR-0019 requires a single-flight refresh because the server has no grace window. This record
fixes how the app implements those rules.

## Decision

### API client (`apps/mobile/src/api`)

- One client created from `EXPO_PUBLIC_API_URL`, which is read only through
  `loadMobilePublicEnv()` from `@kadro/config/mobile` (the same validation as the build
  configuration: https outside `local`).
- Every request sends `x-kadro-client: mobile` and `accept: application/json,
application/problem+json`; `credentials: 'omit'`, `redirect: 'error'` (see Redirects below).
- Only relative `/api/v1/` paths are accepted (no `..`, no `//`, no absolute URL, no trailing
  slash), so no caller can send the bearer token to another host.
- Auth modes per call: `required` (bearer, refresh when needed, local 401 without a session),
  `optional` (bearer when a session exists: public lists) and `none` (auth endpoints; never
  refreshes).
- After a 401 on a call that carried a token, the client refreshes once through the session's
  single-flight gate and replays the call once. A burst of concurrent 401s produces one refresh.
  A 401 for a token that another request has already replaced is replayed with the current token
  without a second rotation.
- A failed refresh (network, timeout, server error) ends the call: the request-level retry never
  repeats it, because a refresh whose answer was lost may already have rotated the token on the
  server, and presenting the same token again is reuse (ADR-0019). The session and the stored
  token are kept; the next user action tries again.
- Waiting for a shared refresh and the pause before a retry both end as soon as the caller's
  `AbortSignal` fires; the shared refresh itself continues for its other waiters.
- Time limit 15 s per attempt (`timeout` error). Retries: only `GET`, after network failures,
  timeouts and 502/503/504, at most twice (0.5 s, 1.5 s). `POST`/`PUT`/`PATCH`/`DELETE` are never
  repeated, because a repeated create could duplicate a team or an application. A caller
  cancellation (`AbortSignal`) is passed through without a retry.
- Errors are `ApiError` with `kind` (`problem`, `network`, `timeout`, `invalid_response`),
  `status`, `code`, `requestId` and `fieldErrors`. Only the machine fields of an RFC 9457 body are
  kept; `title` and `detail` are dropped so server prose never reaches the UI (copy: ADR-0048).

### Redirects

Findings from the installed sources (React Native 0.86.3, whatwg-fetch 3.6.20):

- React Native's `fetch` is whatwg-fetch over `XMLHttpRequest`; it does not read the `redirect`
  option, and the native layer follows redirects. `redirect: 'error'` is honoured by standard
  fetch implementations only (Node in the tests).
- iOS (`RCTHTTPRequestHandler.mm`, `willPerformHTTPRedirection`) replaces all header fields of the
  redirected request with the cookie headers, so `Authorization` is not forwarded. For 307/308,
  NSURLSession keeps the method and body (Apple documentation; not observed on a device).
- Android: `OkHttpClientProvider` does not change OkHttp's default `followRedirects(true)`. OkHttp
  drops `Authorization` when a redirect leaves the host and keeps the body for 307/308 (OkHttp
  documentation; the OkHttp source is not part of the installed packages and was not inspected).
- No pre-send block is available without a native module or a new dependency, so the risk is
  handled as follows:
  - The API does not redirect: no `redirect()`, `NextResponse.redirect`, 3xx status or
    `redirects()` exists under `apps/web` (checked with `git grep`). Next.js answers a trailing
    slash with a 308, so the client refuses paths with a trailing slash.
  - Outside `local` the API URL must be https (`@kadro/config/mobile`), Android release builds
    refuse cleartext (security checklist item 10, build configuration test), so no http to https edge redirect is on
    the path.
  - A response that was redirected or whose final URL is not on the API origin is rejected
    (`invalid_response`) before its body is read; a refresh answered that way changes nothing in
    the session.
  - Residual risk: a redirect introduced by infrastructure in front of the API (proxy, CDN) would
    still forward the body of a 307/308 `POST /auth/refresh` (the refresh token). Behaviour on
    iOS and Android was not observed on a device or emulator.

### Session (`apps/mobile/src/auth-store`)

- The refresh token is the only persisted credential. It is stored with `expo-secure-store` only
  (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: readable for a background refresh, never restored to
  another device from a backup).
- The access token and its expiry live in a Zustand store in memory, without any persistence
  middleware. It is treated as expired 30 s before `accessTokenExpiresAt`; a cold start reads the
  refresh token and the first API call refreshes.
- `refreshAccessToken()` is a single-flight gate: callers during a refresh share one promise. The
  rotated refresh token is written to secure storage before the promise resolves. A 401 from
  refresh (expired, revoked, or the reuse that revokes the family) ends the session on the device
  and is never retried; a network failure keeps the session and the stored token.
- Session generation: every sign-out and sign-in advances a counter. A refresh started in an
  earlier generation is discarded when it completes (no secure-store write, no state change), and
  new callers never join it. Token writes and deletions go through one queue in request order, so
  a sign-out requested during a refresh deletes after any write that was already running.
- Sign-out: best-effort `POST /auth/logout` (5 s limit, the current access token as is, so an
  expired token does not trigger a refresh that rotates the family being revoked), then always,
  in a `finally`, the local cleanup: in-memory state, the secure-store entries, and every
  registered sign-out listener. Each step tolerates and reports the failure of another (reading
  the token, revoking, deleting the entry, a cache listener); an entry that cannot be deleted is
  overwritten with an empty value, which counts as no session. Starting without a stored refresh
  token runs the same cleanup.
- Each sign-in gets a random cache scope id, stored next to the refresh token and kept across
  restarts and refreshes. The persisted query cache is busted by app version plus scope, so data
  written under another sign-in, or while signed out, is never restored even if a cleanup failed.
- Routing: the root stack exposes the signed-in side (`(tabs)`) or the signed-out side (entry
  screen; the `(auth)` group joins it) through `Stack.Protected`, never both; the splash screen
  stays up while the stored session is read.

### Server state (`apps/mobile/src/query`)

- TanStack Query with `networkMode: 'offlineFirst'`, `staleTime` 30 s, refetch on reconnect and
  on returning to the foreground (AppState drives the focus manager), Query-level `retry: false`
  (the API client is the only retry layer, so attempts do not multiply), mutations never retried.
- Persistence: `@tanstack/query-async-storage-persister` under the AsyncStorage key
  `kadro.query-cache.v1`, maximum age 24 hours (`gcTime` matches), busted by the app version and
  the cache scope of the sign-in. Only
  successful queries whose first key segment is on an allow-list are written: `teams`, `matches`,
  `open-calls`, `venues`, `districts`. `me` (email address, linked providers) and anything not on
  the list stay in memory. As a second guard, a query whose data contains a key matching
  `token|password|secret|authorization|cookie|email` is not written even when its root is allowed.
  Mutations are never persisted.
- Sign-out (and a session ended by a refresh rejection) cancels running queries, clears the
  in-memory cache and removes the persisted copy (T-MOB-04).
- List screens share one state view: skeleton on first load, localized error with request
  reference and retry when nothing is cached, cached rows with an offline notice after a failure,
  empty state after an empty success. Render errors are caught by a boundary that also resets
  failed queries.

### Component tests (`apps/mobile/tests`)

- Vitest runs in Node. React Native ships Flow sources and native bindings that Node cannot load,
  so `react-native`, `react-native-safe-area-context`, `@shopify/flash-list`, `expo-secure-store`,
  `expo-localization` and `@react-native-async-storage/async-storage` are replaced by test doubles
  in `tests/support` (Vite aliases; Node's module cache for React Native Testing Library, which is
  loaded by `require`). The `react-native` double renders the host component names of React
  Native (`View`, `Text`, `TextInput`, `RCTScrollView`), and a disabled `Pressable` refuses the
  touch responder as on a device, so queries by role, label and state behave as in the app.
- MSW (`msw/node`) serves the API; an unhandled request fails the test.
- The AsyncStorage double inspects every write: a key naming a credential, or a value containing a
  token issued in the test, fails the test in the shared `afterEach` (T-MOB-01).

## Consequences

- Feature screens call `api.request` and the query definitions; none of them handles tokens,
  refresh or retries.
- The single-flight requirement of ADR-0019 is covered by a test with concurrent 401s that asserts
  one refresh call; a regression shows up as a failing test instead of unexpected logouts.
- A refresh lost after the server rotated the token (response never arrives) leaves the device
  with a spent token. The client does not repeat it on its own; the next refresh, started by a
  later user action, is reuse and signs the user out. This is the accepted cost of having no grace
  window (ADR-0019).
- Known limit: start-up treats a stored refresh token as a session without asking the server, so
  the tabs and the cache of that sign-in show before the first API call; if the server has revoked
  the family, that first call ends the session and clears the cache. A router integration test
  (guard plus deep link) is not part of this foundation; it belongs with the Maestro flows.
- The test doubles do not exercise native code. Behaviour on devices is covered by the Maestro
  flows of Phase 3.
- `@kadro/contracts` and `@kadro/brand` are not dependencies of the mobile package yet; the app
  reads the token JSON, the font files and the contract types by workspace path. Once the
  dependencies are added, only those imports change (`src/theme/tokens.ts`, `src/theme/fonts.ts`,
  `src/api/contracts.ts`). Responses are typed from the contracts but not validated at runtime
  until zod is available to the app.
