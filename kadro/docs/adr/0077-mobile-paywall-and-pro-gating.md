# ADR-0077: Mobile paywall, purchase flows and Pro gating

- Status: Proposed
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §3 item 10, §6 item 17; ADR-0013, ADR-0047, ADR-0048, ADR-0054, ADR-0063,
  ADR-0065; authorization matrix §7

## Context

Kadro Pro is sold through RevenueCat (ADR-0063): products `kadro_pro_monthly` and
`kadro_pro_yearly`, entitlement `pro`, `app_user_id` = `users.id`. The server decides who is Pro
from `subscriptions` (ADR-0065) and sends it as `me.entitlements`. The app needs a paywall, a
purchase and a restore flow, and the entry points that lead to it. There is no RevenueCat account,
no store product and no key yet, so nothing here can be exercised against a store.

## Decision

- **One port.** Every store call goes through `BillingPort` (`src/billing/port.ts`). The
  RevenueCat SDK (`react-native-purchases`) sits behind `createPurchasesPort`, which takes the SDK
  as a parameter, so tests inject a fake SDK or a fake port and the real module is replaced by a
  failing double in the unit test setup. The port lists the two Pro products only, maps SDK errors
  to `cancelled`, `pending`, `network`, `alreadyOwned`, `store`, `unavailable` and `unknown`, and
  exposes the SDK's subscription management URL.
- **Keys and identity.** The public SDK key is read from `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` or
  `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` through `@kadro/config/mobile`. Without the platform's
  key the port is the closed `unavailableBillingPort`: nothing is configured, nothing throws, and
  the paywall says that purchases are unavailable in this build. With a key, the SDK is configured
  on the first `logIn` with the user id as `appUserID` (no anonymous id is ever created for a
  signed-in user), later `logIn` calls switch users, and any session sign-out calls `logOut`.
  The user id is known once `GET me` has loaded; the root layout reads it from the shared query.
- **Server is the source of truth.** The paywall never marks the user Pro itself. After the store
  reports success it re-reads `GET me` (bypassing the cache) up to four times, two seconds apart,
  because the webhook that writes `subscriptions` is asynchronous. `pro` is shown only when the
  server reports it; otherwise the screen says the payment went through and the membership is
  being activated, and points to "restore purchases". A failing server read counts as "not yet",
  never as Pro. A purchase refused as "already owned" is handled the same way. A successful
  refresh also marks the statistics and the team list stale, since both depend on the entitlement.
- **Outcomes with their own copy** (Turkish first, English second, in the `common` namespace
  under `paywall`): `pro`, `processing`, `notFound` (restore found nothing the server confirms),
  `cancelled` (no charge), `pending` (store approval outstanding), `network`, `store`,
  `unavailable`, `error`. The offer list failure shows the same copy with a retry.
- **Entry points** (shown only when `me.entitlements.pro` is not true, so a Pro user sees no
  upsell, spec item 10):
  - the profile shows a locked-statistics hint below the statistics card (the advanced block
    itself is decided by the server tier, ADR-0054);
  - the create-team screen hints at the free limit of one owned team and, when the server answers
    403 `entitlement_required`, keeps the way to the paywall next to the error. The limit is
    enforced by the server only; the hint does not count teams;
  - the settings screen shows a Pro section: an upsell for free users, and for anyone who has or
    had a subscription (`entitlements.status` other than `none`) a "Manage subscription" link
    that opens the SDK's management URL (https only) or the store's standard subscriptions page.
    Locked teams keep their existing read-only handling (ADR-0050).
- **Store legal links.** The paywall states the automatic renewal terms, links the store's
  standard terms (Apple's standard licensed application EULA, Google Play terms) and the privacy
  page on the configured web origin, and repeats that the legal texts are samples until reviewed.
  Prices come from the store product, never from app copy.
- **Route and namespaces.** The paywall is the signed-in route `/kadro-pro`. No new i18n namespace
  is added (the namespace list is fixed by ADR-0048); copy lives in `common`.

## Consequences

- Purchase, restore, renewal and management are verified only with fakes (port, SDK and a mocked
  server). No claim of a working purchase is made until a RevenueCat account, store products and
  sandbox testers exist; the SDK needs a development build, not Expo Go.
- `react-native-purchases` ships no Expo config plugin, so `app.config.ts` is unchanged. Apple
  requires the in-app purchase capability and the subscription products in App Store Connect, and
  Play requires a billing-enabled upload; both are owner tasks.
- `me.entitlements` is still optional in the contract (ADR-0063 decision 7); the client reads a
  missing member as no Pro until the contract makes it required.
- The unit test setup aliases `react-native-purchases` to a double whose calls throw, so a test
  that reaches the real store fails loudly.
- Downgrade handling (locking all but the oldest team after a lapse) is a worker job and is not
  part of this change.
