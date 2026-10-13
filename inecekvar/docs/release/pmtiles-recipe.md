# PMTiles recipe: city basemaps

Status: recipe; **not exercised** (no tiles host, `INECEKVAR_PMTILES_BASE_URL` unset, the tiles
route answers 404 `tiles.not_configured`; ADR-0034 "not exercised: a real PMTiles basemap").
Specification sections 3 (story 4) and 4 ask for a PMTiles basemap per city bbox, built with
Planetiler or tilemaker, with no API keys.

## 1. What the code expects

| Consumer                 | Expects                                                                                                                                                                                                                                            | Source                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Online map (app and PWA) | `pmtiles://<tilesBase>/<city slug>.pmtiles`, `tilesBase` = `environment.tilesBase` = `https://tiles.inecekvar.app`                                                                                                                                 | `apps/mobile/src/app/map/map.component.ts` `basemapUrlFor`, `environments/environment.ts` |
| Offline pack download    | `GET /v1/cities/{slug}/tiles.pmtiles` answers `302` to `INECEKVAR_PMTILES_BASE_URL + "/" + slug + ".pmtiles"`; the app downloads the whole archive (at most 512 MiB, `MAX_PACK_BASEMAP_BYTES`) without credentials and checks it is PMTiles v3     | `api/app/export/router.py`, `libs/data-access/src/lib/endpoints.ts`, ADR-0034             |
| Map style                | one vector source `basemap`, layers `earth`, `landuse` (kinds `park`, `forest`, `wood`, `grass`, `cemetery`, `garden`), `water`, `buildings` (from zoom 14), `roads` (kinds `highway`, `major_road`, `medium_road`, `minor_road`, `other`, `path`) | `apps/mobile/src/app/map/map-style.ts`                                                    |
| Attribution              | `© OpenStreetMap` on the source; `© OpenStreetMap katkıcıları` / `contributors` in the UI; the web SVG maps carry the same line                                                                                                                    | `map-style.ts`, `i18n/tr.ts`, `i18n/en.ts`, `apps/web/src/app/map/line-map.component.ts`  |
| CSP                      | tiles origin in `img-src` and `connect-src` of the PWA (`INECEKVAR_PWA_TILES_ORIGIN`) and the web (`IV_WEB_TILES_ORIGIN`)                                                                                                                          | `ops/Caddyfile`, ADR-0038                                                                 |

So: **one file per city, named `<slug>.pmtiles`, at the root of the tiles host**, and
`INECEKVAR_PMTILES_BASE_URL` must equal the app's `tilesBase` (`https://tiles.inecekvar.app`, no
trailing path). The API refuses a base that is not https.

The layer and kind names are the **Protomaps basemap schema**. A tileset in the OpenMapTiles
schema (the default of Planetiler's built-in profile and of tilemaker's default configuration)
has other layer names (`transportation`, `landcover`, `building`, ...) and would render as the
plain background colour only.

## 2. The city bbox

Take it from the API, never by hand: `GET /v1/cities/{slug}` returns `bbox` as
`[min lng, min lat, max lng, max lat]` (`app/geo/geometry.py` `bbox_bounds`, the bounds of the
stored `cities.bbox`). Write it as `minlng,minlat,maxlng,maxlat` for the tools below.

## 3. Build

Pin each tool version in the build note; flags below are those documented by the tools at the
time of writing; check `--help` of the pinned version before a run.

### 3.1 Recommended: extract from a Protomaps basemap build (go-pmtiles)

Matches the schema exactly and needs no OSM processing on the build machine.

```sh
# pmtiles CLI from https://github.com/protomaps/go-pmtiles (single binary)
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles <slug>.pmtiles \
  --bbox=<minlng>,<minlat>,<maxlng>,<maxlat> --maxzoom=15
pmtiles show <slug>.pmtiles      # check bounds, zoom range, tile type "mvt"
pmtiles verify <slug>.pmtiles
```

`--maxzoom=15` keeps buildings (the style shows them from zoom 14) and stays well below the
512 MiB download cap for a city; check the size with `ls -l` and lower the zoom if a large
metropolitan bbox comes close to it.

### 3.2 Self-built: Planetiler with the Protomaps basemap profile

When the build must run from raw OSM data (for example a specific extract date):

```sh
# https://github.com/protomaps/basemaps (a Planetiler profile), built with Maven
java -Xmx8g -jar protomaps-basemap-<version>-with-deps.jar \
  --download --area=turkey \
  --bounds=<minlng>,<minlat>,<maxlng>,<maxlat> \
  --output=<slug>.pmtiles
```

`--area=turkey` downloads the Geofabrik extract; `--bounds` limits the output to the city.
Planetiler's own default profile is OpenMapTiles and does not match the style (section 1).

### 3.3 tilemaker

tilemaker can write PMTiles, but its shipped `config.json` and `process.lua` produce the
OpenMapTiles schema. Using it requires a project-owned config and Lua script that emit the
section 1 layers and kinds; none exists in the repository. Use 3.1 or 3.2 unless such a profile
is written and reviewed.

## 4. Hosting

| Requirement                                                                                                                                                                                                                                                                                  | Why                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTPS only, host `tiles.inecekvar.app`                                                                                                                                                                                                                                                       | API validator; CSP lists exactly this origin                                                                                                                                         |
| HTTP range requests (`Range: bytes=...` answered `206` with `Content-Range`)                                                                                                                                                                                                                 | the online map reads tiles by range from the archive                                                                                                                                 |
| CORS: `Access-Control-Allow-Origin` for `https://app.inecekvar.app`, `https://inecekvar.app`, `https://localhost` (Android) and `capacitor://localhost` (iOS); allowed request headers `Range`, `If-Match`; exposed headers `ETag`, `Content-Range`, `Content-Length`; methods `GET`, `HEAD` | the PWA and the native shell fetch cross-origin; the pack download follows the API redirect from `app.inecekvar.app`                                                                 |
| No credentials, no cookies                                                                                                                                                                                                                                                                   | the app sends `credentials: 'omit'`                                                                                                                                                  |
| `Content-Type: application/vnd.pmtiles` or `application/octet-stream`                                                                                                                                                                                                                        | the app's `Accept` header names both                                                                                                                                                 |
| Long cache with a new file name per rebuild, or a short edge TTL with `ETag`                                                                                                                                                                                                                 | a changed archive under the same name can break range reads of an open map                                                                                                           |
| Hotlink and egress control                                                                                                                                                                                                                                                                   | threat model "PMTiles hotlinking"; R2 egress is free, Class B reads are not: a Cloudflare cache rule in front of the bucket that respects range requests (`docs/ops/cost-alerts.md`) |

Discrepancy to fix in the ops note, not in code: `docs/ops/cost-alerts.md` writes the cache rule
for `cities/*.pmtiles`, while the app and the API read `<slug>.pmtiles` at the root of the tiles
host. Either the rule matches `*.pmtiles` at the root, or both `environment.tilesBase` and
`INECEKVAR_PMTILES_BASE_URL` gain the `/cities` path together.

Example R2 CORS policy (bucket settings, JSON):

```json
[
  {
    "AllowedOrigins": [
      "https://app.inecekvar.app",
      "https://inecekvar.app",
      "https://localhost",
      "capacitor://localhost"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range", "If-Match"],
    "ExposeHeaders": ["ETag", "Content-Range", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

Upload with any S3 client to the tiles bucket (`<slug>.pmtiles` at the root), then check:

```sh
curl -sI https://tiles.inecekvar.app/<slug>.pmtiles
curl -s -o /dev/null -w "%{http_code}\n" -H "Range: bytes=0-126" https://tiles.inecekvar.app/<slug>.pmtiles   # 206
curl -sI -H "Origin: https://app.inecekvar.app" https://tiles.inecekvar.app/<slug>.pmtiles | grep -i access-control
curl -sI https://api.inecekvar.app/v1/cities/<slug>/tiles.pmtiles   # 302 to the file above
```

## 5. Licence and attribution

- The basemap is derived from OpenStreetMap and is under the **Open Database License (ODbL)**;
  the tiles themselves must carry the attribution "© OpenStreetMap contributors", which the app,
  the PWA and the web already show (section 1).
- ADR-0003 keeps the base map's ODbL terms separate from the project dataset (proposed CC BY 4.0,
  approval pending). Contributed line geometry is never snapped to OSM roads, so the tiles do not
  pull the line data under ODbL. Keep it that way when building tiles: never merge project lines
  into the basemap archive.
- Record the OSM extract date, the tool and version and the bbox of every published archive next
  to the upload (a short note per release), so the attribution and the source can be traced.

## 6. Point the API at the tiles

1. Set `INECEKVAR_PMTILES_BASE_URL=https://tiles.inecekvar.app` on the API (`docs/ops/env.md`).
2. Keep `environment.tilesBase`, `INECEKVAR_PWA_TILES_ORIGIN` and `IV_WEB_TILES_ORIGIN` on the same
   origin.
3. A city without an archive answers a 302 to a missing file; the app then installs the pack
   without a basemap (ADR-0034), so upload the archive before announcing the city.
