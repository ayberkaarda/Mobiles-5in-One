# Handoff server-to-android-002: Phase 4 contract

- From: server (written by lead as the Phase 4 contract)
- To: android, and the Phase 4 server work areas listed in "Work split"
- Status: open (no Phase 4 code exists yet; nothing here was exercised, `not exercised: contract
written before the implementation`)
- Date: 2026-10-11

## What is needed

Phase 4 (spec section 10, items 17 and 18) is built by parallel workers on disjoint paths. This
file is the single list of wire shapes, file ownership, migration numbers and shared-file rules,
so nobody guesses. The reasons are in
[ADR-0031](../adr/0031-billing-purchase-linking-and-entitlements.md) (billing and entitlements),
[ADR-0032](../adr/0032-webhook-authentication.md) (webhooks) and
[ADR-0033](../adr/0033-admin-console-and-audit-log.md) (admin console and audit). The
machine-readable form is [docs/api/openapi.json](../api/openapi.json), updated ahead of the code
([docs/api/README.md](../api/README.md)).

## Work split (Wave 1)

Every worker branches from the same `main`, owns only the paths in its row (the admin rows under
`templates/` and `static/` are delegated from the `web` owner for this phase), and adds tests under the
matching `server/src/test/kotlin/...` or `android/.../src/test/...` path. Paths are relative to
`cetele/`.

| Worker          | Owns (exclusive write)                                                                                                                                                                                                                                                                                                             | Flyway                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| billing         | `server/src/main/kotlin/app/cetele/server/billing/**` (including `billing/webhook/**` for RTDN and `billing/play/**` for the Play port), `server/src/test/kotlin/app/cetele/server/billing/**`                                                                                                                                     | `V6__billing.sql`              |
| sms-dlr         | `server/src/main/kotlin/app/cetele/server/reminders/delivery/**`, `server/src/test/kotlin/app/cetele/server/reminders/delivery/**`                                                                                                                                                                                                 | `V7__sms_delivery_reports.sql` |
| admin           | `server/src/main/kotlin/app/cetele/server/admin/**` (controllers in `admin/web/**`), `server/src/test/kotlin/app/cetele/server/admin/**`, `server/src/main/resources/templates/admin/**`, `server/src/main/resources/static/assets/admin/**`, `server/build.gradle.kts` and `server/gradle/libs.versions.toml` (dependencies only) | `V8__admin.sql`                |
| android-billing | `android/feature/billing/**`; new files only in `android/core/network`: `api/BillingApi.kt`, `dto/billing/**`, `di/BillingApiModule.kt` and their tests; `android/gradle/libs.versions.toml` (Play Billing entry only)                                                                                                             | none                           |
| app-wiring+docs | Wave 2, after the four branches above are merged; list below                                                                                                                                                                                                                                                                       | none                           |

Migration files live in `server/src/main/resources/db/migration/`; each worker creates only its own
file. The numbers are fixed so Flyway versions never collide after the merge: `V6` billing, `V7`
sms-dlr, `V8` admin. No migration depends on another Phase 4 migration. A local database that ran
`V7` or `V8` from a branch before `V6` existed fails Flyway validation after the merge; drop the
local volume (`docker compose down -v`). Testcontainers databases are always fresh.

### Shared files: exact insertion points

These files are touched by more than one worker. Each change is an insertion after the named
anchor line, so the hunks are separated by unchanged lines and merge without conflict. Nothing else
in these files is edited.

| File                                                     | billing                                                                                                                             | sms-dlr                                                                          | admin                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `server/.../web/problem/ProblemCode.kt`                  | after `PLAN_PHOTO_LIMIT(...)`: the four `BILLING_*` entries; after `SHOP_DELETION_PENDING(...)`: the `WEBHOOK_UNAUTHENTICATED` line | after `SHOP_DELETION_PENDING(...)`: the identical `WEBHOOK_UNAUTHENTICATED` line | nothing (the console is HTML)                                                                         |
| `server/.../auth/ratelimit/RateLimiter.kt` (`RateLimit`) | after `MEDIA_DOWNLOAD_USER(...)`: `BILLING_LINK_USER`, `WEBHOOK_RTDN_IP`                                                            | after `STATEMENT_PAGE_IP(...)`: `WEBHOOK_DLR_IP`                                 | after `OTP_VERIFY_IP(...)`: `ADMIN_LOGIN_IP`                                                          |
| `server/src/main/resources/application.yml`              | after the default-document line `path-style: ${CETELE_S3_PATH_STYLE:true}`: the `billing:` and `play:` blocks                       | after `msgheader: ${CETELE_NETGSM_MSGHEADER:}`: the `dlr:` block under `sms:`    | after `trusted-proxies: ${CETELE_TRUSTED_PROXIES:}` of `client-ip:`: the `admin:` and `audit:` blocks |
| `server/src/test/.../arch/ArchitectureTest.kt`           | add `"..billing.web.."` to rule 4 (`tenancyHandlersArePreAuthorized`)                                                               | nothing                                                                          | nothing (its boundary rule lives in its own test)                                                     |

The `WEBHOOK_UNAUTHENTICATED` line is byte-identical in both branches, so git merges it as one
change:

```kotlin
    WEBHOOK_UNAUTHENTICATED("webhook.unauthenticated", HttpStatus.UNAUTHORIZED, "Webhook authentication failed"),
```

Billing entries:

```kotlin
    BILLING_PURCHASE_INVALID("billing.purchase_invalid", HttpStatus.UNPROCESSABLE_CONTENT, "Purchase is not valid"),
    BILLING_TOKEN_IN_USE("billing.token_in_use", HttpStatus.CONFLICT, "Purchase belongs to another shop"),
    BILLING_ALREADY_SUBSCRIBED("billing.already_subscribed", HttpStatus.CONFLICT, "Shop already has a subscription"),
    BILLING_UNAVAILABLE("billing.unavailable", HttpStatus.SERVICE_UNAVAILABLE, "Purchase verification unavailable"),
```

Rate limits:

```kotlin
    BILLING_LINK_USER("billing.link.user", 10, Duration.ofMinutes(10)),
    WEBHOOK_RTDN_IP("webhook.rtdn.ip", 600, Duration.ofMinutes(1)),
    WEBHOOK_DLR_IP("webhook.dlr.ip", 300, Duration.ofMinutes(1)),
    ADMIN_LOGIN_IP("admin.login.ip", 20, Duration.ofMinutes(10)),
```

`application.yml` blocks (two-space indent under `cetele:`; `dlr:` sits under `sms:`):

```yaml
billing:
  mode: ${CETELE_BILLING_MODE:}
  token-key: ${CETELE_BILLING_TOKEN_KEY:}
  product-id: ${CETELE_PLAY_PRO_PRODUCT_ID:cetele_pro}
play:
  service-account-json: ${CETELE_PLAY_SERVICE_ACCOUNT_JSON:}
  rtdn:
    audience: ${CETELE_PLAY_RTDN_AUDIENCE:}
    service-account-email: ${CETELE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL:}
    jwks-url: ${CETELE_PLAY_RTDN_JWKS_URL:https://www.googleapis.com/oauth2/v3/certs}
```

```yaml
dlr:
  secret: ${CETELE_SMS_DLR_SECRET:}
  previous-secret: ${CETELE_SMS_DLR_PREVIOUS_SECRET:}
  allowed-ips: ${CETELE_SMS_DLR_ALLOWED_IPS:}
```

```yaml
admin:
  totp-key: ${CETELE_ADMIN_TOTP_KEY:}
  bootstrap-email: ${CETELE_ADMIN_BOOTSTRAP_EMAIL:}
  bootstrap-password: ${CETELE_ADMIN_BOOTSTRAP_PASSWORD:}
audit:
  ip-key: ${CETELE_AUDIT_IP_KEY:}
```

`cetele.play.package-name` keeps its existing binding from `CETELE_PLAY_PACKAGE_NAME`; the `play:`
block must not redefine it. `SecurityConfig.kt`, `ShopLocks.kt`, `Shop.kt`, `Reminder.kt`,
`SmsGateway.kt` and `DeletionExecutor.kt` are not edited in Wave 1: each new area declares its own
`SecurityFilterChain` (`@Order(10)` admin, `@Order(20)` RTDN, `@Order(21)` DLR), locks the
`shops` row itself, and writes through JPQL in its own package.

### Names that springdoc turns into the contract

| Kind               | Name                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Billing controller | `app.cetele.server.billing.web.BillingController`, methods `billingState` and `linkPurchase` |
| RTDN controller    | `app.cetele.server.billing.webhook.PlayRtdnWebhookController`, method `receivePlayRtdn`      |
| DLR controller     | `app.cetele.server.reminders.delivery.SmsDeliveryWebhookController`, method `receiveSmsDlr`  |
| DTOs               | `LinkPurchaseRequest`, `BillingState`, `PlanLimitsView`, `PlanUsageView`, `SubscriptionView` |

### Wave 2: app-wiring and docs

Done after the merge, in one branch, because each item crosses a Wave 1 boundary:

1. `DeletionExecutor`: set `subscriptions.state = ORPHANED` and clear the encrypted token inside the
   shop deletion transaction (the foreign key and the billing sweep already make it correct within
   an hour); null `audit_logs.actor_id` and `target_id` that name the deleted user or shop; write
   `ACCOUNT_DELETION_COMPLETED` and `SHOP_DELETION_COMPLETED` audit rows; extend the
   `AccountDeletionTest` gate with an admin action on the user and a linked subscription.
2. Admin shop page: subscription state (product, base plan, state, expiry, test flag; never the
   token or its hash).
3. Real `PlayIntegrityVerifier` (`CETELE_INTEGRITY_MODE=play`) on billing's
   `GoogleServiceAccountTokens` ([ADR-0006](../adr/0006-integrity-verifier-and-local-adapters.md)).
4. Android: navigation to the billing screen from settings and from the `plan.*` limit dialogs,
   and the `ProblemCodes` constants in `core/network`.
5. Docs outside the lead paths: `docs/ops/env.md`, `.env.example`, `docker-compose.yml` keys; the
   authorization matrix (section 4.3 billing rows, 4.4 webhook rows, section 5 routes, D-9 and D-10
   settled, `webhook.unauthenticated` in section 3), the threat model 4.9 and A9, and the
   verification matrix rows 17 and 18 by the security owner; `openapi.json` refreshed from the
   export.

## Billing wire contract

### `GET /v1/shops/{shopId}/billing`

`SHOP_READ` (OWNER and STAFF). `200`:

```json
{
  "plan": "PRO",
  "limits": { "customers": null, "photosPerMonth": 2000, "smsPerMonth": 500 },
  "usage": { "month": "2026-10", "customers": 137, "photos": 12, "sms": 3 },
  "subscription": {
    "productId": "cetele_pro",
    "basePlanId": "monthly",
    "state": "ACTIVE",
    "entitled": true,
    "expiresAt": "2026-11-11T09:30:00Z",
    "autoRenewing": true,
    "testPurchase": false,
    "linkedAt": "2026-10-11T09:30:05Z"
  }
}
```

- `plan` is `FREE` or `PRO`, the same value as `ShopView.plan`.
- `limits.customers` is `null` for unlimited (PRO); FREE is `100`, `200`, `30`.
- `usage.month` is `yyyy-MM` in `Europe/Istanbul`. `customers` counts live customers, `photos`
  this month's `READY` and `PENDING` uploads, `sms` this month's reminder quota use (the numbers the
  limits are checked against).
- `subscription` is the current row of the shop or `null` when there is none. `state` is one of
  `PENDING`, `ACTIVE`, `IN_GRACE_PERIOD`, `ON_HOLD`, `PAUSED`, `CANCELED`, `EXPIRED` or
  `REVOKED`; `REPLACED` and `ORPHANED` are never current. `entitled` says whether it
  gives PRO at this instant. `expiresAt` is `null` while `PENDING`. The purchase token is never
  part of any response.

### `POST /v1/shops/{shopId}/billing/link`

`BILLING_MANAGE` (OWNER only). Body:

```json
{ "productId": "cetele_pro", "purchaseToken": "<Purchase.purchaseToken>" }
```

`productId` 1 to 100 characters `^[a-z0-9][a-z0-9._]*$` and equal to the server's product;
`purchaseToken` 1 to 4096 characters `^[A-Za-z0-9._-]+$`; unknown properties are refused.
`200` with the same body as `GET billing`. Linking the same token again is safe and returns the
fresh state.

| Status | `code`                       | Meaning for the app                                                         |
| ------ | ---------------------------- | --------------------------------------------------------------------------- |
| 403    | `forbidden`                  | caller is STAFF; hide the purchase button for STAFF                         |
| 404    | `not_found`                  | not a member, or the shop is gone                                           |
| 409    | `billing.token_in_use`       | token belongs to another shop, or was bought for another shop; do not retry |
| 409    | `billing.already_subscribed` | the shop already has an entitling subscription; refresh the state           |
| 422    | `billing.purchase_invalid`   | Play does not confirm the purchase; do not retry this token                 |
| 422    | `validation.failed`          | malformed body (`errors[]` with field codes)                                |
| 429    | `rate_limited`               | `Retry-After` seconds                                                       |
| 503    | `billing.unavailable`        | Play could not be asked; retry after `Retry-After` (30) with backoff        |

Existing limit codes stay as they are: `plan.customer_limit` (409, also per sync operation),
`plan.photo_limit` (409), `sms.quota_exceeded` (429 with `Retry-After` to the next Istanbul month).
For an OWNER they open the Pro offer; for STAFF they show "Dükkân sahibi Çetele Pro'ya geçebilir".

Turkish texts for the new codes (the app owns the final copy):

| Code                         | Text                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| `billing.purchase_invalid`   | Satın alma doğrulanamadı.                                       |
| `billing.token_in_use`       | Bu abonelik başka bir dükkâna ait.                              |
| `billing.already_subscribed` | Bu dükkânın zaten etkin bir Çetele Pro aboneliği var.           |
| `billing.unavailable`        | Satın alma şu an doğrulanamıyor; biraz sonra yeniden denenecek. |
| `forbidden` (billing screen) | Aboneliği yalnızca dükkân sahibi yönetebilir.                   |

## Android Play Billing flow

Library: Play Billing Library 7 or later (`com.android.billingclient:billing-ktx`), added by the
android-billing worker to `android/gradle/libs.versions.toml`. Product `cetele_pro`
(`ProductType.SUBS`), base plans `monthly` and `yearly`.

1. **Who sees what.** The billing screen reads `GET billing` for the active shop. OWNER sees the
   offers when `subscription` is `null` or not `entitled`, and "Aboneliği yönet" when it is.
   STAFF sees the plan, limits and usage only.
2. **Offers.** `queryProductDetails` for `cetele_pro`; show both base plans with Play's formatted
   prices. No price is hard-coded.
3. **Purchase.** `launchBillingFlow` with the chosen offer token and
   `setObfuscatedAccountId(lowercase_hex(SHA-256(UTF-8(shopId))))`, `shopId` in canonical lowercase
   UUID text. Test vector: shop `01928c3e-5f6a-7b8c-9d0e-1f2a3b4c5d6e` gives
   `775ddbc0c97c6683bb78cafdffea51471b53ceb7fbd89993ed36e130430db621`. Without it the server refuses
   the purchase.
4. **Link.** For a purchase with `purchaseState == PURCHASED` whose
   `accountIdentifiers.obfuscatedAccountId` equals the value of the current shop, call
   `POST billing/link`. A `PENDING` purchase is shown as "Ödeme bekleniyor" and linked when the
   update to `PURCHASED` arrives.
5. **Do not acknowledge on the device.** The server acknowledges after it has verified and bound
   the token. The app never calls `acknowledgePurchase`.
6. **Retry.** On `503`, a network error or a timeout, enqueue unique WorkManager work
   `billing-link-<first 16 hex of SHA-256(token)>` (network constraint, exponential backoff from 30
   seconds, keep the token only in the work's input data, which lives in app-private storage). Play
   refunds a purchase that is not acknowledged within three days, so the retry must survive restarts.
   `409` and `422` are final: show the text, stop retrying.
7. **Restore.** On app start and when the billing screen opens, `queryPurchasesAsync(SUBS)`; for
   each `PURCHASED` purchase whose obfuscated account id matches a shop the user OWNS, call link
   (idempotent).
8. **After success.** Refresh `GET shops/{id}` and `GET billing`; the plan in the shop switcher and
   the limit dialogs follow `plan`.
9. **Plan switch.** Monthly to yearly (or back) uses `SubscriptionUpdateParams` with the old
   purchase token; the new token is linked as usual and the server replaces the old row through
   `linkedPurchaseToken`.
10. **Manage and cancel.** "Aboneliği yönet" opens
    `https://play.google.com/store/account/subscriptions?sku=cetele_pro&package=app.cetele.android`.
    Shop or account deletion screens show that the Play subscription is not cancelled by deletion
    (spec item 21) and link to the same page.
11. **Logging.** Never log the purchase token, the order id or the obfuscated id; Timber release
    tree logs codes only.

### Fake mode for the emulator

No Play account exists ([ADR-0004](../adr/0004-portfolio-delivery-scope.md) G1), so debug builds
can use a fake billing gateway:

- `cetele.billingMode` in `android/local.properties` (`fake` or `play`), read into
  `BuildConfig.BILLING_MODE` of `feature/billing`. Debug defaults to `fake`; release is always
  `play` and the fake classes live in `src/debug` only, so they are not in a release build.
- The fake "purchase" produces the token `fake.sub.active.<shopId>` (or another state of the
  grammar in ADR-0031, for example `fake.sub.pending.<shopId>`) and calls link exactly as the real
  flow. The server must run with `CETELE_BILLING_MODE=fake` (the default in `local`).
- Server token hash test vector: `fake.sub.active.01928c3e-5f6a-7b8c-9d0e-1f2a3b4c5d6e` hashes to
  `a8bacd564eb7c299facdf0c5365c05f9b5179a69b2ce48f8f537838bb3755c83`.

### Required Android tests

`BillingStateMapperTest` (every `state`, `null` customers limit), `ObfuscatedAccountIdTest` (the
vector above), `BillingLinkWorkerTest` (503 retries, 409 and 422 stop), `BillingViewModelTest`
(OWNER and STAFF screens, pending, restore), `BillingApiTest` (wire shapes of this file and every
error code), and a Paparazzi or Compose test of the billing screen in both roles.

## Webhooks and admin (no Android change)

- `POST /v1/webhooks/play-rtdn` and `POST /v1/webhooks/sms-dlr`: headers, signatures, test vector,
  status codes and storage in [ADR-0032](../adr/0032-webhook-authentication.md). They answer `200`
  with an empty body, `401 webhook.unauthenticated`, `413 payload_too_large`, `422` (DLR only) and
  `429`.
- The admin console is `/admin/**`, HTML only, never reachable with a `/v1` token
  ([ADR-0033](../adr/0033-admin-console-and-audit-log.md)).

## Configuration keys added in Phase 4

`CETELE_BILLING_MODE`, `CETELE_BILLING_TOKEN_KEY`, `CETELE_PLAY_PRO_PRODUCT_ID`,
`CETELE_PLAY_SERVICE_ACCOUNT_JSON`, `CETELE_PLAY_RTDN_AUDIENCE`,
`CETELE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`, `CETELE_PLAY_RTDN_JWKS_URL`, `CETELE_SMS_DLR_SECRET`,
`CETELE_SMS_DLR_PREVIOUS_SECRET`, `CETELE_SMS_DLR_ALLOWED_IPS`, `CETELE_ADMIN_TOTP_KEY`,
`CETELE_ADMIN_BOOTSTRAP_EMAIL`, `CETELE_ADMIN_BOOTSTRAP_PASSWORD`, `CETELE_AUDIT_IP_KEY`. New
local-only stand-ins for `LocalOnlyAdapterGuard`: `fake-play-developer-api`,
`ephemeral-billing-token-key`, `fake-rtdn-signer`, `ephemeral-admin-totp-key`,
`ephemeral-audit-ip-key`. Android: `cetele.billingMode`.

## Outcome

Open. Each worker records "done" with its test command and output in its own report; the lead
closes this file after the Wave 2 merge.
