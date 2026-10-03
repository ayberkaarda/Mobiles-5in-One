# Billing (Kadro Pro)

Decisions: ADR-0063 (subscription model, webhook, entitlements), ADR-0077 (paywall and Pro
gating), ADR-0079 (entitlements required on profile responses). Code: `apps/mobile/src/billing/`
and `apps/mobile/app/kadro-pro.tsx`.

## Shape

The app talks to the stores only through one small port, `BillingPort` (`src/billing/port.ts`). The
RevenueCat SDK (`react-native-purchases`) sits behind `createPurchasesPort`
(`src/billing/purchases-port.ts`) and nothing else imports it, except `src/billing/instance.ts`,
which wires it.

| Port member       | Behaviour                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `available`       | `false` when the build has no SDK key for the platform.                                                                                                              |
| `logIn(userId)`   | Configures the SDK on the first call with `appUserID = users.id` (no anonymous RevenueCat id is ever created for a signed-in user); later calls switch the customer. |
| `logOut()`        | Forgets the customer; safe when nobody is logged in.                                                                                                                 |
| `loadOffers()`    | Lists only `kadro_pro_monthly` and `kadro_pro_yearly` (monthly first; Play ids of the form `<id>:<basePlan>` are handled). Localized prices come from the store.     |
| `purchase(id)`    | Starts the store purchase of one offer.                                                                                                                              |
| `restore()`       | Asks the store for the purchases of the store account.                                                                                                               |
| `managementUrl()` | The SDK's subscription management URL, when it knows one.                                                                                                            |

Identity changes run one after another, so a quick sign-out and sign-in cannot interleave.
Failures are mapped to `BillingError` kinds: `cancelled`, `pending`, `network`, `alreadyOwned`,
`store`, `unavailable`, `unknown` (RevenueCat error codes 1, 20, 10 and 35, 6 and 7, 2 and 3).

### Keys and the closed port

`instance.ts` reads `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` or `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
through `@kadro/config/mobile`. These are the public SDK keys (`appl_...`, `goog_...`); the secret
REST key never goes into the app. Without the platform's key (the default in `.env.example`) the
port is `unavailableBillingPort`: every call is closed, nothing throws at start-up, and the paywall
shows "Pro is unavailable in this build".

### Identity wiring

- `useBillingIdentity` (via `useStoreCustomer` in `app/_layout.tsx`) logs the store customer in
  once the signed-in profile (`GET /api/v1/me`) gives the user id. A failure is not shown; the
  paywall reports an unavailable store when it needs one.
- `session.onSignOut` calls `billing.logOut()` for every kind of sign-out (user, expiry, deletion).

## Entitlement comes from the server

The app never decides that a user is Pro. `isPro(me)` is `me?.entitlements.pro === true`, where
`entitlements` is a required member of `GET /api/v1/me` (`pro`, `status`, `expiresAt`, `store`;
`pro` is true exactly for `active` and `grace_period`). A profile that is not loaded yet counts as
free. The webhook (`POST /api/v1/webhooks/revenuecat`) and the nightly reconcile job update the
server's view; a store purchase only triggers a re-read.

`src/billing/flow.ts`:

- `runPurchase`: `port.purchase`, then `confirmPro`.
- `runRestore`: `port.restore`, then `confirmPro`.
- `confirmPro` re-reads `GET /api/v1/me` (`staleTime: 0`, through `useRefreshPro`) up to 4 times, 2 s
  apart, because the webhook is asynchronous. A failed read counts as "not yet", never as Pro.
  After a successful read the statistics and the team list are marked stale.
- Outcomes: `pro`, `processing` (the store accepted, the server does not report Pro yet),
  `notFound` (a restore found nothing the server recognizes), `cancelled`, `pending`, `network`,
  `store`, `unavailable`, `error`. An `alreadyOwned` purchase is treated as `processing`. Each
  outcome has its own copy in the `common` namespace (`paywall.outcome.*`), rendered with
  `testID` `paywall-outcome-<outcome>`.

The offer list is a query under the `me` root (`billingKeys.offers`), so it is never written to the
device and is dropped at sign-out like the profile.

## Paywall and entry points

- Route `/kadro-pro` (`app/kadro-pro.tsx`, signed-in group). States: Pro active (`paywall-active`,
  with the expiry date when there is one, and the management link), store unavailable
  (`paywall-unavailable`), loading, offer error with retry, no offers (`paywall-empty`), and the
  plan chooser with subscribe and restore (`paywall-plans`, `paywall-subscribe`,
  `paywall-restore`). The yearly plan is preselected.
- Always shown: the automatic renewal text, the store's own terms page (Apple's standard licensed
  application EULA, or the Play terms; `src/billing/links.ts`), the privacy page on the web origin
  when it is configured, and a note that the legal texts are samples.
- "Manage subscription" (`ManageSubscriptionLink`): the SDK's URL when it is https, otherwise the
  store's standard subscriptions page (`apps.apple.com/account/subscriptions`,
  `play.google.com/store/account/subscriptions`).
- Entry points (shown only while `me.entitlements.pro` is not true): the profile tab (upsell next to
  the locked statistics), the settings Pro section, and the create-team screen's team limit hint.
  The hint is shown to every non-Pro account because the client cannot count owned teams without
  another request; the server enforces the limit (`entitlement_required`). Downgrade handling
  (locking a lapsed account's extra teams) is worker-side.

## Tests

`tests/billing-units.test.ts` (port with a fake SDK, flow, links) and
`tests/billing-screens.test.tsx` (paywall states, entry points, identity hook). The SDK module is
aliased to a double whose calls throw (`tests/support/react-native-purchases.ts` in
`vitest.config.mts`), so a test that forgets to inject a fake fails loudly.

## NOT verified without store accounts

No RevenueCat project, store products or keys exist for this repository, so the following were
never run against the real services and rest on fakes only:

- a real purchase, restore, renewal or cancellation on iOS or Android;
- the real offerings list (product ids `kadro_pro_monthly` and `kadro_pro_yearly` must exist in App
  Store Connect and Google Play and be attached to a RevenueCat offering);
- the RevenueCat webhook and the nightly reconcile against live deliveries;
- the subscription management URL from the SDK;
- sandbox or test-track behaviour (ask to buy, grace period, billing retry);
- running the SDK on a device: `pnpm build` produces the iOS and Android JavaScript bundles, but no app with the SDK was installed on a simulator or phone.

Store-side setup (App Store Connect subscription group, Play base plans, RevenueCat entitlement and
offering) is an owner task. The SDK needs a development build; it does not run in Expo Go.
