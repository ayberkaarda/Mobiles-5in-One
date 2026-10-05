# ADR-0042: WebView checkout with a navigation allowlist

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Donations are paid on the payment provider's hosted checkout form (ADR-0002). The app starts a
donation (`POST donations` returns `donation_id` and `checkout_url`) and has to show the form without
becoming a general browser and without handling card data.

## Decision

- The checkout opens inside the app in a WebView (`CheckoutWebView`, `lib/core/webview`). Card data is
  typed into the provider's page only; the app never sees it.
- `decideCheckoutNavigation` allows exactly:
  - `https://askida.app/pay/*` (default port, no credentials, no `..` segment);
  - over https and the default port, the provider hosts in the `iyzicoHosts` constant (live and
    sandbox API, static and checkout-form hosts);
  - in the dev flavor only, the configured `API_BASE_URL` origin under `/pay/*` (the fake checkout
    page of the local stack);
  - `about:blank` in subframes, which payment forms use.
  Every other navigation is blocked. The prod flavor has no cleartext path (ADR-0034).
- The page ends the flow by redirecting to `askida://donation/<id>?status=`. The policy parses it as
  a deep link, reports it once and closes the WebView. A start URL that is not allowed shows a banner
  instead of loading.
- The status in the return link only changes wording. The receipt re-reads `GET donations/{id}` and
  refreshes while the donation is `initiated`; the server state decides.
- Closing the WebView asks for confirmation and then shows the receipt. History is
  `/donor/donations` with cursor paging.
- The donate screen allows quantity 1 to 20, shows the per-payment cap hint and the daily note, and
  shows `amount` plus the commission split only when the server sends the commission.
- The WebView is built through `checkoutViewBuilderProvider`, so tests replace the platform view.

## Consequences

- A compromised link cannot take the user to an arbitrary site from inside the checkout.
- The provider host list is a constant: a provider that changes hosts needs an app release.
- The list of provider hosts follows the provider's documentation and was not checked against a live
  account.

## Not exercised / limits

- A real payment page and a real provider sandbox were not exercised (no account, ADR-0006). The
  emulator run used the local stack's fake checkout page in a real WebView: a script clicked its
  button, the page redirected to the return link and the receipt showed `paid` with two units on the
  shop rail.
- Evidence: `test/core/checkout_webview_test.dart` (policy), donor donation tests, and the emulator
  flow `e2e_flows_test.dart`.
