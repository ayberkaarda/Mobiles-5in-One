# ADR-0034: API client, offline cache and offline policy

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The app needs one place that talks HTTP, turns failures into the error contract (ADR-0010) and keeps
the shop list usable with a weak connection, without ever storing anything about recipients.

## Decision

### One dio client

- `ApiClient` (`lib/core/http/api_client.dart`) wraps dio. The base URL comes from `API_BASE_URL`
  only. Interceptors add `Authorization: Bearer` by route scope, a fresh `X-Request-Id`,
  `Accept: application/json` and `Accept-Language`. No logging interceptor exists, so bodies and headers
  are never logged.
- Route scopes: `none` (public), `user` (donor or merchant token), `anon` (device token) and
  `directory` (shop directory reads: the account token when one is stored, otherwise the anon token).
  A `401 auth.unauthenticated` clears only the token that scope actually sent and notifies the session.
- Presigned storage uploads use a second, bare dio client that never carries the bearer token
  (ADR-0017).
- Every failure becomes an `ApiProblem {code, status, title, type, requestId, fieldErrors,
  retryAfter}`. Transport failures get device codes: `network.offline`, `network.timeout`,
  `client.cancelled`; a malformed body becomes `client.bad_response`. Resource answers are read from
  `data` when present, otherwise from the body.
- The dev flavor may use cleartext to `10.0.2.2` and `localhost` through a dev-only network security
  config; the main configuration is HTTPS only with system trust anchors, and a test asserts both.

### Offline cache (drift)

- Tables: `cached_shops` and `cached_items` (read-through for the shop list and the public shop
  detail, 24 hour TTL) and `redemption_log` (merchant redemptions, 30 days). `purgeExpired(now)`
  enforces both lifetimes and runs when the merchant opens the log.
- `CachedShopsRepository.watchNearby` emits the cached list first, then the network list. Reads of a
  shop by slug are read-through. The owner shape of a shop (masked tax number and IBAN, contact) is
  never cached.
- The anonymous flow stores nothing in the database: the active reservation, the chosen district,
  the radius and the intro flag live in memory only. Deleting an account or the anonymous identity runs
  `clearAll()`; the anonymous reset clears the database even when the server call fails.

### Offline behaviour

- Lists show cached rows plus a message when the network fails; screens show the mapped problem copy
  and a retry button instead of retrying in the background.
- A stored token whose `me` call cannot complete offline counts as signed out for the route guards
  (known limit, see the app README).
- The merchant dashboard opens from the shop listing with an offline note when only the owner-shape
  call fails with a `network.*` problem (ADR-0041).

## Consequences

- One failure vocabulary reaches every screen and every test; copy never depends on server text.
- Cached shops can be up to 24 hours stale; counts shown from the cache are indicative.
- Cold-start offline use is limited for signed-in merchants and donors, because the user is
  restored from the server.

## Not exercised / limits

- Offline behaviour is proven with the in-memory database and fake repositories (unit and widget
  tests); no emulator run toggled the network.
- Evidence: `test/core/api_client_test.dart`, `test/data/**`.
