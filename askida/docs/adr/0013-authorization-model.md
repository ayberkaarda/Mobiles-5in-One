# ADR-0013: Authorization model

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification items 3 and 4 require written permission rules and authority kept on the server.
`docs/security/authorization-matrix.md` lists principals, endpoints and admin operations. Phase 1
implements the policy layer and its tests before the endpoints exist.

## Decision

### Policies and gates

- API policies: `ShopPolicy`, `ItemPolicy`, `DonationPolicy`, `HookPolicy`, `PayoutPolicy` and
  `ShopDocumentPolicy`. Controllers built in later phases call `$this->authorize()` or
  `Gate::authorize()` after a plain lookup (`findOrFail`).
- Admin gates (panel only): `review-shops`, `manage-shops`, `view-documents`, `suspend-shops`,
  `ban-anon-devices`, `view-donations`, `view-payouts`, `manage-payouts`, `refund-payments`,
  `reveal-shop-financials`, `admin`, `view-activity-log`, `view-horizon` (the queue dashboard gate
  delegates to it) and `impersonate` (always false).
- Roles `admin`, `moderator` and `finance` are spatie roles on users, guard `web`, with explicit
  permissions per matrix section 4 (no wildcard) seeded by `RolesSeeder`. The package's automatic gate
  hook is switched off: it would grant any ability named like a permission and cannot handle device
  actors.

### Token abilities versus roles

Sanctum abilities (`donor`, `merchant`) describe what a mobile token may attempt; spatie roles describe
admin staff. API policies never read roles and have no granting `before`; their `before` only denies
(deactivated user, banned device). Admin gates refuse any request that carries a personal access
token, so an admin's donor or merchant token carries no admin power, and an admin cannot read another
donor's donation through the API. No permission or gate exists to edit a hook by hand, impersonate a
user or read a recipient identity.

### Denial order: 404 versus 403

1. Ability: the token's ability cannot use the action at all, so 403 `forbidden`, decided before any
   lookup.
2. Scope: the ability fits but the target is outside the caller's scope (a shop the caller is not a
   member of, an unverified shop of others, another donor's donation, an item id of another shop, any
   document for an API caller): 404 `not_found`, rendered identically to a missing id.
3. Role: in scope but the role lacks the action (staff on an owner-only change, a panel user without the
   document permission): 403 `forbidden`.

### Merchant rules

A staff member can redeem and view redemptions only. A merchant account that is staff of any shop cannot
create a shop. Nested resources are checked by ownership of the parent (`items.shop_id` equals the shop id).

### Single source of truth

The matrix document is the single source. A table-driven suite mirrors sections 3 and 4 cell by cell,
parses the markdown and requires identical keys and cells; changing a cell requires changing the
dataset too, or the suite fails. Endpoints that do not exist yet are `PENDING` rows: each asserts the
endpoint is still absent, so building it fails the row until it is upgraded to a real test.

### IDOR harness

A reusable helper takes two principals, a route template and a resource factory and asserts that
caller B cannot read or change caller A's resource, with the 404 rule above. Phase 1 applies it to the
policies and to the routes that exist (`/me` is self-only by construction).

## Consequences

- Phase 2 and 3 controllers get their authorization contract from one table: matrix row to policy call.
- Admin panel resources must check the admin gates themselves; model policies describe the API and
  deny panel sessions.
- Document and code can no longer drift silently.

## Not exercised / limits

- No shop, donation, hook or payout endpoint exists, so the policies are proven against fixture worlds
  and a policy-protected test route, not against real controllers (item 4 stays partial).
- Eight matrix rows are `PENDING` (DELETE me, PUT me/push-token, POST anon/attest, DELETE anon/me, GET
  impact, pay/{token}, pay/callback, webhooks/iyzico).
- Anonymous device principals are exercised through policy objects, not through issued tokens.
- Evidence: `tests/Feature/Security/AuthorizationMatrixTest.php` (272 tests in the authorization
  worker's run), `tests/Security/IdorTest.php`, `AbilityMiddlewareTest.php`, `RolesSeederTest.php`.
