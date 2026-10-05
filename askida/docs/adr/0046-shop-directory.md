# ADR-0046: Shop directory, listing rules and opening hours

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Shops need public pages for local search, but a page must never expose a shop that is not verified,
that opted out, or anything about its owner or its recipients. ADR-0016 fixed the shop slug and the
public versus owner API shapes.

## Decision

- URLs: `/dukkanlar/{il}` (districts with shop counts), `/dukkanlar/{il}/{ilce}` (30 shop cards per
  page, `?sayfa=N`, canonical includes the page), `/dukkan/{slug}`, `/d/{slug}` (301 to the long
  form). There is no `/dukkanlar` index. Every parameter must match `[a-z0-9]+(-[a-z0-9]+)*`; upper
  case, Turkish letters or double hyphens answer 404 before any query.
- Slugs: migration `2026_10_04_000501_add_web_columns_to_shops_table` adds `il_slug`, `ilce_slug`
  (backfilled with `TurkishSlug::make()`: `İ ı ş ğ ü ö ç` folded, lower case, hyphens), both indexed,
  and `opening_hours` (jsonb). The slugs are set by model mutators on `il` and `ilce`, because the
  database seeder mutes model events. The shop slug is unchanged (ADR-0016).
- Listing rule: a page exists only when `verification_state = verified AND listed_on_web = true`,
  plus the sample policy (sample shops only outside production with `ALLOW_SAMPLE_SHOPS`). Anything
  else is 404: pending, rejected, unlisted, unknown, malformed. Never 403, never "not listed". The
  same rule drives `/d/`, the OG route, the district and province pages and the sitemap.
- Exposure: `DirectoryQuery::COLUMNS` is an allowlist (name, type, address, il, ilce, slugs,
  location, phone, hours, sample flag, updated_at). Owner, tax number, IBAN, sub-merchant key and
  documents are never loaded. Counts are units of available items, never people.
- Shop page: name, type, place, address, phone, hours, items with price and available count, a rail
  counter, a static SVG map (no tile request), `askida://shop/{slug}` as the one primary button and
  configured store links.
- Opening hours: `{mon..sun: {open: "HH:MM", close: "HH:MM"} | null}`, 24-hour, open differs from
  close, close before open means after midnight. Stored as the whole normalised week, written only
  by the owner through `PATCH /shops/{id}` together with `listed_on_web`; not a sensitive field, so
  no re-verification. Both fields are in `openapi.yaml`; the format rule never echoes values.
- Invalidation: a `Shop` observer, after commit, forgets the page cache for `/dukkan/{slug}`,
  `/d/{slug}`, the province and district pages (old and new slugs) and `/sitemap.xml`, and deletes
  the share images, when a shop that is or was public changes listing state, leaves `verified`, is
  renamed, moves district or is deleted. `UnlistingTest` proves 404, sitemap, OG and file removal
  right after the change, without waiting for a TTL.

## Accepted risks

- OG images are served with `Cache-Control: public, max-age=86400` (ADR-0047). Browsers, social
  crawlers and CDNs may keep an unlisted shop's image for up to 24 hours. It contains only the shop
  name, which was public while listed; the origin answers 404 and deletes the file at once.
- A request that reads a listed shop concurrently with its unlisting can store that page in the page
  cache once, after the observer's forget ran: the shop, district and province pages for up to 300
  seconds, the sitemap for up to 3600. The window is bounded by the TTL, and the next change to the
  shop forgets again.

## Consequences

- Stored XSS: four payloads (script tag, attribute breakout, JSON-LD breakout, comment plus `onload`)
  written into name, address, il, ilce and item name render as text on the shop, district and
  province pages; the check is DOM based.
- The sample seed keeps the legacy Turkish type nouns (`firin`, `lokanta`, ...); `ShopKind` maps them
  to the schema.org subtypes.
- not exercised: Lighthouse on the other directory pages (only one shop page and the Istanbul list
  were measured, see the SEO checklist).
