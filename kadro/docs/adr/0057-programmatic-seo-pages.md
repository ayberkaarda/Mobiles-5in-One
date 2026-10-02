# ADR-0057: Programmatic SEO pages — venue and district pages from cached public reads

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0021, ADR-0037, ADR-0038, ADR-0055 (nonce CSP, data cache), ADR-0056 (marketing
  shell); product spec §6 item 9, §7; authorization matrix §3.5 footnote 18, §3.6

## Context

Product spec §7 lists programmatic pages: `/saha/[slug]` (venue page with features, price range,
reviews and a "Bu sahada maç kur" call to action) and `/eksik-var/[il]/[ilce]` (public open calls
of a district, "ISR 5 min", list pages indexable, expired calls removed), plus a sitemap that
includes venues and districts. ADR-0055 ruled out prerendered or ISR HTML on nonce surfaces and
moved the five-minute freshness to a data cache that this change implements. The pages show
public data only: what the API already returns to a caller without credentials.

## Decision

1. **Route group and render mode.** The pages live in `app/(seo)`, whose layout calls
   `connection()` in the layout and in `generateMetadata` and wraps every page in the marketing
   shell of ADR-0056. The paths are on the `seo` surface of the surface table (nonce CSP,
   indexable, Next.js' `private, no-store` for dynamic HTML); no proxy or header change was needed.
   No page uses `generateStaticParams`, so the build test of ADR-0055 still finds no prerendered
   route. `app/sitemap.ts` also calls `connection()`.
2. **Read layer.** `lib/server/seo/queries.ts` holds the anonymous, user-independent queries:
   - venue by slug: verified or sample venues (matrix §3.6 for an anonymous caller), detail through
     the API's own projection (`loadVenueDetail` with no actor), so phone and address appear for
     verified venues only and the rating average only from three reviews (ADR-0038);
   - district listing: the four conditions of `GET open-calls` (call `open` and unexpired, match
     `open` and in the future) and the same public projection (team name, verified directory
     venue only; no person, RSVP list, fee or free-text address), soonest first, at most 50; plus
     up to 24 public venues of the district for internal links;
   - sitemap rows: verified, non-sample venues; districts with at least one live call, with the
     time until which they stay listed (earliest of expiry and match start of their latest call).
     Path segments that are not slugs (`a-z`, `0-9`, single inner hyphens, at most 80 characters)
     are a 404 without a query. Results hold JSON values only (ISO strings for times). Tests compare
     the venue data and the call list with the anonymous API responses for the same rows.
3. **Data cache.** `lib/server/seo/data.ts` wraps each read in `unstable_cache` with
   `revalidate: 300` and tags `seo:venue:<slug>`, `seo:district:<il>/<ilce>` and `seo:sitemap`.
   Keys are the callback, a fixed key part and every argument: the slug or district segments and a
   16-character SHA-256 digest of the database URL, because the cache is stored on disk next to the
   build and survives restarts, so an entry read from one database is never served for another.
   React `cache` shares one result between `generateMetadata` and the page within a request.
   - Hard bound for calls (ADR-0055 decision 2): every read drops calls whose expiry or match start
     has passed, after the cache, so an expired call is never listed however old the entry is. The
     sitemap applies the same filter to its districts. A call closed or filled by its captain can
     stay listed until the entry is refreshed (about five minutes, longer after a quiet period,
     because `unstable_cache` is stale-while-revalidate).
   - Nothing calls `revalidateTag` yet; the tags exist so that the call and venue writes can
     invalidate their pages in a later change.
4. **Indexing.** Canonical URL, `hreflang` and Open Graph come from `pageMetadata` (ADR-0056).
   A page is `noindex, follow` when it is thin or not real: a sample venue (seeded demonstration
   data, product spec rule 6; the page also says so in text) and a district without a live call.
   Such pages are left out of the sitemap. Unknown or unverified venues and unknown districts
   answer 404 through the root not-found page (`noindex`). Titles are clamped at word boundaries
   so the rendered title stays within 60 characters (venue names allow 120) and descriptions
   within 155; each page opens with a 40 to 60 word answer-first paragraph that names Kadro.
5. **Structured data.** Rendered through the one helper of ADR-0055 decision 6 (`JsonLd`: React
   text child, `<`, `>`, `&`, U+2028 and U+2029 escaped, request nonce), one block per page with an
   `@graph`: `BreadcrumbList` on every page, plus `SportsActivityLocation` (address locality and
   region, geo point, amenity features, price range, telephone and street address when shown,
   `aggregateRating` only when the page shows an average) for verified venues. A sample venue gets
   the breadcrumb only, so no search engine can take demonstration data for a real place.
6. **Sitemap.** `app/sitemap.ts` did not exist; it now lists the home page, `/ozellikler`, the
   indexable district pages and the verified venues, one block per page group, so later page
   groups (blog, legal pages) add their own block. One file; chunking with `generateSitemaps` is
   left until the row count approaches the 50 000 URL limit (each query is capped at 20 000 rows).
   No `robots.txt` is part of this change.
7. **Out of scope.** `/sahalar/[il]` and `/sahalar/[il]/[ilce]` directory listings, a map on the
   venue page (a tile provider would add a third-party origin to the CSP), Open Graph images, an
   `en` alternate and navigation entries in the shell (the pages are reached through the sitemap,
   internal links between venue and district pages, and the app's shared links).

## Consequences

- Product spec §7 "ISR 5 min" holds as "data refreshed about every five minutes" for venues and
  listings, with a hard bound for expired calls; HTML still renders per request with a new nonce.
- A deployment that keeps `.next/cache` across releases keeps serving cached entries until they
  are refreshed; the database digest in the key separates environments.
- Demonstration data is visible and labelled but never indexed or described as a place.
- Adding `revalidateTag` calls to open-call publish/close and venue updates would shorten the
  window in which a closed call is still listed.
