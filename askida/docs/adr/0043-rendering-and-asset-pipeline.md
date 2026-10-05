# ADR-0043: Rendering and asset pipeline of the public web

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The public web (specification section 7) must score at least 90 in Lighthouse and keep the first
paint inside the first TCP window. The Phase 1 security headers give public pages a per-request CSP
nonce profile, and a response cache that replays stored HTML would replay a stale nonce.

## Decision

- Server-side Blade only. Public pages ship HTML, one external stylesheet and self-hosted fonts. No
  JavaScript, no `<style>`, no `style=""` attribute. The only inline script is
  `type="application/ld+json"`, a data block that is not executed. Dark scheme comes from
  `prefers-color-scheme` on CSS custom properties; `:root[data-theme]` is honoured by the same CSS
  without a toggle.
- `public/css/site.css` is hand-written, with custom properties taken from `brand/tokens.json`
  (a test compares the values) and served as `/css/site.css?v=<sha1>` through `Assets::url()`. It is
  4 680 bytes gzip-9 (19 842 raw). Fonts are byte copies of the brand web files (a test asserts
  equality); `text-var.woff2` is preloaded, the display cuts use `font-display: swap`, and local
  fallbacks are metric matched (Arial measured against the Bricolage cuts: text `size-adjust` 105 %,
  display 92 %).
- nginx serves `css|woff2|svg|png` with `Cache-Control: public, max-age=31536000, immutable`,
  `try_files $uri /index.php?$query_string` so dynamic PNGs (ADR-0047) still reach Laravel, and gzip
  for text types. The dotfile deny rule sits above the static rule because nginx tries regex
  locations in order.
- HTML budget: gzip-9 body at most 14 000 bytes for the short pages (home, how it works, `/esnaf`,
  `/bagisci`, `/askidan-al`, district list, shop, `/etki`) and 24 000 for guides, FAQ, legal pages
  and `/etki/{il}`. `HtmlBudgetTest` enforces it; the shared `WebPage` helper also asserts one H1, a
  40-60 word answer paragraph, at most one primary button and no external host.
- Page cache: public GET routes use `cacheResponse:300` (sitemap 3600). The cache keeps the body and
  content headers only (Content-Type, Content-Language, Last-Modified, X-Robots-Tag, Link); security
  headers, a fresh CSP nonce and cookies are added on every request. Only anonymous GET and HEAD
  requests without a query string are cached, and only 200 responses that set no cookie. Store:
  Redis, off under `APP_ENV=testing`. `/hesap-silme`, `/pay/*`, `/admin/*`, `/etki.csv` and `/og/*`
  are not behind it.

## Deviation: own middleware and sitemap writer

The phase contract named `spatie/laravel-responsecache` and `spatie/laravel-sitemap`. Every release
of the first that supports Laravel 13 (8.2.0 to 8.4.5) requires PHP ^8.4; 7.x supports Laravel 12 at
most. The second needs PHP ^8.4 in 8.x, and 7.4.0 would downgrade guzzle 8.2.0 to 7.15.5 and pull a
crawler and a headless browser driver. The stack is PHP 8.3 (ADR-0001), so neither was added. In
their place: `App\Support\Web\ResponseCache\CacheResponse` (route alias `cacheResponse`, same name
and `:seconds` argument as the package) with `PageCache::forget()`, and `App\Support\Web\SitemapXml`
(XMLWriter). A later move to PHP 8.4 can swap the packages in locally. `intervention/image` 4.3.4
and `ezyang/htmlpurifier` 4.19.1 were added as planned.

## Consequences

- No client-side behaviour: counters, the FAQ (`<details>`) and the map (inline SVG, no tiles) are
  static markup.
- Page cache behaviour is proven per route by `ResponseCacheTest` (miss then hit, different nonce,
  identical body, stored headers limited to the list above).
- Livewire injects style and script into later responses within one test process;
  `Tests\TestCase::setUp()` flushes its state so public page tests do not depend on it.
- not exercised: dark scheme in a browser (CSS values are asserted, no visual run).
