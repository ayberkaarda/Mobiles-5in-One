# ADR-0031: Billing, purchase linking and entitlements

- Status: Accepted (Play behaviour not verified, see "Not verified")
- Date: 2026-10-11
- Deciders: Ayberk (owner)

## Context

Spec story 9 sells **Çetele Pro** as a Google Play subscription (monthly and yearly) and says the
entitlement is enforced on the server through RTDN and the Play Developer API. Since Phase 1 the
`shops.plan` column (`FREE|PRO`) exists, is never writable by a client
([authorization matrix](../security/authorization-matrix.md) `PATCH shops/{id}`), and every limit
already reads it through `PlanLimits.of(plan)` ([ADR-0014](0014-ledger-model.md),
[ADR-0016](0016-sms-reminders-and-netgsm-client.md), [ADR-0017](0017-media-pipeline.md)). What is
missing is the path that moves a shop between the two plans, and the record of why.

There is no Play Console account, no service account and no licence tester
([ADR-0004](0004-portfolio-delivery-scope.md) G1, G2). The Play side is therefore built as a port
with a real HTTP adapter and a local fake, exactly as the integrity verifier
([ADR-0006](0006-integrity-verifier-and-local-adapters.md)).

The RTDN endpoint and its authentication are in [ADR-0032](0032-webhook-authentication.md); this
record says what a verified notification does.

## Options

- **Trust the device.** The app reports "purchased" and the server flips the plan. Rejected: spec
  item 17 forbids trusting anything but Play.
- **RTDN only.** The plan follows notifications and the app never calls the server. Rejected: a
  notification does not say which shop the purchase is for, and a lost notification would leave a
  paying owner on FREE.
- **Link plus RTDN plus re-verification (chosen).** The owner links the purchase token to the shop;
  the server verifies it with the Play Developer API, binds it to the shop, and from then on every
  notification and a periodic sweep re-read the state from Play.

## Decision

### Product

- One subscription product, id `cetele_pro` (`CETELE_PLAY_PRO_PRODUCT_ID`, default `cetele_pro`),
  with two base plans, `monthly` and `yearly`. Both grant the same `PRO` limits. The price and the
  Play Console set-up are outside this repository.
- "Priority sync" in spec story 9 has no server behaviour in the MVP: sync is already processed
  as it arrives, and there is no queue to prioritise. Marketing copy (Phase 5) does not promise it.

### Who may link

- `POST /v1/shops/{shopId}/billing/link` needs `BILLING_MANAGE`, which only `OWNER` holds. `STAFF`
  gets `403 forbidden` and a non-member `404 not_found`, the existing convention of
  [ADR-0007](0007-tenancy-and-permission-enforcement.md). No `billing.forbidden` code is added: the
  generic code already means "your role lacks this action" for every endpoint.
- `GET /v1/shops/{shopId}/billing` needs `SHOP_READ` (`OWNER` and `STAFF`): staff see the plan and
  limits that block them. The purchase token is never returned to anyone.

### Binding a purchase to a shop

- The app starts the purchase with
  `obfuscatedAccountId = lowercase_hex(SHA-256(UTF-8(shopId)))`, with `shopId` in canonical
  lowercase UUID text: exactly 64 characters, the Play limit. The server requires
  `externalAccountIdentifiers.obfuscatedExternalAccountId` of the verified purchase to equal the
  same value for the path shop. A purchase made for another shop, or without the identifier, is
  refused (`409 billing.token_in_use` and `422 billing.purchase_invalid` respectively).
- One purchase token belongs to at most one shop, for ever: `subscriptions.purchase_token_hash` is
  unique and a row is never moved to another shop. Re-using a token on another shop is
  `409 billing.token_in_use`, decided from the hash before Play is called.
- A shop has at most one **current** subscription row (partial unique index on `shop_id` where
  `superseded_at IS NULL`). Older rows stay as history with `superseded_at` and `replaced_by`.

### Tables (`V6__billing.sql`)

```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY,
    shop_id UUID REFERENCES shops (id) ON DELETE SET NULL,
    purchase_token_hash TEXT NOT NULL,
    purchase_token_enc BYTEA,
    product_id TEXT NOT NULL,
    base_plan_id TEXT,
    state TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    auto_renewing BOOLEAN NOT NULL DEFAULT false,
    test_purchase BOOLEAN NOT NULL DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    linked_by UUID REFERENCES users (id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ NOT NULL,
    last_verified_at TIMESTAMPTZ NOT NULL,
    last_notification_type INTEGER,
    revoked_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ,
    replaced_by UUID REFERENCES subscriptions (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_purchase_token_hash_key UNIQUE (purchase_token_hash),
    CONSTRAINT subscriptions_purchase_token_hash_format CHECK (purchase_token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT subscriptions_state_check CHECK (state IN ('PENDING', 'ACTIVE', 'IN_GRACE_PERIOD', 'ON_HOLD', 'PAUSED',
        'CANCELED', 'EXPIRED', 'REVOKED', 'REPLACED', 'ORPHANED')),
    CONSTRAINT subscriptions_product_id_length CHECK (char_length(product_id) BETWEEN 1 AND 100),
    CONSTRAINT subscriptions_base_plan_id_length CHECK (base_plan_id IS NULL OR char_length(base_plan_id) BETWEEN 1 AND 100),
    CONSTRAINT subscriptions_revoked_has_time CHECK (state <> 'REVOKED' OR revoked_at IS NOT NULL),
    CONSTRAINT subscriptions_replaced_is_superseded CHECK (state <> 'REPLACED' OR superseded_at IS NOT NULL)
);
CREATE UNIQUE INDEX subscriptions_one_current_per_shop ON subscriptions (shop_id) WHERE superseded_at IS NULL AND shop_id IS NOT NULL;
CREATE INDEX subscriptions_reverify_idx ON subscriptions (expires_at) WHERE superseded_at IS NULL;

CREATE TABLE webhook_events (
    id UUID PRIMARY KEY,
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    notification_type INTEGER,
    purchase_token_hash TEXT,
    purchase_token_enc BYTEA,
    status TEXT NOT NULL,
    outcome TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT webhook_events_provider_check CHECK (provider IN ('PLAY_RTDN')),
    CONSTRAINT webhook_events_provider_event_key UNIQUE (provider, event_id),
    CONSTRAINT webhook_events_event_id_length CHECK (char_length(event_id) BETWEEN 1 AND 128),
    CONSTRAINT webhook_events_status_check CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
    CONSTRAINT webhook_events_token_hash_format CHECK (purchase_token_hash IS NULL OR purchase_token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT webhook_events_outcome_length CHECK (outcome IS NULL OR char_length(outcome) <= 64),
    CONSTRAINT webhook_events_attempts_nonnegative CHECK (attempts >= 0),
    CONSTRAINT webhook_events_done_has_no_token CHECK (status = 'RECEIVED' OR purchase_token_enc IS NULL)
);
CREATE INDEX webhook_events_pending_idx ON webhook_events (next_attempt_at) WHERE status = 'RECEIVED';
```

- `purchase_token_hash` is `lowercase_hex(SHA-256(UTF-8(token)))`. The raw token is needed again
  (re-verification, acknowledgement), so it is also kept as `purchase_token_enc`: AES-256-GCM,
  byte layout `0x01 || nonce(12) || ciphertext || tag(16)`, additional data
  `UTF-8("cetele.billing.token.v1")`, key `CETELE_BILLING_TOKEN_KEY` (standard Base64 of exactly 32
  bytes). An empty key is allowed only through the local-only guard of ADR-0006 as the stand-in
  `ephemeral-billing-token-key` (random per start; a restart makes stored tokens unreadable, which
  is accepted locally). A token is never logged, never returned and never written in clear text.
- `Subscription` is `TenantScoped`; every repository method takes `shopId`
  ([ADR-0012](0012-architecture-rules-and-test-strategy.md) rules 1 and 2). Lookups that start from
  a token hash, and the sweeps across shops, use an `Index` component on the `EntityManager` with
  JPQL, as `StatementLinkIndex` does ([ADR-0015](0015-statement-links-and-public-page.md)). No
  native SQL and no plain JDBC in `billing`.
- The `shops` row of the path shop, read with `PESSIMISTIC_WRITE`, is the billing lock of a shop.
  `shops.plan` is written with a JPQL update in the billing repository; `Shop.kt` is not changed.
- Shop and account deletion need no change to the deletion executor to stay correct: the foreign
  keys `ON DELETE SET NULL` clear `shop_id` and `linked_by`, so the
  [ADR-0018](0018-account-and-shop-deletion.md) gate test keeps finding no row for the shop or the
  user. The billing sweep then marks every row with `shop_id IS NULL` as `ORPHANED` and clears
  `purchase_token_enc`. The hash stays, so the token can never be linked again. Writing `ORPHANED`
  inside the executor transaction is a later wiring step (handoff 002).

### States and the plan

The state stored is the Play state, mapped from `subscriptionsv2.subscriptionState`, plus three
of our own:

| Play `subscriptionState`                       | `subscriptions.state` | Entitles PRO                     |
| ---------------------------------------------- | --------------------- | -------------------------------- |
| `SUBSCRIPTION_STATE_PENDING`                   | `PENDING`             | no                               |
| `SUBSCRIPTION_STATE_ACTIVE`                    | `ACTIVE`              | yes, until `expires_at` + 1 hour |
| `SUBSCRIPTION_STATE_IN_GRACE_PERIOD`           | `IN_GRACE_PERIOD`     | yes, until `expires_at` + 1 hour |
| `SUBSCRIPTION_STATE_ON_HOLD`                   | `ON_HOLD`             | no                               |
| `SUBSCRIPTION_STATE_PAUSED`                    | `PAUSED`              | no                               |
| `SUBSCRIPTION_STATE_CANCELED`                  | `CANCELED`            | yes, until `expires_at` exactly  |
| `SUBSCRIPTION_STATE_EXPIRED`                   | `EXPIRED`             | no                               |
| `SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED` | `EXPIRED`             | no                               |
| `SUBSCRIPTION_STATE_UNSPECIFIED`               | not stored            | `422 billing.purchase_invalid`   |
| (refund or revocation, see below)              | `REVOKED`             | no, sticky                       |
| (replaced by a newer token)                    | `REPLACED`            | no, sticky                       |
| (shop deleted)                                 | `ORPHANED`            | no, sticky                       |

- `expires_at` is the latest `lineItems[].expiryTime` of the line item whose `productId` is the
  Pro product; `base_plan_id` is its `offerDetails.basePlanId`; `auto_renewing` is
  `autoRenewingPlan.autoRenewEnabled`; `test_purchase` is the presence of `testPurchase`.
- **Grace period** is Play's: `IN_GRACE_PERIOD` keeps PRO. The server adds no grace of its own
  beyond the one-hour leeway that covers a renewal whose notification is late.
- **Account hold** and **pause** are FREE immediately; a later `RECOVERED` or `RESTARTED`
  notification brings PRO back after re-verification.
- **Cancellation** keeps PRO until the paid period ends, then the sweep turns the row `EXPIRED`.
- **Refund and revocation**: notification type 12 (`SUBSCRIPTION_REVOKED`) or a
  `voidedPurchaseNotification` for the token sets `REVOKED` with `revoked_at`, whatever the API
  says afterwards. A revoked token never entitles again.
- `shops.plan` is derived and never set directly: `PRO` when the current row of the shop entitles
  at that instant, else `FREE`. `EntitlementService.recompute(shopId, now)` runs under the billing
  lock after every link, every processed notification and every sweep change, and logs
  `plan changed shop=<id> from=<p> to=<p> reason=<link|rtdn|sweep>` when it differs.

### What a downgrade does to existing data

Nothing is deleted, hidden or made read-only. A downgrade only lowers the limits that are checked
when something new is created:

- Customers: a shop above 100 live customers keeps all of them, can read, update and delete them
  and can write entries for them. Creating a new customer is `plan.customer_limit` (per operation in
  sync, [ADR-0014](0014-ledger-model.md)) until the live count is below 100.
- Photos: existing photos stay readable. New presigns count this month's `READY` and `PENDING`
  objects against 200 (`409 plan.photo_limit`, [ADR-0017](0017-media-pipeline.md)).
- SMS: the month row keeps its `used` count; a shop that already used more than 30 in the month
  gets `429 sms.quota_exceeded` for the rest of the month.
- An upgrade raises the limits at the next request; counters are not reset.

### Link flow

`POST /v1/shops/{shopId}/billing/link`, body `{"productId": "cetele_pro", "purchaseToken": "..."}`:

1. `@PreAuthorize("@perm.can(#shopId, 'BILLING_MANAGE')")`, then rate bucket `billing.link.user`
   (10 per 10 minutes per user).
2. Validation: `productId` 1 to 100 characters `^[a-z0-9][a-z0-9._]*$` and equal to the configured
   product (else `422 validation.failed`, field `productId`, code `out_of_range`);
   `purchaseToken` 1 to 4096 characters `^[A-Za-z0-9._-]+$`.
3. Hash lookup through the index. A row of this shop: re-verify and answer 200 (idempotent repeat
   link, also used by "restore purchases"). A row of another shop or an `ORPHANED` row:
   `409 billing.token_in_use`.
4. Play Developer API `subscriptionsv2.get`. Timeout, transport error or 5xx:
   `503 billing.unavailable` with `Retry-After: 30`. 400, 404 or 410: `422 billing.purchase_invalid`.
5. Checks on the answer: Pro line item present (else `purchase_invalid`); obfuscated account id
   equal to the shop value (absent: `purchase_invalid`; different: `token_in_use`); state not
   `UNSPECIFIED`; a **new** token whose state is `EXPIRED` is `purchase_invalid` (dead tokens are
   not stored). `PENDING` is stored and leaves the shop FREE.
6. Under the billing lock: when `linkedPurchaseToken` hashes to the current row of this shop, that
   row becomes `REPLACED` (`superseded_at`, `replaced_by`); when it hashes to a row of another
   shop, `409 billing.token_in_use`. Otherwise, a current row that still entitles gives
   `409 billing.already_subscribed`; a current row that does not entitle is superseded without a
   state change. The new row is inserted; a unique violation from a concurrent link is re-read
   and handled as step 3. The plan is recomputed.
7. After commit: when `acknowledgementState` is `ACKNOWLEDGEMENT_STATE_PENDING` and the state is
   `ACTIVE` or `IN_GRACE_PERIOD`, the server acknowledges
   (`purchases.subscriptions.acknowledge`). A failure is logged and retried by the sweep; Play
   refunds an unacknowledged purchase after three days. The app never acknowledges.
8. Response `200` with the billing state (wire shape in
   [handoff 002](../handoffs/server-to-android-002-phase4-contract.md)).

Log lines carry `outcome=<linked|refreshed|replaced|refused>`, the shop id and the state, never the
token or its hash.

### Notification processing

An authenticated RTDN ([ADR-0032](0032-webhook-authentication.md)) is stored as a
`webhook_events` row (`RECEIVED`) and answered 200 before any Play call. The processor:

- runs right after the commit on a task executor and every 30 seconds as a scheduled job, both
  under one `JobLocks` lock (`billing.rtdn`) and behind `CETELE_JOBS_ENABLED`; tests call it
  directly;
- ignores, with `status = IGNORED` and an outcome, a package other than `CETELE_PLAY_PACKAGE_NAME`
  (`foreign_package`), a `testNotification` (`test`), a `oneTimeProductNotification`
  (`one_time_product`) and a subscription id other than the Pro product (`foreign_product`);
- for a `subscriptionNotification` of any type, **never uses the type to decide the state**: it
  re-reads the token through `subscriptionsv2.get` and applies the table above, except type 12,
  which sets `REVOKED`;
- for a `voidedPurchaseNotification` whose token is known, sets `REVOKED`;
- for a token with no row: reads it from Play; when `linkedPurchaseToken` matches the current row of
  a shop and the obfuscated account id matches that shop, the new token replaces it exactly as in
  link step 6; otherwise `IGNORED` with `unknown_token` (the owner's link call will verify it);
- retries a Play failure with `attempts` and `next_attempt_at` after 1, 5, 15, 60 and 360
  minutes, then `FAILED` with a warning log;
- clears `purchase_token_enc` whenever the row leaves `RECEIVED`.

### Sweep

`BillingSweeper`, hourly, behind the job switch and a `JobLocks` lock (`billing.sweep`):

- re-verifies current rows that are `ACTIVE`, `IN_GRACE_PERIOD` or `CANCELED` with `expires_at`
  in the past, and any current non-sticky row with `last_verified_at` older than 24 hours;
- retries acknowledgement of rows with `acknowledged_at IS NULL` in an entitling state;
- marks rows with `shop_id IS NULL` as `ORPHANED` and clears their encrypted token;
- deletes `webhook_events` rows `PROCESSED` or `IGNORED` older than 30 days and `FAILED` older than
  90 days.

### Play Developer API port

```kotlin
interface PlayDeveloperApi {
    fun getSubscription(purchaseToken: String): PlaySubscriptionResult
    fun acknowledge(productId: String, purchaseToken: String): PlayAckResult
}
sealed interface PlaySubscriptionResult {
    data class Found(val purchase: PlaySubscriptionPurchase) : PlaySubscriptionResult
    data object NotFound : PlaySubscriptionResult      // 400, 404, 410
    data class Unavailable(val reason: String) : PlaySubscriptionResult // timeout, transport, 5xx, 401/403 from Google
}
```

`PlaySubscriptionPurchase` holds `subscriptionState`, `acknowledgementState`, `linkedPurchaseToken`,
`obfuscatedExternalAccountId`, `testPurchase` and the line items (`productId`, `expiryTime`,
`basePlanId`, `autoRenewEnabled`). Package `app.cetele.server.billing.play`.

- **`HttpPlayDeveloperApi`** uses `RestClient` (5 s connect, 10 s read, no retry inside the call):
  `GET https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{packageName}/purchases/subscriptionsv2/tokens/{token}`
  and
  `POST .../applications/{packageName}/purchases/subscriptions/{productId}/tokens/{token}:acknowledge`.
  The access token comes from `GoogleServiceAccountTokens`: the service account JSON of
  `CETELE_PLAY_SERVICE_ACCOUNT_JSON` (`client_email`, `private_key`, `token_uri`), an RS256
  assertion signed with Nimbus (already a dependency) for the scope
  `https://www.googleapis.com/auth/androidpublisher`, exchanged at `token_uri` with
  `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, cached until 60 seconds before expiry.
  No Google client library is added. The same token provider will serve the Play Integrity client.
- **`FakePlayDeveloperApi`** (stand-in `fake-play-developer-api`) understands tokens
  `fake.sub.<state>.<shopId>` with an optional suffix `.<[a-z0-9]{1,16}>` so tests can make
  distinct tokens. `<shopId>` is a canonical lowercase UUID and becomes the obfuscated account id
  (its SHA-256 as above). States:

  | `<state>`      | Result                                                  |
  | -------------- | ------------------------------------------------------- |
  | `active`       | `ACTIVE`, expiry now + 30 days, acknowledgement pending |
  | `grace`        | `IN_GRACE_PERIOD`, expiry now + 3 days                  |
  | `canceled`     | `CANCELED`, expiry now + 10 days, not auto-renewing     |
  | `hold`         | `ON_HOLD`, expiry now - 1 day                           |
  | `paused`       | `PAUSED`, expiry now - 1 day                            |
  | `expired`      | `EXPIRED`, expiry now - 1 day                           |
  | `pending`      | `PENDING`, no expiry                                    |
  | `otherproduct` | `ACTIVE` for product `cetele_other`                     |
  | `unknown`      | `NotFound`                                              |
  | `unavailable`  | `Unavailable("fake")`                                   |

  Anything else is `NotFound`. Tests can also register an exact purchase for a token
  (`put(token, purchase)`), change its state, and read the acknowledgements made. Every fake
  purchase has `testPurchase` set.

### `CETELE_BILLING_MODE`

`fake` or `play`. Empty means `fake` in `local` and `test` and a startup error elsewhere, as
`CETELE_INTEGRITY_MODE`. `play` needs the service account, the token key and both RTDN values and
otherwise fails at startup with
`CETELE_BILLING_MODE=play needs CETELE_PLAY_SERVICE_ACCOUNT_JSON, CETELE_BILLING_TOKEN_KEY, CETELE_PLAY_RTDN_AUDIENCE and CETELE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`.
`fake` outside `local` and `test` fails through `LocalOnlyAdapterGuard`.

### Configuration

| Key                                | Property                              | Default              |
| ---------------------------------- | ------------------------------------- | -------------------- |
| `CETELE_BILLING_MODE`              | `cetele.billing.mode`                 | empty                |
| `CETELE_BILLING_TOKEN_KEY`         | `cetele.billing.token-key`            | empty                |
| `CETELE_PLAY_PRO_PRODUCT_ID`       | `cetele.billing.product-id`           | `cetele_pro`         |
| `CETELE_PLAY_SERVICE_ACCOUNT_JSON` | `cetele.play.service-account-json`    | empty                |
| `CETELE_PLAY_PACKAGE_NAME`         | `cetele.play.package-name` (existing) | `app.cetele.android` |

The RTDN keys are in [ADR-0032](0032-webhook-authentication.md).

### Error codes (appended to `ProblemCode`)

| Code                         | Status | Used for                                                                        |
| ---------------------------- | ------ | ------------------------------------------------------------------------------- |
| `billing.purchase_invalid`   | 422    | Play does not know the token, wrong product, no account id, dead token          |
| `billing.token_in_use`       | 409    | token linked to another shop, orphaned, or bought for another shop              |
| `billing.already_subscribed` | 409    | the shop already has an entitling subscription that this token does not replace |
| `billing.unavailable`        | 503    | Play could not be asked; `Retry-After: 30`                                      |

The existing `plan.customer_limit`, `plan.photo_limit` and `sms.quota_exceeded` stay the codes that
tell a client a limit was hit.

## Not verified

- The `subscriptionsv2` and `acknowledge` request and response shapes, the error statuses, the
  notification type numbers, the service-account token exchange and the 64-character limit of
  `obfuscatedAccountId` were written from Google's public documentation and are **not verified
  against the live API** (`not exercised: no Play Console account`, ADR-0004 G1). Fixtures say so.
- That Play refunds an unacknowledged subscription after three days is documented behaviour, not
  observed here.

## Consequences

- The plan can only become `PRO` through a verified token bound to the shop; the request body,
  the device and the notification body alone never change it.
- A paying owner whose notification is lost is corrected by the next link call or by the hourly
  sweep.
- A deleted shop's subscription keeps billing in Play until the owner cancels it there; the app
  shows the Play instructions before deletion (spec item 21) and the row becomes `ORPHANED`.
- Required tests (names are the contract, the billing worker may add more): `BillingLinkTest`
  (`owner links an active purchase and the shop becomes pro`, `staff gets forbidden and a stranger
not found`, `repeat link is idempotent`, `token of another shop is refused before play is called`,
  `purchase made for another shop is token in use`, `unknown token is purchase invalid`,
  `play unavailable answers 503 with retry after`, `pending purchase stays free`,
  `replacement through linked purchase token supersedes the current row`,
  `second subscription while entitled is already subscribed`), `EntitlementTest` (one test per row
  of the state table, the one-hour leeway, `revoked is sticky`), `DowngradeTest` (`over limit
customers stay readable and writable but no new customer`, `photo and sms limits drop at once`),
  `RtdnProcessingTest`, `BillingSweeperTest`, `HttpPlayDeveloperApiTest` (fixtures labelled "shape
  per provider documentation, not verified against the live API"), `BillingConfigurationTest`,
  `V6BillingSchemaTest`, `BillingLogSampleTest` (no token or hash in logs).
