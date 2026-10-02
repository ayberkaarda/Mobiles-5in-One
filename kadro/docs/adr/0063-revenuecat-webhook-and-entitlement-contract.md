# ADR-0063: RevenueCat webhook, reconciliation and entitlement contract

- Status: Proposed
- Date: 2026-10-02
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §3 item 10, §6 items 17 and 21; authorization matrix §3.7 (footnote 25),
  §7; ADR-0013, ADR-0020, ADR-0028, ADR-0032; `packages/contracts/src/billing.ts`,
  `packages/contracts/src/jobs.ts`, `packages/config/src/schema.ts`

## Context

Phase 5 adds Kadro Pro through RevenueCat. The webhook route, the processing job, the nightly
reconciliation, the entitlement checks and the mobile paywall are separate work packages that
run in parallel, so their shared shapes are fixed here first. Authorization matrix §7 already
states that entitlement state comes only from `subscriptions`, never from a client claim, and
ADR-0013 fixes 403 `entitlement_required` as the only entitlement status.

The project has no RevenueCat account, products or keys yet. Everything below must therefore be
testable with fixtures and a fake REST server, and must stay closed (no Pro) when keys are absent.

## Decision

1. **Identity.** The RevenueCat `app_user_id` of a user is `users.id` (UUIDv7). The app calls
   `Purchases.logIn(userId)` after sign-in and `logOut()` on sign-out; anonymous RevenueCat ids
   (`$RCAnonymousID:…`) are never linked to an account.
2. **Products and entitlement.** Entitlement id `pro`; products `kadro_pro_monthly` and
   `kadro_pro_yearly`. Prices live in the stores only.
3. **Webhook request.** `POST /api/v1/webhooks/revenuecat`, exempt from `x-kadro-client`
   (ADR-0020), no user principal (cookies and bearer tokens are ignored), not CORS-enabled.
   - The `Authorization` header must equal `REVENUECAT_WEBHOOK_SECRET`, compared with
     `crypto.timingSafeEqual` over equal-length buffers; mismatch → 401 `unauthenticated`. An
     unset secret answers 503 `service_unavailable` (fail closed).
   - Body: a **strict** envelope `{ api_version, event }` around a **loose** `event` object.
     RevenueCat adds event fields without notice, so unknown event fields are accepted but never
     stored; the fields the server reads are typed and bounded. The OpenAPI document names the
     event `RevenueCatEvent`, the only open object schema in the document.
   - No per-group rate limit: deliveries arrive in bursts and a dropped delivery means a wrong
     Pro state until the nightly run. The 1 MiB body limit still applies.
4. **Webhook response.** Always 200 with `{ status }`, so RevenueCat stops retrying:
   - `accepted`: a new `event.id`, stored and `webhook.revenuecat.process` enqueued;
   - `duplicate`: the `(provider, event_id)` row already exists (replay or retry), nothing
     enqueued;
   - `ignored`: stored but not applied: `app_user_id` missing, anonymous or not an existing
     user, `TEST`, an event type outside the handled list, or a product outside the Pro products.

   The spec's "reject unknown `app_user_id`" is implemented as `ignored`: the event is not
   applied, and a 4xx would only make RevenueCat retry an event that can never succeed.

5. **Stored event.** The route stores, in one insert, the event id, a SHA-256 of the raw body and
   the normalized columns the job needs (event type, user id, product id, store, environment,
   event time, expiry). Neither the raw body nor any unknown field is stored.
6. **Jobs** (ADR-0028 conventions, ids only in payloads):
   - `webhook.revenuecat.process` `{ webhookEventId, idempotencyKey }`, key
     `revenuecat:<event.id>`. It applies the stored row to `subscriptions` and ignores an event
     older than the last one applied to the same subscription (deliveries are not ordered).
   - `subscription.reconcile` `{ userId | null, idempotencyKey }`, nightly at 03:17 UTC with
     `userId: null`; a user id reconciles one account. It reads RevenueCat's REST API with
     `REVENUECAT_API_KEY` and corrects `subscriptions`. Without a key the run is skipped and
     logged.
   - Both queues are defined in `BILLING_JOB_QUEUES` and join `JOB_QUEUES` in the change that
     adds their worker queue definitions, because the worker types its definitions as a record
     over every queue name.
7. **Entitlement exposure.** `GET /api/v1/me` gains `entitlements: { pro, status, expiresAt,
store }`. `pro` is true exactly for `active` and `grace_period`; `status: none` means no
   subscription row. The member is optional until the entitlement work package sends it on every
   profile response; clients read a missing member as no Pro.
8. **Statistics.** `GET /api/v1/me/stats` answers `tier: basic` (matches played, MVP count) for
   everyone and `tier: full` with an `advanced` block for Pro, decided by the server at request
   time.
9. **Configuration.** Web: `REVENUECAT_WEBHOOK_SECRET` (256-bit, required outside local). Worker:
   `REVENUECAT_API_KEY` (optional everywhere) and `REVENUECAT_API_BASE_URL` (default
   `https://api.revenuecat.com`; loopback http only locally, for a fake server). Mobile:
   `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` (`appl_…`) and `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
   (`goog_…`), public SDK keys, optional; without the platform's key the paywall reports Pro as
   unavailable.

## Consequences

- Database (Phase 5 migrations): `webhook_events` needs the normalized event columns of
  decision 5; `subscriptions` needs `store` and the time of the last applied event.
- The webhook and entitlement gates are verified with fixtures and a fake REST server only. No
  claim of a working purchase, renewal or reconciliation against RevenueCat is made until an
  account and keys exist.
- Deleting the RevenueCat subscriber "on request" (spec §6 item 21) versus at hard delete
  (ADR-0032) is an open owner decision and is not settled here.
- The authorization matrix gains rows for `GET me/stats` and `GET districts` through the Phase 3
  docs work package; until then the registry test lists them as pending.
