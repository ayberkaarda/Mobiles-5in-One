# ADR-0010: Google Play Billing, simulated portfolio path

Status: accepted. Replaces StoreKit assumptions in specification items 10, 17 and phase 5.

Package `app.patika.android` has product `patika_destekci`, base plans `aylik` and
`yillik`. The API decides entitlement. Benefits are a supporter badge and 100 photos/day
instead of 30. There are no ads.

`IPlayDeveloperApi` models subscriptionsv2 line items, offerDetails.basePlanId, expiryTime,
autoRenewingPlan, subscriptionState, acknowledgementState, linkedPurchaseToken and the
presence of testPurchase. Google transport implements GET subscriptionsv2 and POST
acknowledgement. `IGoogleAccessTokenSource` supplies a service-account bearer; the supplied
implementation reads a short-lived bearer from private configuration. Credential provisioning
and automatic refresh are outside this portfolio. No real Play or Cloud account was exercised.

References: [subscriptionsv2](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2),
[acknowledgement](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge),
[authenticated push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

Fake is the default. Every host other than Development (Production, Staging, Testing) refuses Fake
without Billing:AllowFake=true. Provider=Google refuses to start unless Billing:PackageName is
`app.patika.android` and Billing:Rtdn:Audience, Billing:Rtdn:Email and Billing:Rtdn:JwksUrl are set. The fake store
uses the database so API and Worker share purchases. Only Development + Fake maps
POST /dev/billing/purchases; authentication and the billing rate limit are required. It creates
random test tokens, records the caller's billing account id the way Play records
`obfuscatedExternalAccountId`, and accepts no other client-selected state. Compose sets Fake,
AllowFake and AllowTestPurchases for the API and Worker only (the Worker runs as Production, so AllowFake is what lets
it start) and is for local use.

Account binding: `GET /v1/me/entitlement` returns `billingAccountId` =
base64url(HMAC-SHA256(server key, user id)); the key is Billing:AccountKey or, when unset, HKDF
from the JWT signing key (rotating it unbinds earlier purchases). The app passes it to Play as
`obfuscatedExternalAccountId` (the fake client and fake store carry it). Verify rejects with 409
`purchase_owned_elsewhere` a purchase whose `externalAccountIdentifiers.obfuscatedExternalAccountId`
is missing or belongs to another account, so a chain A:T0 -> T1 (never presented) -> T2 cannot be
claimed by B even though T1 has no row here.

Token SHA-256 hashes have unique ownership, including after purge: a null user_id does not
make a token claimable. Linked purchases cannot cross accounts. Verification reads Play before
taking any lock, then takes per-token transaction locks
(`pg_advisory_xact_lock(hashtextextended(token_hash, 0))` for the token and its linked token, in
sorted order) and re-reads both rows; the Worker refresh takes the same per-token lock. A slow
Play call therefore holds only its own token, and the Play client times out after 10 s.
Rejected claims (foreign, purged or unbound) are audited as `subscription.claim_rejected` with
the caller as actor and a 12-character token-hash prefix; grants and revokes caused by a
verification carry the caller as actor, Worker changes have none. Acknowledgement is retried before saving a grant. Audit records hold
subscription ids, never raw tokens. Purge nulls user_id while retaining audit records.

A hash cannot be sent back to Play. Subscriptions additionally hold a Data Protection
encrypted purchase token (purpose `Patika.Play.PurchaseToken.v1`, distinct from
`Patika.Totp.v1`). API and Worker require the same persistent key ring
(`DataProtection:KeysPath`, application name Patika.Api, as in ADR-0009); both refuse to start
in Production without it, because an ephemeral ring makes stored tokens unreadable and
reconciliation impossible. Sharing the ring means the Worker could also decrypt TOTP secrets;
the Worker already has full database access, so this adds no new reach. Web does not mount it.
The Play HTTP client has request logging removed (request paths carry the token), and fake
store responses contain no raw purchase token. Purge clears the encrypted token with user_id;
the hash alone remains, and reconcile skips such rows.

Test purchases: Billing:AllowTestPurchases defaults to true only in Development. When it is off,
verify refuses a purchase with `testPurchase` (400 `test_purchase_not_allowed`), and entitlement
and the upload quota ignore existing rows with Environment=Test. Google 404/410 on verify is
400 `purchase_not_found`.

Unexpired Active, InGracePeriod and Canceled grant access; canceled users retain the paid
period. OnHold, Paused, Expired and Revoked do not. Verify accepts only ACTIVE/IN_GRACE_PERIOD
with matching product/base plan and future expiry. RTDN is a wake-up signal; its type cannot
grant or revoke access. Worker re-reads current provider state for duplicate or out-of-order
deliveries and reconciles non-terminal rows daily. A failing inbox row (provider error,
unexpected product) does not block later rows: it is retried on the next tick and set aside
after five attempts, since the daily reconcile re-reads the same subscription anyway. A base plan change under the same token is
followed when the new plan is `aylik` or `yillik`; any other plan leaves the row unchanged and the
inbox row is retried. Real Play normally represents revocation
as EXPIRED, removing entitlement; the fake additionally accepts SUBSCRIPTION_STATE_REVOKED
to exercise the local Revoked state. Replaced rows are permanently Revoked.

Webhook controls: the token header and claims are screened first (RS256, a key id, Google issuer,
audience, unexpired), so a malformed or foreign token never causes a key fetch. Pushes signed with
a cached key never wait on a fetch. An unknown key id refreshes the JWKS at most once per minute,
failed attempts included, with exponential backoff to five minutes; a failed, malformed or empty
fetch keeps the last good key set; the JWKS client times out after 5 s. Then: streamed 64 KiB cap,
RS256 against the cached keys, Google issuer, configured
audience/service-account email, email_verified, expiry and issued-at with two-minute skew.
Unique message ids prevent replay. Test, one-time product and non-subscription voided notifications are stored as
processed and acknowledged with 204; a voided subscription is refreshed from Play like any other
change. Foreign packages are ignored. Inbox rows contain hashes, not raw bodies/tokens. Push cannot bind an unknown token.

All app builds use FakeBillingClient. PlayBillingClient deliberately throws NotSupported;
there is no native billing binding. The confirmation says “Test ödemesi — gerçek ücret alınmaz”.
Prices are examples. Monthly is initially selected; yearly is optional. Renewal/cancellation
text and restore are visible. Restore verifies the signed-in user's locally stored test tokens;
this is a same-device simulation, not cross-device Play ownership recovery.

Known limits before a real release: account deletion does not cancel the Play subscription, and
a purged subscription cannot be reclaimed by a new account (verify answers 409
`purchase_owned_elsewhere` and audits the attempt; there is no reclaim path). The app's deletion
screen and the web `/hesap-silme` page tell supporters to cancel in Google Play first. Purchases
made before account binding have no account id and would be refused. The Google bearer source and
real Pub/Sub push were never exercised.

See [local demo](../demo/destekci.md), which posts signed notifications with a throwaway key
through `docs/demo/rtdn-local.cs`.
