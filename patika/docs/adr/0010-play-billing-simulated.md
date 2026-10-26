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

Fake is the default. Production refuses Fake without Billing:AllowFake=true. The fake store
uses the database so API and Worker share purchases. Only Development + Fake maps
POST /dev/billing/purchases; authentication and the billing rate limit are required. It creates
random test tokens and does not accept arbitrary client-selected state. Compose sets Fake and
AllowFake for the API and Worker only (the Worker runs as Production, so AllowFake is what lets
it start) and is for local use.

Token SHA-256 hashes have unique ownership, including after purge: a null user_id does not
make a token claimable. Linked purchases cannot cross accounts. A PostgreSQL advisory lock
serializes verify/refresh transactions, including the provider query, preventing stale writes
and ownership races. Acknowledgement is retried before saving a grant. Audit records hold
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

Unexpired Active, InGracePeriod and Canceled grant access; canceled users retain the paid
period. OnHold, Paused, Expired and Revoked do not. Verify accepts only ACTIVE/IN_GRACE_PERIOD
with matching product/base plan and future expiry. RTDN is a wake-up signal; its type cannot
grant or revoke access. Worker re-reads current provider state for duplicate or out-of-order
deliveries and reconciles non-terminal rows daily. A failing inbox row (provider error,
unexpected product) does not block later rows: it is retried on the next tick and set aside
after five attempts, since the daily reconcile re-reads the same subscription anyway. Real Play normally represents revocation
as EXPIRED, removing entitlement; the fake additionally accepts SUBSCRIPTION_STATE_REVOKED
to exercise the local Revoked state. Replaced rows are permanently Revoked.

Webhook controls: streamed 64 KiB cap, RS256 against cached JWKS, Google issuer, configured
audience/service-account email, email_verified, expiry and issued-at with two-minute skew.
Unique message ids prevent replay. Test notifications are already processed; foreign packages
are ignored. Inbox rows contain hashes, not raw bodies/tokens. Push cannot bind an unknown token.

All app builds use FakeBillingClient. PlayBillingClient deliberately throws NotSupported;
there is no native billing binding. The confirmation says “Test ödemesi — gerçek ücret alınmaz”.
Prices are examples. Monthly is initially selected; yearly is optional. Renewal/cancellation
text and restore are visible. Restore verifies the signed-in user's locally stored test tokens;
this is a same-device simulation, not cross-device Play ownership recovery.

Known limits before a real release: verify does not yet compare Play's
`externalAccountIdentifiers.obfuscatedExternalAccountId` with the caller (the first account to
present an unbound token owns it); account deletion does not cancel the Play subscription, so
the deletion flow must tell the person to cancel in Google Play; the Google bearer source and
real Pub/Sub push were never exercised.

See [local demo](../demo/destekci.md), which posts signed notifications with a throwaway key
through `docs/demo/rtdn-local.cs`.
