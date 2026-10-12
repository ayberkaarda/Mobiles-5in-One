# ADR-0034: Offline city packs, the offline-first data path and the service worker

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 3, package 3E

## Context

Section 3 story 4 asks for a line and stop dataset per city plus a PMTiles basemap, stored with
Capacitor Filesystem natively and Cache Storage in the PWA; the free tier gets one city and Plus
unlimited (story 8, enforced by the API, ADR-0024). Section 4 gives `@angular/service-worker` the
app shell and section 10 makes a Playwright PWA offline scenario the phase 3 gate. ADR-0032 left
two open items: the service worker prefetched the 1.07 MB MapLibre chunk and did not cache its
worker modules (the map fell back offline), and stop search was a grid of `stops/near` calls
that the pack should replace. `GET cities/{slug}/pack` needs `X-Pack-Request: 1`, answers
`403 pack.entitlement_required` beyond the first city and `429` past 10 downloads a day per
identity; it sends no ETag and no pack size, and `GET cities/{slug}/tiles.pmtiles` is 404
`tiles.not_configured` until a tiles host exists.

## Decision

1. **One storage interface, two implementations.** `PackStorage` (`apps/mobile/src/app/packs`)
   has `list`, `readDataset`, `readBasemap(offset, length)`, `install`, `remove` and `estimate`.
   `PACK_STORAGE` picks `FilesystemPackStorage` (`Directory.Data`) in the native shells,
   `CachePackStorage` where Cache Storage exists, and an in-memory store otherwise (tests, very
   old browsers; the packs page says such a pack does not survive a reload).
2. **Atomic install with read-back integrity.** An install writes the dataset and the basemap
   to a fresh location named by a random install id (`packs/<city>/<id>/` or the cache
   `iv-pack:<city>:<id>`), reads both back and compares length and SHA-256 with the manifest,
   and only then switches the city in one index write: one `cache.put` of the index entry, or
   `index.next.json` renamed over `index.json` (a crash between the native delete and rename
   leaves `index.next.json`, which `list` reads). The old install is deleted after the switch;
   locations no index entry names are removed by `list`. Any failure deletes the new location and
   leaves the previous pack serving. Index writes are serialized. The service worker's `ngsw:`
   caches are never touched.
3. **Download checks.** `PackManager` downloads with progress through the new
   `CatalogApi.packBytes` (bytes as received, `Content-Length` when the body is not
   content-encoded) and refuses a body whose length differs from the declared length
   (`integrity`) or that is not format 1 for the requested city (`invalid`). It then asks for the
   basemap with `CatalogApi.tilesArchive` (no credential); a 404, a network error or a body that
   is not a PMTiles v3 archive installs the pack without a basemap. Before writing it compares
   the bytes with `navigator.storage.estimate()` (20 % head room); a browser `QuotaExceededError`
   or a native out-of-space message maps to `quota`. The registry checks the dataset hash again
   whenever it loads a pack and marks a mismatch as corrupt.
4. **Pack manager UI** at `Ayarlar > Çevrimdışı şehirler` (`/ayarlar/cevrimdisi`) and a prompt on
   the Ara tab (install, installed, update available). Each city row shows version, size, date,
   whether a basemap is included, download progress with a cancel button, an update when the
   city's `pack_version` is newer than the installed one, and delete with a second tap. Storage
   shows the bytes used by packs and the free space the platform reports. A `403
   pack.entitlement_required` (or a 402) is explained as the free single city with a "Plus’a bak"
   button that says Plus is coming (paywall is package 3G); 429, no connection, quota, integrity
   and format failures have their own messages, each stating the installed pack is unchanged.
   New `libs/ui` components: `iv-progress-bar` and `iv-notice`.
5. **Offline-first data path.** `CatalogSource` answers line search, line and stop pages, nearby
   stops and stop names from the installed pack of the city, in the API's response shapes and
   without a request; the Ara tab, line and stop pages, the planner's line geometry and the stop
   index use it. Nearby stops are computed on the device (haversine, nearest first, 50 at most,
   only the city's stops). A line or stop missing from the pack is asked from the API; offline
   that miss is "not found". Pack entries have no database ids, so they carry `pack:<slug>`
   ids that the favourites code never sends to the API (`apiLineId`). The 3C grid of
   `stops/near` calls is no longer used once a pack is installed; it remains only as the online
   fallback for a city without a pack, so the planner keeps its suggestions there. Without the
   API the city list falls back to the installed packs and reloads when the connection returns.
   Network status comes from `@capacitor/network`. The planner stays online (server-side
   graph); offline with a pack it offers "Hatlara göz at" instead of retry.
6. **Basemap from the pack.** The map asks the registry for the city's basemap first and serves
   it through a PMTiles `Source` whose ranges are read from Cache Storage (`Blob.slice`) or from
   the native file (WebView file URL with a `Range` header; a 200 answer is kept in memory). The
   tiles host is not tried while offline, so the route draws at once on the plain background,
   as in ADR-0032.
7. **Service worker.** App shell (`index.html`, manifest, CSS, every JavaScript chunk except the
   map chunks), fonts and brand assets are prefetched. MapLibre, the map component and the two
   MapLibre worker modules form a lazy `map` group (`updateMode: lazy`): they are cached on first
   use, and a pack install warms them (`MAP_WARMUP` imports the map chunks and fetches the
   worker modules). `namedChunks` is on in production so the groups can name the map chunks.
   One `catalog-reads` data group (freshness, 4 s timeout, 3 days, 200 entries) covers
   `cities`, `cities/{slug}`, `lines*` and `stops/*` GETs. Data group patterns are unanchored
   regular expressions in the generated `ngsw.json`, so the city patterns end in `$`: the pack
   and tiles routes are not cached by the worker (the app stores the pack itself). Auth, `me`,
   favourites, plan, traces and edits match no pattern. An update prompt
   (`iv-update-prompt`) offers a reload when a new version is ready, or when the cached files are
   damaged; the new version applies only on reload.
8. **Initial bundle budget.** The initial bundle is 703.8 kB raw, 177.7 kB transfer. It is
   `@ionic/core` 319 kB (Stencil runtime, tabs, router outlet and the searchbar the
   `@ionic/angular` barrel keeps), `@angular/core` and router 268 kB, `@ionic/angular` 45 kB,
   ionicons, rxjs and Transloco 70 kB, and the app with its libraries 58 kB. Getting under 500 kB
   would mean replacing the Ionic tab shell and outlet, which is not part of this package.
   One honest cut was made: the update prompt first imported `iv-notice` through the `libs/ui`
   barrel, which pulled every library component into the initial bundle (+25 kB); it now has its
   own markup. The warning budget in `apps/mobile/project.json` is set to 720 kB (2 % above the
   measured size, so growth is noticed), the error budget stays at 1 MB.
9. **Additive `libs/data-access` methods:** `ApiClient.requestBytes(req, onProgress)` (raw body
   with progress and length, ETag and content type), `CatalogApi.packBytes(slug, { signal,
   onProgress })` and `CatalogApi.tilesArchive(slug, { signal, onProgress })`, with the types
   `ApiBytes`, `ProgressListener` and `BytesOptions`. `ApiClient.request` is unchanged.
10. **Dependencies** (exact, older than two weeks on 2026-10-12, ADR-0004 allowlist):
    `@capacitor/filesystem` 8.1.3 (2026-08-19), `@capacitor/network` 8.0.1 (2026-02-12),
    `@playwright/test` 1.63.0 (2026-09-04, dev).

## Evidence

Run on 2026-10-12 on the owner's Windows 11 machine, branch `feat/inecekvar-p3`:

| # | Command or check | Result |
| - | ---------------- | ------ |
| 1 | `pnpm add --save-exact @capacitor/filesystem@8.1.3 @capacitor/network@8.0.1`, `pnpm add -D --save-exact @playwright/test@1.63.0` | added |
| 2 | `pnpm nx run-many -t lint test build -p data-access domain mobile ui --skip-nx-cache` | exit 0; lint clean (no warnings); data-access 99 tests, domain 4, ui 21, mobile 176; production build without budget warnings |
| 3 | `pnpm exec prettier --check` on the changed paths | clean |
| 4 | Production bundle | initial 703.8 kB raw / 177.7 kB transfer (3D: 701.2 / 172.6); `maplibre-gl` 1.07 MB / 236.4 kB and `map.component` 9.7 kB now in the lazy `map` group with the worker modules (19.1 kB and 515.9 kB), 1.61 MB in all; prefetched app shell 58 files, 0.97 MB (3D prefetched the map chunk as well); `packs.page` 14.4 kB / 4.1 kB |
| 5 | Unit tests added | `packs/pack-storage.spec.ts`: both storages through one contract (install and read back after a restart, basemap ranges, atomic update, failure midway keeps the old pack and leaves no files, read-back corruption refused, quota, manifest mismatch, leftover cleanup, removal), `ngsw:` caches untouched, the native index fallback, out-of-space messages, platform choice; `packs/packs.spec.ts`: format checks, line and stop search, line and stop pages, on-device nearby stops, manager progress and states, cancel, entitlement, 429, offline, length and format failures, basemap install, update detection and replacement, failed update keeps the pack, corrupt dataset, offline data path without requests, API fallback for a miss, Ara tab and stop index without the grid, offline city list, map basemap from the pack and no tiles probe offline, packs page download, delete, entitlement text and cancel; `libs/ui` `offline.spec.ts`; data-access byte downloads |
| 6 | Local stack: `docker compose -p inecekvar-p3e up -d postgres redis` (host ports 57982 and 57983), `alembic upgrade head`, `python -m app.seed`, `uvicorn` on 127.0.0.1:57980; `apps/mobile-e2e/serve.mjs` serves `dist/apps/mobile/browser` on 127.0.0.1:57990 and proxies `/api/*` like `ops/Caddyfile`; Redis flushed between runs (10 pack downloads a day per address) | the sample pack is 3,725 bytes |
| 7 | `cd apps/mobile-e2e && pnpm exec playwright test` (Chromium 153, 360 × 800, service worker on) | 1 passed: service worker in control, pack installed from the packs page, map group cached, data cache holds `cities` and no pack, auth, `me`, plan, trace or edit URL; browser context offline, reload, `orn-2` found from the pack with zero `lines`/`stops` requests, line page from the pack with the MapLibre canvas (`no-basemap`), favourite toggled on and off locally, planner suggestions from the pack and the offline state with the pack action; no unexpected console errors |
| 8 | Mutation: the Cache Storage install switches the index before writing and verifying | 4 tests fail (failure midway, read-back corruption, quota, manifest mismatch); restored, file identical |
| 9 | Mutation: `CatalogSource.lines` ignores the installed pack | the e2e scenario fails (offline search shows no line); restored, file identical, e2e green again |

Screenshots (headless Chromium through Playwright, 360 × 800, device scale 2, light and dark,
service worker on) in `docs/screenshots/phase3/`: `ara-pack-prompt`, `packs-installed`,
`ara-offline-pack`, `hat-offline-pack`, `planla-offline-pack`. They were reviewed: the first set
showed the offline results and the planner's offline state below the fold, so the scenario now
scrolls them into view before each shot.

Not exercised:

- `not exercised: native Filesystem storage on a device` (Android and iOS not run; the
  Filesystem storage ran against a fake plugin, including the rename swap; whether Capacitor's
  native `rename` replaces an existing file, and whether the WebView file URL honours `Range`,
  are unverified).
- `not exercised: a real PMTiles basemap` (no tiles host; `tiles.pmtiles` answers 404 locally, so
  every pack installed without a basemap; the pack source and range reads ran in unit tests
  with a synthetic archive header).
- `not exercised: the entitlement refusal against the API` (the seed has one city; the 403 path
  ran in unit and page tests with the ADR-0024 problem code).
- `not exercised: a real storage quota` (fake `QuotaExceededError` and out-of-space messages).
- `not exercised: the update prompt with a second deployed version` (unit-level only through the
  component; no second build was served).
- `not exercised: download progress on a slow network` (the 3.7 kB sample pack arrives in one
  chunk; the progress UI ran in page tests).
- `not exercised: Lighthouse PWA score and Capacitor builds` (other parts of the phase 3 gate).

## Consequences

- An installed pack is served even online, so a published change appears after the user
  updates the pack (the Ara prompt and the settings row say when a newer `pack_version` exists);
  a line or stop the pack lacks is still read online.
- The pack and the service worker data cache are separate: the worker may also hold recently
  read catalog responses for 3 days, which only matters without a pack.
- Without a pack the 3C stop grid still runs online; a `GET stops?city=&q=` route would retire it
  (proposal kept from ADR-0032).
- The API sends no ETag or digest for packs; integrity relies on the declared length (when not
  compressed), the format check and the hash taken at download time. A digest header on the pack
  route would let the app verify end to end (proposal for the API owner).

## Review round

Catalog patterns anchor the HTTP(S) origin and pathname before accepting a query. Angular's
installed generator escapes `.`, `+`, `*`, `?` and pathname separators; quantifiers and
alternatives survive. Absolute patterns containing `://` bypass base-href prefixing. The
catalog data-group version is now 2, retiring entries written with the previous patterns.

Storage locks cover staging, verification, index replacement, reads of basemap ranges and
cleanup. Active installs also prevent garbage collection. Unreadable indexes preserve files
and reject mutations with `io`; only a missing index allows an empty initial index. Native
recovery verifies every referenced file before promoting a next index. Cancellation reaches
the commit boundary; cancellation during an index write restores the previous index under
the lock before staging is removed. If restoration itself fails, referenced files are kept.

Byte reads accept an optional `maxBytes` (`ApiClient.requestBytes` third argument and
`BytesOptions.maxBytes`). The dataset limit is 64 MiB and the basemap limit is 512 MiB;
known expected sizes can lower those limits. The current catalog supplies no pack sizes.
An excessive Content-Length is refused before reading; streams stop at the smaller of the
cap and the unencoded declared length with `invalid_response` / `body_too_large`. Collection
limits are 10,000 lines, 100,000 stops, 20,000 route points and 2,000 stops per line, and
32 payment methods per line. Native whole-file fallback buffers use a two-file LRU.

Web Locks serialize PWA tabs using `iv-packs-index`; environments without them retain the
instance queue. Commits reject older pack versions and publish `iv-packs` invalidations.
The registry drops obsolete dataset promises on refresh. Basemap sources carry their install
generation and cannot read a replacement archive. Catalog requests refresh on page activation
and reconnect, and responses from superseded requests are ignored.

Map warmup starts at app startup and after installs, waits for service-worker control, and
fetches every lazy map asset explicitly. A successful marker records the loaded app's hashed
script URLs; a changed app version warms again. Controller changes and reconnects retry
unfinished warmup. Failure records no success. The injectable runtime supplies controller
state, version, marker storage and activation events for tests.

| # | Finding | Fix | Test(s) |
| - | ------- | --- | ------- |
| E1 | Private queries match catalog cache patterns | Anchor paths; bump group version | `core/ngsw-config.spec.ts`: `anchors catalog patterns before queries and retires the unsafe cache version` |
| E2 | GC removes staged installs | Lock the full install; skip GC for active installs | `packs/pack-storage.spec.ts` (both storages): `keeps staged files when list runs during a deferred install write` |
| E3 | Index errors permit destructive cleanup | Preserve files and refuse mutations | `packs/pack-storage.spec.ts` (both storages): `preserves install files and refuses mutations with an unreadable read-error index`; `preserves install files and refuses mutations with an unreadable invalid-json index` |
| E4 | Failed rename leaves an unsafe recovery index | Remove next index on failure; verify recovery files | `packs/pack-storage.spec.ts`: `removes the next index when its commit rename fails`; `never promotes a next index that references missing install files` |
| E5 | Downloads and collections have no caps | Streaming byte limits and collection limits | `libs/data-access/src/lib/api-client.spec.ts`: `cancels an oversized byte stream without pulling another chunk`; `rejects Content-Length above the byte cap before reading the body`; `stops reading when a byte stream exceeds its declared length`. `packs/packs.spec.ts`: `rejects a dataset with too many lines before building its pack index`; `rejects a line with too many route points before indexing it` |
| E6 | Saving ignores cancellation | Carry the signal through hashing and commit; clean staging | `packs/pack-storage.spec.ts` (both storages): `cancels a staged update before commit and retains the previous install`; `cancels an update while the index write is pending and restores the old index`. `packs/packs.spec.ts`: `cancels during saving without committing or deleting the previous pack` |
| E7 | Obsolete generations retain memory | Evict dataset promises and native buffers; bound LRU | `packs/packs.spec.ts`: `evicts dataset promises from obsolete generations on update and removal`. `packs/pack-storage.spec.ts`: `evicts whole-file fallback buffers using a two-file LRU bound`; `releases whole-file buffers when their install is updated or removed`; `releases obsolete whole-file buffers when refreshing the native index` |
| E8 | Old PMTiles sources read the current archive | Read the named generation; hold the lock through reads | `packs/pack-storage.spec.ts` (both storages): `never serves the replacement archive for an obsolete install generation`; `keeps a cache generation alive until its in-flight basemap read finishes`; `keeps a basemap generation alive until its in-flight range read finishes`. `packs/packs.spec.ts`: `rejects reads through an old PMTiles source after its install is replaced` |
| E9 | Catalog versions stay stale | Refresh on activation and reconnect; ignore older responses | `packs/packs.spec.ts`: `refreshes catalog versions whenever the packs page is activated`. `city/city.store.spec.ts`: `refreshes catalog versions on reconnect even when the list came from the API`; `ignores an older catalog response that arrives after a newer refresh` |
| E10 | Tabs lose index entries or install older versions | Shared Web Lock, version guard and invalidation | `packs/pack-storage.spec.ts`: `uses the named browser Web Lock for pack index operations`; `preserves concurrent city installs across two tabs sharing the index lock`; `refuses version three after version four is committed by another tab`; `publishes invalidations after successful pack commits and removals`. `packs/packs.spec.ts`: `refreshes committed manifests after a cross-tab invalidation` |
| E11 | Warmup skips control and app-version changes | Persist success per app version; retry failures and activation | `packs/map-warmup.spec.ts`: `defers warmup until a service worker controller appears`; `warms map assets again when the app version changes with a pack installed`; `retries a failed warmup without recording a successful version`; `rejects warmup when a lazy map asset responds with an error` |
| E12 | Offline e2e misses control timing and private queries | Delay registration until installation; authenticate the private GET | Unit: `packs/map-warmup.spec.ts`: `warms an existing pack on activation after an uncontrolled installation`; `core/ngsw-config.spec.ts`: `excludes authenticated private queries from every generated data group`. Playwright: `apps/mobile-e2e/src/offline-pack.spec.ts`: `recovers map warmup for a pack installed before service worker control`; `never caches an authenticated private query containing a catalog pathname` |

Existing scenario assertions and screenshot names remain unchanged. The authenticated e2e
uses the existing Mailpit stack (`IV_E2E_MAIL`) and a bearer account. The stack still provides
no real PMTiles archive, so the existing `ready|no-basemap` assertion remains
(`not exercised: a real PMTiles range flow`, the API accepts only an https tiles base). The
warmup service is loaded with a dynamic import after start-up so the initial bundle stays
under 720 kB. Revert checks: restoring the old `ngsw-config.json` turns both
`core/ngsw-config.spec.ts` tests red; returning an empty index on a read error turns the two
unreadable-index tests red; running `list` outside the lock without the active-install guard
turns `keeps staged files when list runs during a deferred install write` red. Native device
behaviour remains `not exercised`.
