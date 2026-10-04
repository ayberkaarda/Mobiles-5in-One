# ADR-0016: Shop directory, slugs and public versus owner shapes

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Recipients and donors find shops by distance. The same shop resource is also what a merchant edits,
and it carries financial identifiers. The directory must be cheap, must not leak owner or contact
data, and must keep sample rows out of any production listing.

## Decision

### Directory query

- `GET shops?near=lat,lng&radius=&hasAvailable=&limit=&cursor=`. `near` is required and must lie
  inside the Türkiye bounding box; `radius` is 1..5000 metres (default 3000); `limit` is 1..50
  (default 20); `hasAvailable` accepts `0|1|true|false`.
- The query uses PostGIS `ST_DWithin` and `ST_Distance` with bound parameters only (the raw-SQL
  static-analysis rule of ADR-0012 applies).
- Order is distance then id. Paging is a keyset cursor over (distance, id) encoded as base64url
  JSON; an invalid cursor is 422 `cursor/invalid`.
- Only `verified` shops are listed. Each row carries `available_count`, the number of `AVAILABLE`
  hooks of the shop's active items, a count and never hook ids.
- Sample rows (`is_sample`) appear only when `askida.allow_sample_shops` is true and the application
  is not in production; the same rule applies to `GET shops/{slug}`.
- Access: any of the abilities `donor`, `merchant` and `anon`. A recipient must be able to browse
  before reserving (ADR-0023).

### Shapes

- Public shape (directory and detail): id, slug, name, type and label, address, il, ilce,
  location, distance (list only), `available_count`, `is_sample`; the detail adds the active items
  with id, name, category, price in minor units, currency and `available_count`. The business
  address and coordinates are public because they are what a customer needs; phone, owner, tax number,
  IBAN and the provider key are never part of it.
- Owner shape (`POST`/`PATCH` responses and `GET shops/{slug}` for the shop's owner): the public
  fields plus phone, masked tax number, masked IBAN, verification state and time, `listed_on_web`
  and timestamps.
- Item shape for owner and staff (`GET shops/{id}/items`) additionally holds `daily_cap`, `active`
  and `shop_id`; inactive items are included. Staff read the catalog, only the owner writes it.
- Responses are explicit resource classes; a new column does not appear in a response by default.
  The OpenAPI document sets `additionalProperties: false` on every response schema (ADR-0024).

### Slugs

Slug = `Str::slug(name + ilce, 'tr')` with Turkish dotted and dotless I folded, `-2`, `-3` and so on
when the base is taken. On a unique-index race the writer retries up to three times with a random
suffix. The slug is assigned at creation and never changes. `GET shops/{slug}` for an unverified shop
answers 404 for everyone except its members.

### Path identifiers

Routes that take a shop UUID are constrained with `whereUuid`, so a non-UUID segment never reaches a
lookup. `PATCH shops/not-a-uuid` therefore matches only the slug `GET` route and answers 405
`method_not_allowed`.

## Consequences

- One query shape serves recipients, donors and members; the cost is bounded by radius and limit.
- Showing the exact business address is a deliberate disclosure the merchant consents to by
  registering; recipients are never located (anonymity rules AN-5).
- Items `price_minor` changes do not alter existing hooks or donations.
- Not exercised: directory ordering and distance against production-sized data; the tests use small
  fixture sets in the PostGIS container.
