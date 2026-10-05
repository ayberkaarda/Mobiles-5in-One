# ADR-0041: Merchant shop discovery through `GET /me/shops`

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

A merchant's app needs the shop id and role to open the dashboard. The first merchant build had no
endpoint listing a person's shops, so it kept a pointer (shop id, slug, name, role) in secure storage
and let staff join by typing a shop address. After a reinstall or on a new phone the pointer was gone,
and an account deletion left it behind. The server then gained `GET me/shops` (`MyShopsController`,
OpenAPI schema `MyShop`).

## Options considered

1. Keep the device pointer and add `me/shops` as a hint: two sources of truth.
2. Read the listing on every load and store nothing on the device.

## Decision

- Option 2. `ShopsRepository.myShops()` calls `GET me/shops` and reads the list from `data`. The result
  is never cached. `MyShop` carries id, slug, name, type, type label, il, ilce, verification state and a
  role (`owner` or `staff`); an unknown role is a `client.bad_response`, a donor token is `forbidden`.
- `merchantShopProvider` calls `myShops()` on every load. It picks the first owned shop, otherwise the
  first listed (the server orders by name). Owners additionally load the owner shape through `bySlug`
  (masked tax number and IBAN, contact); staff need no second call. The verification banner is shown
  to owners only.
- Removed as dead code: the secure-storage pointer (`MerchantShopStore`, namespace `askida_merchant`),
  `ShopLink`, the slug-link screen and the `/merchant/link` route, `NotShopMember`, and the seven
  `merchantLink*` copy keys. The server has no staff-join endpoint (staff membership is created
  server-side only), and with the listing the slug link only re-derived what the listing already gives.
- A merchant without a shop sees "register my shop" and a "Refresh" button that re-reads the listing;
  the copy says the shop appears once the account is added to it.
- Offline: if `me/shops` fails, the home shows the problem view with retry. If only the owner shape
  fails with a `network.*` problem, or the cache answers the public shape for an owner, the dashboard
  opens from the listing with an offline note.
- Staff limits stay: owner-only routes (payouts, documents, profile, catalog edit) redirect staff to
  the home, and the catalog is read-only for staff.

## Consequences

- A reinstall or a new phone finds the shop without any local state, and an account deletion leaves no
  merchant data on the device.
- A merchant in several shops always lands on the first owned one; there is no shop picker, and the
  `shop_id` of the `hooks.issued` push (ADR-0038) is not used to switch (open question in the app
  README).
- How staff are added is not documented anywhere the app can point to (open question in the app
  README).

## Not exercised / limits

- Evidence: `test/data/repositories/shops_repository_test.dart` (the fixture carries exactly the keys of
  the schema, one owner row and one staff row; empty list, unknown role and donor 403 cases) and the
  merchant provider and screen tests. The emulator flow created a shop as an owner and ran the
  dashboard from the listing; a staff membership was exercised only in unit and widget tests.
