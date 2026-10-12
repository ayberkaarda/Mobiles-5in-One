# ADR-0039: Programmatic pages and machine-readable files

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 4, package 4C (builds on ADR-0038; the data page and `Dataset` follow in 4D)

## Context

Section 7 makes the programmatic city, line, stop and route pages the growth engine: answer-first
line summaries of 40 to 60 words, a server-rendered SVG map with no map JavaScript on SEO pages,
titles of at most 60 and descriptions of at most 155 characters, `hreflang`, JSON-LD per page type,
a sitemap index with honest `lastmod`, app association files for `app.inecekvar.mobile`, OG images
per line and route pages only for the top stop pairs, `noindex` until a city has 50 published
lines. Section 6 item 16 keeps user text as text, item 9 fixes the headers. The API already
exposes the inputs (ADR-0025, ADR-0037): `GET cities`, `cities/{slug}` (hub data),
`cities/{slug}/stop-pairs`, `lines`, `lines/{slug}`, `stops/{slug}`, `sitemap` and
`cities/{slug}/sitemap`.

## Decision

### Pages (`apps/web/src/app/pages`, `content/`)

1. Routes, all `RenderMode.Server` behind the 4B page cache: `/`, `/:sehir`, `/:sehir/hatlar`
   (`?sayfa=N`, 50 per page), `/:sehir/hat/:slug`, `/:sehir/durak/:slug`, `/:sehir/rota/:pair`.
   `durum` stays ahead of `:sehir`. Later fixed pages (`/veri`, `/sss`, `/rehber/...`) must be
   declared before `:sehir` as well.
2. Resolvers validate every parameter (slug rule shared with the mobile deep-link parser, `sayfa`
   `^[1-9][0-9]{0,3}$`) before any API call. API 404/410 and invalid parameters give a real 404
   status page; other failures a 503 with `Retry-After: 120`; neither is cached. A page past the end
   of the list is a 404. The list fetches 51 rows to know whether a next page exists, because the
   API returns no total.
3. Empty city (0 published lines): 200 with "Bu şehirde henüz yayımlanmış hat yok." and `noindex`.
   Sample cities (`is_sample`): every page renders with an "örnek veri" notice, is `noindex`, has no
   OG image and is left out of the sitemaps. Sample data must not be indexed as real transport data.
4. Line page: h1, the 40-60 word summary, the server SVG, a lazy interactive map, ordered stops,
   fare with "son güncelleme", hours, payment (unknown values dropped, never echoed), how to hail
   (plain text, `white-space: pre-line`), last verified, contributor count, version and date, and
   two `rel="nofollow"` links to the PWA: "Bu hattı düzelt" (`/katki?hat=&city=`) and "Uygulamada
   aç" (`/hat/{slug}?city=`), on `IV_WEB_APP_ORIGIN` (default `https://app.inecekvar.app`).
5. Summary (`content/line-summary.ts`): fixed sentence plan (line and city, end stops, fare and
   date, hours, payment, contributors and verification), fillers only while below 40 words, then
   payment, long hours, hours and the contributor sentence are dropped in that order above 60, and a
   final clip at 60 words. Names are whitespace-normalized, control characters removed and clipped
   to 6 words. No Turkish case suffix is attached to user-entered names: vowel harmony on arbitrary
   names would be wrong, so names stand alone in every sentence.
6. Titles (`content/page-text.ts`): the subject has a budget of 46 code points so that
   `subject + " | İnecek Var"` stays within 60. The section 7 template ("Kadıköy–Bostancı minibüs
   hattı: duraklar, ücret, saatler") is 56 code points before the suffix, so it is used only when it
   fits; the fallbacks are "… hattı: duraklar ve ücret", "… hattı", then a clamped name. Descriptions
   are clamped to 155.
7. SVG (`content/line-geometry.ts`): equirectangular projection with `cos(mid latitude)`, uniform
   fit, at most 400 points, any non-finite or out-of-range coordinate drops the drawing. `d` comes
   from `svgPathD`, `viewBox` from `svgViewBox` (libs/ui), stop circles are rounded numbers, and the
   template binds them as attributes. No HTML string, no `SafeSvgPipe`, no sanitizer bypass is
   needed.
8. Interactive map: a button on the server and in the browser; after a click and the next render
   it imports `map-library` (MapLibre and PMTiles), which only loads in the browser. The MapLibre
   worker is the same-origin `maplibre/maplibre-gl-worker.mjs` copied by the build, so the CSP needs
   no `worker-src` or `blob:` (checked in the e2e: canvas rendered, no violation). The basemap is
   probed at `pmtiles://{IV_WEB_TILES_ORIGIN}/{city}.pmtiles` (3 s) and falls back to a plain
   background. The bundle check and the e2e show no map request on SEO pages before the click.
9. SEO: canonical, `og:url` and `hreflang` `tr-TR` + `x-default` (no `en`, no English pages yet);
   `?sayfa=N` only on list pages above 1 with `link rel="prev"`/`"next"`; route pages: canonical in
   the API order of the pair, `noindex` below 50 published lines, on sample cities and on the
   reversed URL; unknown pairs 404. `appBanner` on line and stop pages (the 4B hook, active only with
   `IV_WEB_IOS_APP_ID`).
10. JSON-LD only through the 4B builders and `JsonLdService`: home `Organization`, `WebSite`,
    `BreadcrumbList`; hub, list and route `BreadcrumbList`; line `BreadcrumbList` and, with at least
    two stops, `BusTrip` (`departureBusStop`/`arrivalBusStop` as `BusStop` with `GeoCoordinates`,
    `provider` = Organization "İnecek Var katkıcıları" with a note that it is the community, not the
    operator); stop `BreadcrumbList` and `BusStop` with geo. No times, prices or operators are
    invented. Each page type has a pure builder, tested with a stored `</script>` and U+2028
    payload.

### Server (`apps/web/src/server`)

11. URL normalization (`normalize.ts`), after static files and before the cache: trailing slashes
    removed, ASCII upper case lowered (paths of letters, digits, `-`, `/` only), `?sayfa=1` on a
    list dropped; one 301 with a relative `Location`, only allowlisted query parameters kept, never
    built from `Host`. Paths with a dot (files) are left alone.
12. Machine files (`machine-files.ts`, `api-reader.ts`), registered after `robots.txt`, behind the
    host guard and helmet: `/sitemap.xml` (index of `/sitemaps/{city}.xml` for non-sample cities
    from `GET sitemap`), `/sitemaps/{city}.xml` (hub, list, every line and stop from
    `GET cities/{slug}/sitemap`; route pages are not listed), `/.well-known/assetlinks.json`,
    `/.well-known/apple-app-site-association` (components `/*/hat/*`, `/*/durak/*`) and
    `/og/{city}/hat/{slug}.svg`. `lastmod` is the API value (current-version `published_at`)
    normalized to UTC seconds; a missing value gives no `<lastmod>`, never the current time.
    Responses are kept 10 minutes in a separate memory LRU; 404 and 503 are `no-store`.
13. App association: `IV_WEB_ANDROID_CERT_SHA256` (comma-separated `AA:BB:…`, 32 bytes) and
    `IV_WEB_IOS_TEAM_ID` (`^[A-Z0-9]{10}$`). Unset means the file is absent (404): the code holds no
    default fingerprint or team id, and an invalid value stops start-up naming the variable only.
    The e2e production instance uses a labelled test-only value. The magic-link path the Android
    manifest also claims stays out of the web association.
14. OG images: `sharp` is not in the workspace, so no package was added. Each line gets a
    server-side SVG (1200×630, krem background, lacivert frame, the projected line, escaped name,
    city and mode) through `svgDocument` (extended additively with an optional background and label
    size/weight; old output byte-identical). Many social crawlers do not render SVG `og:image`;
    a PNG step (`sharp` or a worker) is deferred and recorded below.

### Work split

Parts 1 to 3 (builders; pages, routes, SEO and normalization; machine files) came from the writing
lane; the lead compiled them, fixed one Express 5 parameter type in `machine-files.ts`, ran every
gate and the mutations. The writing lane ran out of capacity during part 3, so the lead wrote the
e2e part (fake API, specs, Playwright config).

## Evidence

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 1 | Baseline before the package | `pnpm nx run-many -t lint test build -p web ui domain data-access --skip-nx-cache` | 9 tasks succeeded |
| 2 | Workspace gate | same command after the package | "Successfully ran targets lint, test, build for 4 projects"; tests web 544, data-access 110, ui 39, domain 4 |
| 3 | Web e2e on the production build | `pnpm nx run web-e2e:e2e` (fake API 57991, web 57992 test, 57993 production with test-only association values, 57994 unreachable API) | 39 passed: line page without JavaScript (summary 40-60 words, SVG path grammar, ordered stops, fare date, CTA links, metadata limits), stored markup as text, hub/list/stop, empty and sample city `noindex`, JSON-LD on 6 page types, `BusTrip`/`BusStop` geo, `</script>` and U+2028 kept as data, sitemap index and city sitemap well-formed with API lastmods, association files absent/configured, OG SVG escaped, 404s, 301 normalization, pagination links, route `noindex` rule, headers on 9 content and machine routes, hydration of 5 pages without CSP reports, map only after a click |
| 4 | Interactive map in headless Chromium | `line-map.spec.ts` annotation | "map canvas rendered"; worker file loaded; no CSP violation, so no `worker-src` change |
| 5 | Bundle boundary | `pnpm nx run web:bundle-check` | "Public web bundle clean: 50 files, 4 markers" |
| 6 | Real local API, sample city | postgis 16-3.5 on 58432 and redis on 58379 (containers removed afterwards), `alembic upgrade head`, `python -m app.seed`, `uvicorn` on 58800, production web build on 58010; `curl` | `/`, hub, list, line, stop and route of `ornek-test-sehri` 200 and `noindex`; unknown line and city 404; line summary 49 words; sitemap index empty (sample only); sample city sitemap and OG 404 |
| 7 | Mutation: `<` not escaped in JSON-LD | the `<` replacement removed from `serializeJsonLd` | 7 tests red (6 page builders, 1 serializer), restored |
| 8 | Mutation: route pages indexable under 50 lines | threshold check `>= 0` | 2 unit tests and the e2e route test red, restored |
| 9 | Mutation: summary not clamped | the drop steps and the final clip removed | 2 summary tests red, restored |
| 10 | Formatting and words | `prettier --write` on the changed files only; the CI banned-word grep | clean |

## Not exercised

- `not exercised: PNG OG images` (no `sharp`; SVG only, which many social crawlers ignore).
- `not exercised: real hosting, CDN, TLS, Search Console and external validators` (Rich Results,
  schema.org validator, Lighthouse); no public host yet.
- `not exercised: Android App Links verification and iOS universal links` (no release signing
  certificate, no Apple team id, no device).
- `not exercised: Firefox and Safari` (Chromium only) and the map with a real PMTiles basemap (the
  tiles host does not exist yet, the probe falls back to the plain background).
- `not exercised: the real API e2e suite` (the Playwright run uses the fake API; the real stack was
  checked once with `curl` on the sample city, before the concurrent API commit that added a rate
  limit and a Redis cache to `stop-pairs`).
- Risk for the API lead: `GET cities/{slug}/stop-pairs` is now rate limited per client IP
  (`public.stop_pairs`); every SSR route page calls it from the web server's single IP, so a crawl
  could exhaust the limit before the page cache warms up. Proposal: exempt the internal web caller
  or size the limit for it (a busy or limited answer becomes an uncached 503 route page, never an
  indexable error). Optional API wish: a total count on `GET lines` (the list uses limit + 1).

## Stop pairs memoization

`GET cities/{slug}/stop-pairs` is rate limited per client IP and every SSR route page needs it from
the web server's single IP. The server side of `PublicApiClient` therefore keeps a process-wide
memo for that path only (`StopPairsCache` in `public-api.client.ts`): one entry per city and query,
concurrent renders share a single in-flight request, successes live 10 minutes, failed or
unavailable answers 30 seconds, and the map holds at most 256 entries (oldest evicted first). The
cache lives outside the per-request injector on purpose, and the browser path is unchanged.
