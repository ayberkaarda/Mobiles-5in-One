# ADR-0032: Search, city selection, map and line and stop pages

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 3, package 3C

## Context

Section 3 user stories 1 and 2 ask for public search by line code, name, free text and stop,
nearby lines from a when-in-use location, and a line page with the polyline on a map, ordered
stops, fare with its "son güncelleme" date, hours, payment methods, hailing notes, last verified
date, contributor count and a "Bu hat değişti" report. Section 4 fixes MapLibre GL JS with the
`pmtiles` protocol and no API keys. ADR-0004 limits the Capacitor plugins, ADR-0024 names the
tiles archive per city, ADR-0030 fixes the shell, the design language and Transloco, and
ADR-0031 the endpoint services. Until this package the Ara and Favoriler tabs rendered a copy
of the seed (`[ÖRNEK]`) bundled into the app.

## Decision

1. **City selection.** `CityStore` (root, signals) holds the city list from `GET /cities`, the
   selected slug and the selected city. The slug is stored with Capacitor Preferences under
   `iv.city` (a non-sensitive setting, ADR-0004) and restored before the list arrives, so the
   first search does not wait for it; a malformed slug is ignored and a slug the API no longer
   lists is dropped. `iv-city-picker` is a chip-like button that opens an Ionic sheet modal
   with every city, its published line count and a "sample data" badge; the sample city also
   shows a development-data note on the Ara tab. Without a city the tab asks for one first.
2. **Line search.** `SearchStore` (provided by the Ara page) sends `GET /lines?city=&q=&limit=100`
   through an Angular `resource`, so a newer query aborts the older request. The query is
   debounced by 300 ms (an emptied field applies at once), trimmed and cut to the 80 characters
   the API accepts. The API filters by code and name only and has no mode parameter, so the
   mode chips filter on the device. Views: no city, loading, results, empty, error (rate
   limiting has its own message) and offline. Offline means `navigator.onLine` is false or the
   request failed with `network` or `timeout`; coming back online retries on its own.
3. **Stop search (interim).** The API has no stop search route. The stops of the selected city
   are gathered once per session from `GET /stops/near` (radius 2 km, the API maximum) at the
   centres of an n × n grid over the city bbox, n at most 3 (at most 9 calls), kept inside the
   bbox, then matched on the device with Turkish case and accent folding from 2 characters on,
   8 results at most. Large cities are only partly covered. The offline pack (package 3E) or a
   `GET /stops?city=&q=` route replaces this; the route is a proposal for the API owner.
4. **Nearby lines.** One foreground fix through `@capacitor/geolocation` (coarse accuracy, no
   watch, nothing stored; native shells ask for permission first, browsers prompt inside the
   call). `GET /stops/near?radius=800` is not scoped to a city, so stops outside the selected
   city's bbox are dropped; the five nearest are read with `GET /stops/{slug}?city=` and their
   lines are merged, each with its nearest stop and distance. A 404 (a stop of another city) is
   skipped. Permission denied, position unavailable, nothing nearby and errors have their own
   messages; changing the city clears the result.
5. **Map.** `iv-map` is used only inside `@defer (on immediate)` blocks, so the component is its
   own chunk, and it loads MapLibre and PMTiles with dynamic imports on first use, so the
   library is a separate lazy chunk. MapLibre 6 loads its worker as a module next to its own
   file; the build copies `maplibre-gl-worker.mjs` and `maplibre-gl-shared.mjs` to `maplibre/`
   (`apps/mobile/project.json` assets) and the wrapper calls `setWorkerUrl`. The basemap is
   `pmtiles://{tilesBase}/{city}.pmtiles` (the ADR-0024 file name); the archive header must
   answer within 4 s, otherwise the map draws the plain background with the route and stops
   and says the base map could not be loaded. When the map cannot start (no WebGL) or its chunk
   fails, the static `iv-route-sketch` stays, which is also the placeholder while loading.
   The style uses the Protomaps basemap layer names (`earth`, `water`, `landuse`, `roads`,
   `buildings`), draws no labels and so needs no glyph or sprite host, and contains no key. A
   light (krem) and a dark (lacivert) palette follow `ThemeService`; a theme or data change
   swaps the style, and the map is removed on destroy. The built-in attribution control is off;
   the component shows "© OpenStreetMap katkıcıları" while the basemap is drawn. Scroll zoom,
   rotation and pitch are off.
6. **Line page** `/hat/:slug?city=` and **stop page** `/durak/:slug?city=` sit inside the tab
   shell. Every read sends `?city=` (the API scopes slugs per city); a link without it uses the
   stored city and otherwise shows "not found". The line page shows the plate, name and mode,
   the map, a facts panel (fare with "Son güncelleme" or "no update date", hours, payment
   methods with `nakit`, `kart` and `istanbulkart` translated and anything else shown as
   stored, hailing notes), the ordered stops (`iv-stop-sequence`, each opens the stop page),
   last verified date, contributor count and version, and the report button, which routes to
   `/katki?hat=&city=` for the contribution flow of package 3F. The star toggles a local
   favourite (sync is package 3D). The stop page shows the stop kind, a map centred on the stop
   and the published lines serving it. A plain back button replaces `ion-back-button`, which
   would have joined the initial bundle through the Ionic barrel.
7. **Favourites.** `FavoritesStore` entries are `{ city, slug, code, name, mode }` (slugs are
   unique per city, and the tab must list lines without a network call). Entries of the 3A
   shell were bare slugs of the bundled sample and are dropped on load.
8. **Text only.** Every user-supplied string (city, line and stop names, hours, payment
   methods, hailing notes) is rendered through interpolation. `no-restricted-syntax` in
   `apps/mobile` and `libs/ui` rejects `innerHTML`, `outerHTML` and `srcdoc` bindings in
   templates (inline and external), `bypassSecurityTrust*`, `innerHTML` and `outerHTML`
   writes, `insertAdjacentHTML` and `document.write`. A page test feeds markup in the line
   name, notes, payment method and a stop name and checks that it shows as text and no element
   is created.
9. **Sample mirror removed.** `apps/mobile/src/app/sample` is deleted; the app reads the
   `[ÖRNEK]` city from the API like any city. Tests use API-shaped fixtures in
   `apps/mobile/src/app/testing/catalog.fixtures.ts`.
10. **Library.** `libs/ui` adds `iv-route-sketch` (SVG route drawing) and `iv-stop-sequence`;
    `iv-line-card` leaves the fare chip out when `fareMinor` is `undefined` (search results
    carry no fare, and "fare unknown" would be wrong there). `libs/data-access` is unchanged.
11. **Dependencies** (exact, all older than two weeks on 2026-10-12): `maplibre-gl` 6.11.2
    (2026-09-24), `pmtiles` 4.5.0 (2026-08-10), `@capacitor/preferences` 8.0.1 (2026-02-12) and
    `@capacitor/geolocation` 8.2.2 (2026-08-13); both plugins are on the ADR-0004 allowlist.

## Evidence

Run on 2026-10-12 on the owner's Windows 11 machine, branch `feat/inecekvar-p3`:

| # | Command or check | Result |
| - | ---------------- | ------ |
| 1 | `pnpm add --save-exact maplibre-gl@6.11.2 pmtiles@4.5.0 @capacitor/preferences@8.0.1 @capacitor/geolocation@8.2.2` | 26 packages added |
| 2 | `pnpm nx run-many -t lint test build -p data-access domain mobile ui --skip-nx-cache` | exit 0; lint clean; data-access 64 tests, domain 4, ui 15, mobile 82; production build with the budget warning of row 4 |
| 3 | `pnpm exec prettier --check` on the changed paths | clean |
| 4 | Production bundle | initial 691.6 kB raw, 170.4 kB transfer (3B: 645.3 kB, 163.5 kB); under the 1 MB error budget, over the 500 kB warning |
| 5 | Lazy chunks | `maplibre-gl` 1.07 MB raw / 236.4 kB transfer, `map-component` 8.4 kB, `line-page` 12.3 kB, `stop-page` 4.8 kB, `search-page` 25.6 kB; worker files copied to `maplibre/` (19.1 kB and 515.9 kB) |
| 6 | Local stack: `docker compose -p inecekvar-p3c up -d postgres redis` (host ports 57842 and 57843), `alembic upgrade head`, `python -m app.seed`, `uvicorn` on 127.0.0.1:57800, the production build served on 127.0.0.1:57851 with `/api/*` proxied to the API | `[ÖRNEK] Test Şehri` selected, searched, nearby lines, line and stop pages loaded from the API |
| 7 | Screenshots: headless Chrome at 360 × 800, device scale 2, light and dark, service workers bypassed, geolocation emulated, network emulated offline for the offline state | 20 PNGs in `docs/screenshots/phase3/` (`ara-no-city`, `city-picker`, `ara-results`, `ara-query`, `ara-nearby`, `ara-offline`, `hat`, `hat-detail`, `hat-report`, `durak`); MapLibre rendered with SwiftShader in the `no-basemap` state; no console errors besides the expected anonymous `401` of `GET /me` and the unresolved tiles host |
| 8 | Mutation: stop names in `iv-stop-sequence` rendered with `[innerHTML]` | ui lint 1 error (`no-restricted-syntax`), 1 ui test and 1 mobile test fail (`renders user-supplied text as text, never as markup`); reverted, green again |

The screenshots were reviewed and iterated: the first run showed the basemap probe using the
`pmtiles://` URL instead of the archive URL, nearby cards overflowing their panel (an
unbreakable "stop · distance" meta line), a nested card-in-card panel, line hours broken at the
hyphen in a two-column grid, intermediate stop dots invisible in dark mode and the offline state
masked by the service worker. All were fixed before the final set. The `ara-light` and
`ara-dark` files of package 3A still show the removed bundled sample.

Not exercised:

- `not exercised: a real PMTiles archive` (no tiles host; `tiles.inecekvar.app` does not resolve,
  so the basemap layers and the attribution text were never drawn, only the fallback).
- `not exercised: native Android and iOS` (Preferences and geolocation permission prompts were
  covered by unit tests with fake plugins; `cap sync` was not run).
- `not exercised: the service worker with the map` (bypassed in screenshots; `ngsw-config.json`
  prefetches `/*.js`, which includes the 1.07 MB map chunk, and does not list `maplibre/*.mjs`,
  so offline the map falls back to the sketch).
- `not exercised: stop search on a large city` (only the sample city, which the 3 × 3 grid
  covers).
- `not exercised: English screenshots and iOS mode styling` (unit tests only, as in ADR-0030).

## Consequences

- The initial bundle grew by 46 kB raw: Angular's `resource` and `@defer` runtime live in the
  core chunk, the Ionic modal comes through the barrel, and the Turkish strings ship in main.
  Turning off `ion-back-button` saved 14 kB. The 500 kB warning remains open from 3A.
- MapLibre's shared module is downloaded twice on the first map (bundled into the map chunk and
  loaded by the worker from `maplibre/`); a worker built from the same chunk would avoid it.
- Proposals: a `GET /stops?city=&q=` API route, and a service worker group for the map chunk and
  worker files, decided with the offline packs (3E).
- Contribution (3F) receives `hat` and `city` query parameters from the report button; signed-in
  favourite sync (3D) must migrate the `{ city, slug, code, name, mode }` entries.

## Review round

| # | Finding | Fix | Test(s) |
| - | ------- | --- | ------- |
| C7 | Search retained personal state across accounts. | User identity resets query, filters and nearby state and invalidates pending results. | `search/search.store.spec.ts`: `clears personal search state on sign-out and ignores a late nearby response` |
| C9 | Failed stop sampling caused request storms. | Shared city loads, three concurrent grid fetches, exponential backoff from 2 to 60 seconds and longer Retry-After waits. Pending cells settle before a failed load is released. | `search/search.store.spec.ts`: `backs off failed stop sampling before retrying`; `honours ten seconds of Retry-After for stop sampling`; `limits stop grid fetches to three and shares an in-flight city load` |
| C10 | Basemaps retained the old city and accepted late probes. | Re-probe on city changes; city and generation must match before applying a source. | `map/map.spec.ts`: `switches the basemap source when the city input changes`; `ignores a slow basemap probe from the previous city` |
| C11 | Arbitrary map points could only be picked by clicking. | A labelled centre-pick button, fixed crosshair, Enter/Space support and a live announcement accompany click selection. | `map/map.spec.ts`: `offers a named keyboard button that picks the current map centre`; `picks the centre with Enter and Space on the focused map container` |
| C12 | Requests sent device coordinates at full precision. | Quantize nearby coordinates to 3 decimals and planner endpoints to 4; retain the existing coarse location default. | `search/search.store.spec.ts`: `sends nearby coordinates with three decimal places in the request URL`; `planner/planner.spec.ts`: `quantizes planner payload endpoints to four decimal places`; `shared/shared.spec.ts`: `defaults browser location to coarse accuracy and quantizes coordinates` |

The immediate stop-sampling retry test encoded the old failure behaviour and now checks backoff.
Revert check: sending unquantized nearby coordinates turns
`sends nearby coordinates with three decimal places in the request URL` red. The centre-pick
button and crosshair are shown in `docs/screenshots/phase3/planla-map-pick-{light,dark}.png`.
