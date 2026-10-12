# ADR-0038: SSR foundation of the web app

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 4, package 4B (the content pages of package 4C build on this)

## Context

Section 4 asks for an Angular SSR web app with an in-memory and Redis page cache (10 minutes) and
`helmet` on the Express server. Section 6 item 9 fixes the headers (HSTS preload, CSP with a
per-request nonce, `frame-ancestors 'none'`, `object-src 'none'`, the image and connect origins,
Referrer-Policy, Permissions-Policy), item 16 bans HTML sinks and sanitizer bypasses, item 13 asks
for generic SSR error pages and item 23 names cache poisoning of SSR pages. Section 7 asks for
titles of at most 60 and descriptions of at most 155 characters, `hreflang`, OG tags, JSON-LD and a
Smart App Banner. `libs/data-access` reads `globalThis.location`, `history` and `localStorage` in
its session and auth parts, which public SSR pages must not carry.

## Decision

### Server (`apps/web/src/server`, `server.ts`)

1. Configuration comes only from the environment (`server/config.ts`): `INECEKVAR_ENV` (unset or
   unknown means `production`, the strict default), `IV_WEB_CANONICAL_ORIGIN`,
   `IV_WEB_ALLOWED_HOSTS`, `IV_WEB_API_PUBLIC_ORIGIN`, `IV_WEB_TILES_ORIGIN`,
   `IV_WEB_API_INTERNAL_URL`, `IV_WEB_CACHE_TTL_SECONDS` (600), `IV_WEB_CACHE_MAX_ENTRIES`,
   `IV_WEB_CACHE_QUERY_ALLOWLIST` (`sayfa`), `IV_WEB_IOS_APP_ID`, and since the phase 4 review
   `IV_WEB_BYPASS_RENDER_BURST` and `IV_WEB_BYPASS_RENDER_PER_MINUTE` (both 60, item 6). All values
   are public. Origins must
   be bare origins and https in production; `localhost`, loopback and `*` are dropped from the
   allowed hosts in production and added outside it. Invalid values stop the start-up with the
   variable name, never the value.
2. Middleware order: `GET /healthz` (plain `ok`, before the host guard so container probes on
   127.0.0.1 work), removal of `Forwarded`, `X-Forwarded-*`, `X-Original-URL`, `X-Rewrite-URL` and
   `X-HTTP-Method-Override`, GET and HEAD only (405), no request bodies (413), URLs up to 2048
   characters (414), network-path (`//host`) and backslash targets, raw or after one decoding
   (400, added after the phase 4 review: `//evil.com/x` used to reach the renderer, throw and log a
   stack trace per request), the host guard (400 for any Host outside the allowlist, 301 from `www.` to the
   canonical origin in production), the nonce, `helmet`, Permissions-Policy, `robots.txt`, hashed
   static files (never `.html`, which must pass the nonce substitution), the SSR handler and a
   generic Turkish 500 page without stack or input echo. Node limits: 16 KiB headers, 15 s header
   and 30 s request timeouts. `AngularNodeAppEngine` gets the same allowed hosts and
   `trustProxyHeaders: false`.
3. Headers: CSP without helmet defaults: `default-src 'self'`, `script-src 'self' 'nonce-…'`,
   `script-src-attr 'none'`, `style-src 'self' 'nonce-…'`, `img-src 'self' data: <tiles>`,
   `font-src 'self'`, `connect-src 'self' <api> <tiles>` (plus `ws://localhost:*` and
   `ws://127.0.0.1:*` outside production for the dev server), `object-src 'none'`,
   `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `manifest-src 'self'`,
   `upgrade-insecure-requests` in production. HSTS `max-age=63072000; includeSubDomains; preload`,
   `X-Frame-Options: DENY`, Referrer-Policy `strict-origin-when-cross-origin`, Permissions-Policy
   `geolocation=(self), camera=(), microphone=()`, `nosniff`, no `X-Powered-By`, COOP and CORP
   `same-origin`; COEP is off because tile images are cross-origin.
4. Nonce: `index.html` carries `ngCspNonce="ivcspnonce0placeholder0value"`. The build reads it into
   the manifest, so the critical-CSS styles and the stylesheet swap script get it, and the server
   config provides the same value as `CSP_NONCE`, so the event-replay script gets it too. Every
   response, rendered or cached, then replaces the placeholder with 16 fresh random bytes only in
   a ` nonce="…"` or ` ngcspnonce="…"` attribute inside a start tag (`<tag … nonce="…"`, matched by
   `applyNonce` in `server/csp-nonce.ts`). The server renderer (Domino) escapes `&`, `<`, `>` and
   no-break spaces in text nodes but leaves quotes raw, so a stop or line name can spell
   `nonce="ivcspnonce0placeholder0value"` in text; such text never sits between a `<` and its `>`,
   so it is never substituted (`csp-nonce.spec.ts`, "never puts the live nonce into text nodes").
   An earlier version of this item claimed escaped text cannot contain a raw quote; that premise
   was false and the substitution was anchored to start tags after the phase 4 review. Data blocks
   (`application/json`, `application/ld+json`) are not executed and carry no nonce.
5. Every SSR render receives a new `Request` for `canonicalOrigin + path + allowlisted query` with
   only `Accept: text/html`. Cookies, `Authorization`, `Accept-Language`, `Host` and forwarded
   headers never reach Angular, so the output depends only on the cache key and rendered URLs come
   from configuration.
6. Page cache (`server/page-cache.ts`): `PageCacheStore` with `MemoryLruPageCache` (entry count and
   32 MiB byte bound, per-entry TTL), `RedisPageCache` behind a two-method client interface (hashed
   keys, validated JSON, client errors are misses) and `LayeredPageCache`. The key is
   `v1|host|path|sorted allowlisted params`. The cache is bypassed (neither read nor written) for
   methods other than GET and HEAD, any `Cookie` or `Authorization` header, `/admin` (first path
   segment after decoding, any case, also `/admin;x`), paths that are not already normalized
   (`//`, dot segments, trailing slash, encoded separators), repeated parameters and allowlisted
   values over 64 characters. Since the phase 4 review a non-canonical path never gets this far:
   URL normalization (ADR-0039 item 11) redirects or refuses it before rendering. Every remaining
   bypass render except the client-only admin shell takes a token from a bucket keyed on the TCP
   peer address (`server/bypass-limiter.ts`, burst and refill from item 1); an empty bucket answers
   429 with `Retry-After` and `no-store`. Behind a reverse proxy that address is the proxy's, so
   the bucket is shared (`docs/ops/env.md`). Only 200
   `text/html` responses without `Set-Cookie` and up to 1 MB are stored, with the placeholder in
   place. HTML is sent with `Cache-Control: private, no-cache` so no shared cache keeps a nonce.
   `X-Cache` is sent outside production only. Every route, home included, renders per request; no
   route is prerendered, so canonical URLs never hold a build-time origin.
7. `robots.txt`: production allows everything except `/admin` and names
   `<canonical>/sitemap.xml`; other environments disallow everything.

### Angular side (`apps/web/src/app`)

8. `PUBLIC_WEB_CONFIG` (canonical origin, public API base, App Store id) is provided on the server
   from the environment and passed to the browser through `TransferState`. `API_INTERNAL_BASE_URL`
   exists only in the server config.
9. `PublicApiClient.get(path, query, guard)` uses `fetch` with `credentials: 'omit'`,
   `redirect: 'error'` and a 3 s timeout, inside `PendingTasks` so SSR waits, against the internal
   base on the server and the public base in the browser. Results are stored in `TransferState`
   and read once in the browser. Bodies over 2 MB, bad JSON or a failed guard are `unavailable`;
   404 and 410 are `not_found`; problem+json `code` is kept only when it matches
   `^[a-z0-9_.]{1,64}$`. `apiPath` encodes every parameter. `PageStatus` sets 404 or 503 (with
   `Retry-After: 120`) through `RESPONSE_INIT`.
10. `SeoService` sets title (at most 60 code points with the ` | İnecek Var` suffix), description
    (at most 155, control characters removed, line breaks become spaces), robots, one canonical,
    `hreflang` `tr-TR` and `x-default` (and `en` when a page passes an English path), OG and
    Twitter tags and `apple-itunes-app` only when `IV_WEB_IOS_APP_ID` is set and the page asks for
    it. URLs are always the configured origin plus a validated site path.
11. JSON-LD: typed, branded builders (`Organization`, `WebSite` with `SearchAction`,
    `BreadcrumbList`, `BusTrip`, `BusStop`, `Dataset`, `FAQPage`, `Article`, `MobileApplication`,
    `WebApplication`); `serializeJsonLd` rejects non-finite numbers, functions, symbols, bigints and
    cycles and escapes `<`, `>`, `&`, U+2028 and U+2029. `JsonLdService` is the only code that
    creates script elements, using `Renderer2.createText`.
12. `libs/ui/src/lib/safe-svg.ts`: geometry parameters are numbers only (`svgNumber` throws on
    non-finite values and magnitudes from 1e21, writes no exponent), colours come from a brand
    union type and text goes through `escapeXmlText`. `svgDocument` builds standalone SVG for later
    OG images; it is never inserted as HTML.
13. Pages: `iv-status-page` (404 or 503, noindex) used by the `**` route and by later pages when
    their data fails; `/durum`, a noindex status page that reads the API health through the public
    client, so the internal URL, `TransferState`, timeout and 503 path are exercised before content
    pages exist.
14. Boundaries: the apps/web lint config bans `bypassSecurityTrust*`, `innerHTML`/`outerHTML`,
    `insertAdjacentHTML`, `document.write`, template `[innerHTML]`/`srcdoc`, the
    `application/ld+json` literal and `createElement('script')` outside `json-ld.service.ts`,
    imports of `@inecekvar/data-access`, and `localStorage`, `sessionStorage` and `indexedDB`. The
    `web:bundle-check` target fails when the built output contains markers that only the data-access
    session and auth code defines (`iv.logout_pending`, `consumeMagicLinkFragment`,
    `globalThis.localStorage`, `X-CSRF-Token`); the mobile bundle trips it, the web bundle does not.
    The `localStorage` text that remains in `server.mjs` comes from the `debug` module inside
    Express.

### Dependency

15. `helmet@8.3.0` (exact, released 2026-07-12) is the only added package.

## Evidence

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 1 | Baseline before the package | `pnpm nx run-many -t lint test build -p web ui domain data-access --skip-nx-cache` | 9 tasks succeeded |
| 2 | Workspace gate | same command after the package | "Successfully ran targets lint, test, build for 4 projects"; tests web 212, data-access 110, ui 31, domain 4; no lint warnings |
| 3 | Web e2e against the production build | `pnpm nx run web-e2e:e2e` (fake API 57991, web instances 57992 test, 57993 production, 57994 with an unreachable API) | 10 passed: headers, nonces per response, host/method/robots/health guards, cache keys, 404 and 503 not stored, hydration without CSP reports or page errors, SSR without JavaScript (content, canonical, hreflang, one JSON-LD block), 404 page, `/durum` 200 and 503 |
| 4 | Bundle boundary | `pnpm nx run web:bundle-check`; control `node apps/web/scripts/check-public-bundle.mjs dist/apps/mobile` | "Public web bundle clean: 24 files, 4 markers"; the mobile bundle fails with all 4 markers |
| 5 | Manual probe | production build on 127.0.0.1, `curl` twice | MISS then HIT with different nonces in the CSP and in every nonce attribute; `Host: evil.example` 400 |
| 6 | Mutation: nonce frozen on cache hits | the hit path reuses the first nonce (re-run after the phase 4 review as "the hit path skips the substitution") | red: `cache-behaviour.spec.ts` "gives two cache hits distinct nonces matching all response attributes"; restored |
| 7 | Mutation: JSON-LD `<` not escaped | the `<` replacement removed | red: `json-ld.spec.ts` "escapes HTML delimiters and line separators without changing data" (with the 4C page builders also the six `page-builders.spec.ts` "keeps bounded SEO and preserved JSON text …" cases); restored |
| 8 | Mutation: cookie requests cached | `cookie` removed from the bypass headers | red: `page-cache.spec.ts` "bypasses requests with private headers" (`cookie: ''`, `cookie: 'session=x'`), `cache-behaviour.spec.ts` "neither reads nor writes the cache for private requests" (`Cookie: 'session=one'`, `Cookie: ''`) and, since the review, `normalize.spec.ts` "limits bypass renders per client and answers 429 without rendering"; restored |
| 9 | Formatting and words | `pnpm exec prettier --check apps/web apps/web-e2e libs/ui`; the CI banned-word grep over the new files | clean |
| 10 | Review fix: nonce only in start tags | `csp-nonce.spec.ts` "never puts the live nonce into text nodes, whose quotes the server renderer leaves raw" | mutation "the old unanchored expression": red (that test); restored |
| 11 | Review fix: network-path and backslash targets | `request-guards.spec.ts` "rejects the authority-form or backslash path %s with 400 and no error log" (8 cases), e2e `routing.spec.ts` (non-canonical test) | mutation "guard disabled": all 8 red; restored |
| 12 | Review fix: bypass render bucket | `normalize.spec.ts` "limits bypass renders per client and answers 429 without rendering", "never limits cacheable requests" | mutation "bucket always grants": red (first test); restored |
| 13 | Review fix: static cache headers | `cache-behaviour.spec.ts` "keeps only Angular hashed output immutable, never the copied MapLibre worker" (`maplibre/maplibre-gl-worker.mjs` and `-shared.mjs`, an un-hashed `service-worker.js`, `icon-maskable.png`, `favicon.ico` revalidate; `chunk-`, `main-`, `styles-`, `media/` hashed names stay immutable) | mutation "the old `[-.][a-z0-9_-]{8,}` expression": red; restored |

## Not exercised

- `not exercised: Redis page cache against a real server` (no Redis client package is added; the
  adapter is tested with an in-memory fake and is not wired in `server.ts`).
- `not exercised: real hosting, TLS, HSTS preload submission, the www redirect over DNS and a CDN in
  front` (no public host yet).
- `not exercised: a real API behind the internal URL` (the e2e uses a fake health endpoint).
- `not exercised: Firefox and Safari` (Chromium only), Lighthouse and JSON-LD validation in an
  external validator (no content pages yet; phase 4 gate).
- `not exercised: Smart App Banner on iOS` (no App Store id) and `hreflang en` (no English pages).
- `worker-src` for MapLibre blob workers is not in the CSP yet; package 4C adds it with the map.
