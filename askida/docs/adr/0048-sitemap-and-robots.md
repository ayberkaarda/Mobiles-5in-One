# ADR-0048: Sitemap and robots.txt

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Listed shops change at runtime, so a static file would go stale, and a crawler-built sitemap would
need a running site and a host. The package that was planned (`spatie/laravel-sitemap`) needs PHP 8.4
(ADR-0043).

## Decision

- `GET /sitemap.xml` is built in process with `App\Support\Web\SitemapXml` (XMLWriter), no crawling.
  Entries: 13 static pages without `lastmod` (no invented dates), the five guides (`lastmod` = front
  matter `updated`, else `published`, midnight Europe/Istanbul), `/etki`, `/etki/{il}` for the
  provinces the impact pages publish (`ImpactWebReader::publishedProvinces()`, at least 3 shops;
  below-threshold province pages are `noindex` and not listed), provinces, districts (`lastmod` =
  latest shop change) and listed shops (`lastmod` = `updated_at`).
- URLs use the origin from `WEB_ORIGIN` only, never the request host. One file, well under 50 000
  URLs, so no sitemap index; add one when the shop count approaches the limit.
- Cached for one hour (`cacheResponse:3600`) and dropped at once by the shop observer when a shop that
  is or was public changes (ADR-0046).
- `GET /robots.txt` is a route (the static file was removed): all crawlers allowed, `Disallow: /admin`,
  `/pay/`, `/hesap-silme`, `/og/`, and `Sitemap: <origin>/sitemap.xml`, as `text/plain; charset=utf-8`.

## Consequences

- `SitemapConsistencyTest` asserts every listed URL answers 200 with `index,follow` and its own
  canonical, every public page is listed, `/etki/*` entries equal the published provinces, and guide
  `lastmod` equals the front matter `updated` and the Article `dateModified`.
- The sitemap lists only English pages that exist (`/en`, `/en/how-it-works`), per ADR-0044.
- not exercised: sitemap submission and the Search Console coverage report: no domain.
