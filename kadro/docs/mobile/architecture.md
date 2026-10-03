# Mobile architecture

The Kadro app lives in `apps/mobile` (Expo SDK 57, React Native 0.86, Expo Router, TypeScript). The
decisions behind it are ADR-0047 (client architecture), ADR-0048 (i18n and error copy), ADR-0049
(auth flows) and ADR-0075 (links and push). This page describes what the code on `main` does.

## Source layout

| Path                | Role                                                                             |
| ------------------- | -------------------------------------------------------------------------------- |
| `app/`              | Expo Router routes (file based). Screens only compose feature code from `src/`.  |
| `src/api/`          | HTTP client, problem-details errors, contract types, the shared `api` instance.  |
| `src/auth-store/`   | Session state (zustand), secure token storage, route guard, session logic.       |
| `src/query/`        | TanStack Query client, query keys, persistence rules, list and boundary views.   |
| `src/<feature>/`    | `auth`, `teams`, `matches`, `calls`, `venues`, `profile`, `settings`, `billing`, |
|                     | `links`, `notifications`: API module, queries, mutations, forms, components.     |
| `src/i18n/`         | i18next setup, bundled `tr` / `en` catalogs, error copy.                         |
| `src/theme/`, `ui/` | Design tokens, light and dark themes, shared UI kit.                             |
| `tests/`            | Vitest suites; native modules are replaced by doubles in `tests/support/`.       |
| `.maestro/`, `e2e/` | Maestro flows and the local stack seed (see `running-and-testing.md`).           |

Feature folders follow one pattern: `<feature>-api.ts` (typed calls on the shared client),
`queries.ts`, `mutations.ts`, `form.ts` / `validation.ts` (pure form logic), `permissions.ts` (what
the viewer may do, mirroring the authorization matrix; the server still decides), `instance.ts`
(wires the module to the shared client) and `components.tsx`.

## Routing

Routes use Turkish slugs that match the web and deep link paths (ADR-0045). The root stack in
`app/_layout.tsx` has `headerShown: false` and two guarded groups driven by `routeAccess(status)`
(`src/auth-store/route-guard.ts`):

- `Stack.Protected guard={signedInRoutes}`: `(tabs)` and every other signed-in screen.
- `Stack.Protected guard={signedOutRoutes}`: `index` (welcome) and the `(auth)` group (`giris`,
  `kayit`, `sifremi-unuttum`).
- Always open: `e-posta-dogrula`, `sifre-sifirla` (email links; the tokens are single use) and
  `ayarlar/hesap-silindi` (shown while the session ends after a deletion request).

`status` is `unknown` until secure storage has been read; the splash screen stays up while it is
`unknown` or the fonts are loading (a font error falls back to the system face). Exactly one side is
open afterwards, so a signed-out user cannot reach a tab through a link; Expo Router redirects to
the first open screen. The route list with data and states is in `screens.md`.

The five tabs (`app/(tabs)/_layout.tsx`, JS tabs) are `maclar`, `takimlar`, `eksik-var`, `sahalar`
and `profil`; their tab buttons carry the `testID`s `tab-matches`, `tab-teams`, `tab-openCalls`,
`tab-venues` and `tab-profile`. `experiments.typedRoutes` is on (`app.config.ts`).

`app/_layout.tsx` also mounts, inside the stack, the pending link opener, the notification tap
router and the push token refresh (see `deep-links-and-push.md`), and the billing identity hook (see
`billing.md`). The `ErrorBoundary` exported from the layout is the last resort for render errors
outside every screen boundary.

## State

| State                      | Where                                                  | Persisted               |
| -------------------------- | ------------------------------------------------------ | ----------------------- |
| Auth status, access token  | zustand vanilla store, `src/auth-store/store.ts`       | No (memory only)        |
| Refresh token, cache scope | `expo-secure-store`, `src/auth-store/token-storage.ts` | Keychain / Keystore     |
| Server data                | TanStack Query 5                                       | Allow-listed roots only |
| Held invite / venue link   | zustand store, `src/links/pending.ts`                  | No                      |
| Push registration flag     | zustand store, `src/settings/push.ts`                  | No                      |
| Language choice            | AsyncStorage key `kadro.language`                      | Yes (device preference) |
| "Not now" on the push card | AsyncStorage key `kadro.pushPrompt`                    | Yes (device preference) |
| Forms                      | `react-hook-form` with resolvers, sent on submit       | No                      |

The access token is never written to disk: `createAuthStore` has no persistence middleware. Only
the refresh token survives a restart, in the platform secure store with
`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`.

### Query defaults (`src/query/query-client.ts`)

- `networkMode: 'offlineFirst'` for queries; `'online'` and no retry for mutations.
- `retry: false` at the Query level (the API client already retries idempotent GETs), `staleTime`
  30 s, `gcTime` 24 h, refetch on reconnect and on focus.
- Returning to the foreground counts as window focus (`connectFocusManager` uses `AppState`).
- Lists are cursor paginated (`LIST_PAGE_SIZE` 20) through `useInfiniteQuery`.

### Persisted cache (`src/query/persistence.ts`)

The cache is written to AsyncStorage (`kadro.query-cache.v1`, throttled to 1 s, max age 24 h) so
lists show offline. Only the roots `teams`, `matches`, `open-calls`, `venues` and `districts` are
persisted, only successful queries, and only when the data contains no key matching
`token|password|secret|authorization|cookie|email` (defence in depth). Never persisted: `me`
(email address, providers), invite metadata and previews, application lists, venue reviews, the
store price list, and all mutations. The persisted cache is bound to the sign-in: its buster is
`<app version>:<cacheScope>` (`cacheBusterFor`), and `QueryProvider` is keyed by it, so another
sign-in, another app version or a signed-out start restores nothing. A sign-out clears both the
in-memory and the persisted cache (`session.onSignOut(() => clearQueryCaches(...))`, registered in
`app/_layout.tsx` before the session is read).

## API client (`src/api/client.ts`, `src/api/instance.ts`)

`createApiClient({ baseUrl, session })` exposes one method, `request<T>(path, options)`. The shared
instance `api` uses `EXPO_PUBLIC_API_URL`, read through `loadMobilePublicEnv` from
`@kadro/config/mobile`.

- Paths must be relative `/api/v1/...` paths without `..`, `//` or a trailing slash; anything else
  throws a `TypeError`, so no caller can send the bearer token to another host. Query strings are
  built by hand because the React Native `URLSearchParams` implementation is partial.
- Every request sends `x-kadro-client: mobile` (ADR-0014: bearer transport, JSON token bodies),
  `accept: application/json, application/problem+json`, `redirect: 'error'` and
  `credentials: 'omit'`. A response that was redirected or came from another origin is rejected as
  `invalid_response`.
- Auth modes: `required` (default; bearer token, refreshed first when needed, 401 when there is no
  session), `optional` (token when a session exists; public lists), `none` (auth endpoints; never
  refreshes).
- Timeout 15 s (`DEFAULT_TIMEOUT_MS`). A caller abort is not an API failure and is rethrown as is.
- Only `GET` is retried: after `network` / `timeout` failures and 502/503/504, with pauses of 500 ms
  and 1.5 s. `POST`, `PUT`, `PATCH` and `DELETE` are never repeated.
- Errors are `ApiError` with `kind` (`problem`, `network`, `timeout`, `invalid_response`), `status`,
  `code`, `requestId`, `fieldErrors` and `retryAfterSeconds`. Only machine fields of the RFC 9457
  body are kept; `title` and `detail` are dropped so server prose never reaches the UI. The message
  of an `ApiError` carries no server text.

### Auth and refresh single flight (`src/auth-store/session.ts`)

- `bootstrap()` runs once at start-up: no stored refresh token means signed out (and clears what an
  interrupted sign-out may have left); otherwise the status becomes `signedIn` with no access token
  yet. If secure storage cannot be read, `RootLayout` signs out locally instead of holding the
  splash.
- `getAccessToken()` returns the in-memory token only while it is more than 30 s from
  `accessTokenExpiresAt` (`ACCESS_TOKEN_SKEW_MS`).
- `refreshAccessToken()` is single flight (ADR-0019): all callers during a refresh share one
  promise, so a burst of 401s rotates the refresh token exactly once. The rotated token is written
  to secure storage before any waiter resumes.
- After a 401 on a request that carried a token, the client first checks whether another request
  already replaced the token (then it replays with the current one); otherwise it refreshes once
  through the gate and replays once. The 401 codes `reauth_required` and `step_up_required` are
  about a proof sent with the request, not the token, and are never refreshed or replayed.
- A refresh rejected with 401 (expired, revoked, or a reused token) ends the session locally
  (`signOut` reason `expired`) and is not retried. A transport failure keeps the session. Refresh
  failures are excluded from the request-level retry because a lost answer may already have rotated
  the token, and presenting it again would revoke the family.
- A generation counter, incremented by every sign-out and sign-in, drops the result of a slow
  refresh that finished after the session changed. Token writes and deletions are serialized.
- `signOut()` optionally revokes the family (`POST /api/v1/auth/logout`, 5 s limit, failures
  tolerated), then clears secure storage and runs the registered cleanups (query caches, push
  registration, store customer). Cleanup failures are reported without token or server text and
  never skip the other cleanups.

## i18n and error copy

- `i18next` with `react-i18next`; Turkish (`tr`) is the authored language and the fallback, English
  (`en`) follows. Namespaces (`src/i18n/resources.ts`): `common`, `auth`, `teams`, `matches`,
  `opencalls`, `venues`, `errors`. The catalogs are JSON files in `src/i18n/tr/` and `src/i18n/en/`
  and are bundled, so initialization is synchronous.
- The initial language is the device language when it is `tr` or `en` (`pickLanguage` over
  `expo-localization`); the choice made in Settings is stored under `kadro.language` and applied at
  start-up (`restoreLanguage`). It is a device preference and survives sign-out.
- `errorMessage(i18n, error)` in `src/i18n/error-copy.ts` is how failures reach the user:
  transport failures map to `errors:network_error` and `errors:timeout`; a 401 produced by the
  client itself (no request id) maps to `errors:session_expired`; a problem `code` with copy maps to
  `errors:<code>` (`rate_limited` only together with its `Retry-After` seconds); other 5xx map to
  `errors:server_error`; everything else maps to `errors:unknown`. `common:error.*` is the fallback
  while a catalog is missing. Error screens show the request id as a reference when there is one.
- The `offline` key exists in the catalog but has no producer: the app has no connectivity
  detection, so an unreachable server is reported as `network_error` (ADR-0048).
- Screens catch render errors with `QueryBoundary`, which shows a localized error with a retry that
  also resets the failed queries.

## Offline behaviour

There is no offline write queue. What works without a connection:

- Persisted lists and details (see "Persisted cache") render from the device. A failed refresh with
  cached rows shows the rows plus a notice; with nothing cached it shows the localized error with a
  retry (`ListQueryView`: skeleton on first load, error, rows plus notice, empty state).
- Queries run once even when the device looks offline (`offlineFirst`), and GETs are retried twice.
- Mutations (`networkMode: 'online'`) fail instead of queueing. The RSVP is the only optimistic
  write and rolls back on failure (`src/matches/mutations.ts`); every other write waits for the
  server.
- The venue detail keeps a review-free copy of the facts on the device; reviews are read only while
  online and never stored (`src/venues/queries.ts`).
- Tapping a notification for a match needs `GET /api/v1/matches/:id` to find the team; when that
  fails the matches tab opens instead.
