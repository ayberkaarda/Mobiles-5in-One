# ADR-0033: Planner screen and favourites sync

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 3, package 3D

## Context

Section 3 user story 3 asks for an A to B planner with up to 3 itineraries, at most 2 transfers,
walks of at most 300 m between stops and an estimated fare; story 1 asks that both ends can be
typed (stops and neighbourhoods from a keyless local index) or tapped on the map; story 7 asks
for favourites that stay local for guests and sync for signed-in users. ADR-0020 fixes the
`POST plan` contract: `422 plan.outside_city` outside the stored bbox, 30 requests per minute
with `429` and `Retry-After`, and `200` with `degraded: true` when the search ran out of time
(possibly with itineraries from a 1-transfer fallback, possibly empty). The favourites API is
`GET me/favorites`, `PUT` and `DELETE me/favorites/{line_id}` (idempotent; `PUT` answers 404 for
a line that is not published). ADR-0031 gives the endpoint services and the session store,
ADR-0032 the city store, the interim stop index and the lazy map.

## Decision

1. **Trip ends.** A `Place` is `{ source: stop | map | gps, label, lng, lat }`. Typing searches
   the stop index of package 3C (Turkish folding, from 2 characters, 6 suggestions, debounced
   like search) and a suggestion fills the end; typing again clears the chosen place, so the
   form never sends text it could not resolve. "Haritadan seç" arms the lazy map for that end
   and a tap fills it; with no armed end a tap fills the first empty end, and once both ends are
   set the map stops reacting. "Konumum" takes one foreground fix through `LOCATION_SOURCE`
   (when-in-use, nothing stored) and refuses a position outside the city bbox. The API has no
   neighbourhood data, so only stops are matched (see not exercised).
2. **Validation before sending** (`planner/plan-form.ts`, pure): a city is selected, both ends
   are set, both are finite and inside the city bbox (edges included, the API rule), the ends are
   at least 100 m apart (one planner cache cell, ADR-0020) and the transfer limit is 0, 1 or 2.
   The first problem is shown under the form; nothing is sent.
3. **States** (`PlannerStore`, provided by the page): no city (with the city sheet), idle hint,
   loading, results, empty ("Bu iki nokta arasında hat bulunamadı"), degraded without results
   ("Planlayıcı şu an yoğun", retry), degraded with results (a banner above the cards: at most 1
   transfer), rate limited, offline, outside city and error. A `429` starts a countdown from
   `Retry-After` (60 s when absent); the submit button and the retry stay disabled until it
   reaches 0, and editing the form keeps it running. Offline is `navigator.onLine` false (no
   request is sent) or a `network` or `timeout` failure. A newer submit aborts the older request;
   changing the city resets both ends and the result.
4. **Itineraries.** Up to 3 cards (`iv-itinerary-card`, new in `libs/ui`): a chain of yellow
   line placards and dashed walk chips, an estimated duration, transfers, total walk and the
   estimated fare (`≈ ₺55,00`, "Ücret bilinmiyor" for `null`, "Ücretsiz" for 0). Walks under
   5 m are hidden (the API sends 0 m when an end is at a stop). The API returns no times, so the
   duration is labelled an estimate: 80 m per minute on foot, 2 minutes per stop and 5 minutes
   of waiting per boarding. The first card is selected; selecting one lists its steps
   (`iv-itinerary-steps`, new in `libs/ui`) and draws it on the map: rides follow the line's
   stops between boarding and alighting (read once per line with `GET lines/{slug}?city=`,
   reversed for the return direction, a straight segment until it arrives or if it fails), walks
   are dashed, boarding and alighting stops are circles and the two ends are markers. A new
   itinerary refits the view; picking a point does not.
5. **Map additions** (`iv-map`, still `@defer`): inputs `segments`, `markers`, `area` (the city
   bbox when nothing else is drawn) and `pickable`, output `picked`. The `walk` and `markers`
   layers are added only when segments or markers are present, so line and stop pages keep their
   style. `MapHandle` gains `fitBounds` and the `click` event.
6. **Favourites storage.** Guest favourites move from localStorage to Capacitor Preferences
   (`iv.favorites`, non-sensitive, ADR-0004); the 3C localStorage list is migrated once. Entries
   now carry the optional API `lineId` (search results and the line page provide it).
7. **Signed in.** The visible list is the account list (`GET me/favorites`), held in memory only.
   Line code, name and mode come from what the device knows (guest entries, toggles) or from
   `GET lines/{slug}?city=`; a line that cannot be read shows its slug. A toggle is optimistic:
   the star changes at once, `PUT` or `DELETE` follows, a failure rolls back that line only and
   shows a note; a second tap on a line in flight is ignored; deleting a favourite that is
   already gone counts as success.
8. **Merge on sign-in.** On every new signed-in user (including a restored session at start-up)
   the guest entries not yet merged into that account are sent one at a time: the id is
   resolved for old entries, a line already on the account is skipped (dedupe), otherwise
   `PUT` (idempotent). Each confirmed entry is recorded under `iv.favorites.merged` as
   `{ accountId: ["city/slug", ...] }` (this device's own guest keys only, never the account
   list), so a favourite later removed from the account is not copied back on the next sign-in.
   A failed entry is not recorded and is replayed on the next sign-in or with "Yeniden dene"; a
   line that no longer exists (404) is recorded and dropped. The tab reports "N favori hesabına
   eklendi" or the partial failure.
9. **Session changes.** A change of user id clears the account list, the line details, busy
   flags and the merge state synchronously, before anything is awaited, and bumps an epoch that
   every late answer checks. Signing out never touches the guest list; the guest view is exactly
   the list that was on the device before sign-in.
10. **Favoriler tab.** Guest: "Bu cihazdaki favoriler" and a sign-in card linking to `/giris`.
    Signed in: merge note, "Hesabındaki favoriler", loading, error with retry and the empty
    state. `/giris` is a stub page until package 3G.
11. **Text only.** Stop, line and place names from the API are rendered through interpolation;
    the existing `no-restricted-syntax` rules stay. Tests feed markup in a line name and a stop
    name through the planner and check that no element is created.
12. **Data access.** No change in `libs/data-access`: `CatalogApi.plan`, `CatalogApi.line` and
    the `AccountApi` favourite methods of package 3B were enough. No dependency was added.

## Evidence

Run on 2026-10-12 on the owner's Windows 11 machine, branch `feat/inecekvar-p3`:

| # | Command or check | Result |
| - | ---------------- | ------ |
| 1 | `pnpm nx run-many -t lint test build -p data-access domain mobile ui --skip-nx-cache` | exit 0; lint clean; data-access 95 tests, domain 4, ui 17, mobile 132; production build with the budget warning of row 3 |
| 2 | `pnpm exec prettier --check` on the changed paths | clean |
| 3 | Production bundle | initial 701.2 kB raw, 172.6 kB transfer (3C: 691.6 kB, 170.4 kB); over the 500 kB warning, under the 1 MB error budget; `plan.page.scss` kept under the 4 kB component budget |
| 4 | Lazy chunks | `plan-page` 27.5 kB raw / 7.7 kB transfer, `favorites-page` 6.7 kB / 2.0 kB, `map-component` 10.3 kB / 3.6 kB (3C: 8.4 kB), `maplibre-gl` unchanged at 1.07 MB |
| 5 | Tests added | `planner/planner.spec.ts` (form validation incl. bbox edges, NaN, infinity, same place within 100 m, transfer limit; summaries, steps, 0 m walks, ride slicing both ways; store: request body, selection and line stops, empty, degraded with and without results, 429 countdown, offline, outside city, map pick, location outside the city, suggestions and swap), `core/favorites.spec.ts` (guest storage, corrupt storage, legacy migration, dedupe, replay after sign-out, partial failure and retry, gone line, no leak after sign-out or to a second account, late answer after sign-out, optimistic toggle with rollback, idempotent delete, list error), `pages/plan-favorites.spec.ts` (form, missing end, cards and steps, text only, empty, degraded, degraded banner, 429 countdown; guest list with `/giris` link, account list with merge note and sign-out, partial merge retry), `map.spec.ts` (area framing, pick only while armed, refit on a new itinerary only, layer order), `libs/ui` `itinerary.spec.ts` |
| 6 | Local stack: `docker compose -p inecekvar-p3d up -d postgres redis` (host ports 57942 and 57943), `alembic upgrade head`, `python -m app.seed`, `uvicorn` on 127.0.0.1:57940, the production build served on 127.0.0.1:57951 with `/api/*` proxied; containers removed afterwards | real `POST plan` (1-1 to 3-3 needs 2 transfers: `En çok 1` gave the empty state, `En çok 2` one itinerary ORN-1, ORN-3, ORN-2, ₺55,00); a local account signed in with cookie mode, one favourite put on the account through the API, then the app merged the 2 guest favourites with `PUT` (cookie plus CSRF) and listed 3; after the session cookie was cleared the tab showed the 2 guest favourites again |
| 7 | Screenshots: headless Chrome at 360 × 800, device scale 2, light and dark, service workers bypassed | 14 PNGs in `docs/screenshots/phase3/`: `planla-empty`, `planla-suggest`, `planla-no-route`, `planla-results`, `planla-selected`, `favoriler-guest`, `favoriler-account`; no console errors besides the expected anonymous `401` of `GET /me` and the unresolved tiles host |
| 8 | Mutation: merge without the dedupe check | 1 test fails (`merges guest favourites into the account once, deduplicated`: `PUT` sent for line-1 already on the account); restored, file identical |
| 9 | Mutation: account list kept when the user changes | 2 tests fail (`never shows the account list after sign-out or to another account`: user B saw user A's list; the replay test saw a stale entry); restored, file identical |

The screenshots were reviewed and iterated once: the first set had the two field tools wrapped
on two rows next to a swap column, the suggestion list below the tools looking like a second
input, step placards stretched to the height of their text, `10 m yürüme` for a trip without
walking (0 m legs rounded up) and transfer stops not marked on the map. The form became a single
column with the swap button on the divider, suggestions moved under their input with a stop
marker, placards align to the top, walks under 5 m are hidden ("Yürüme yok") and boarding and
alighting stops are drawn.

The local proxy presented `Origin: http://localhost:4200` (a local cookie origin of
`api/app/core/settings.py`) to the API for the cookie sign-in; the API code was not changed. The
test account was inserted directly into the local database with an argon2id hash, because there
is no sign-in screen before package 3G.

Not exercised:

- `not exercised: neighbourhood matching` (the API and the 3C index have no neighbourhood data;
  only stops are matched; a neighbourhood list belongs in the city pack of package 3E).
- `not exercised: planner degrade and 429 against the running API` (unit and page tests with the
  ADR-0020 response shapes; the real API answered normally in the screenshot run).
- `not exercised: a real basemap under the planner map` (no tiles host; the map drew the route on
  the plain background, as in ADR-0032).
- `not exercised: the bearer strategy and native Preferences for favourites` (web cookie mode only;
  Android and iOS not run).
- `not exercised: English screenshots` (English copy is covered by the compiler key check and the
  unit tests only).
- `not exercised: the 3G sign-in flow` (`/giris` is a stub; the signed-in state was produced with
  a direct API sign-in).

## Consequences

- The initial bundle grew by 9.6 kB raw, mostly Turkish copy in main (English stays lazy) and
  the favourites store, which now reads the session and the account API from every line list.
- Favourites of other accounts that signed in on the same device are never shown, but their
  merge records (account id and guest keys) stay in Preferences until the app data is cleared;
  they hold no account data.
- Per-line queues serialize merges and toggles; a newer user decision prevents a merge PUT.
- Proposals for the API owner: a `GET stops?city=&q=` route (ADR-0032) and line code, name and
  mode in `GET me/favorites`, which would remove one line read per unknown favourite.
- The `planla-light`, `planla-dark` and `planla-submitted-*` screenshots of packages 3A and 3C
  show the earlier planner placeholder.

## Review round

| # | Finding | Fix | Test(s) |
| - | ------- | --- | ------- |
| C1 | A merge could send a PUT after its account changed. | Check the captured epoch and user id after awaits and before account mutations. | `core/favorites.spec.ts`: `aborts a merge identity lookup when the account switches` |
| C2 | Stale lists restored removals and retained obsolete entries. | Reconcile the response with a per-load add/remove journal; drop other absent entries. | `core/favorites.spec.ts`: `keeps a removal made while a stale account list is loading`; `keeps new additions during loading and drops entries absent from the server` |
| C3 | Merge PUTs raced user DELETEs. | Both operations use the same city/slug queue; merging respects newer user decisions. | `core/favorites.spec.ts`: `queues a merge behind a user delete and never puts the removed line back` |
| C4 | Shared merge-record writes lost another account's records. | Separate encoded account keys; serialize storage writes and migrate the legacy shared key once. | `core/favorites.spec.ts`: `preserves both account merge records when preference writes interleave`; `migrates legacy merge records once without reimporting removed favorites` |
| C5 | Unknown favorites caused unbounded line requests. | Four-worker pool, at most 100 unknown-line resolutions per load; other entries retain minimal descriptions. | `core/favorites.spec.ts`: `resolves at most four unknown favorites concurrently`; `caps unknown favorite lookups at one hundred per load` |
| C6 | Local records grew without bounds and storage errors were hidden. | Keep the newest 200 guest favorites and 200 keys per account, retain 20 accounts in use order, and show storage failures. | `core/favorites.spec.ts`: `trims the oldest guest favorite beyond two hundred entries`; `trims the least recently merged account beyond twenty records`; `signals a rejected favorites preference write`; `pages/plan-favorites.spec.ts`: `shows a storage failure message for guest favorites` |
| C7 | Personal planner/search state survived identity changes; late details could enter the next account's cache. | Reset planner state and request generations on identity changes; guard late favorite descriptions. Search is covered in ADR-0032. | `planner/planner.spec.ts`: `clears planner on account switch and ignores late route and location`; `core/favorites.spec.ts`: `clears account state on a switch and ignores its late list`; `drops a previous account late line description before the next account reloads` |
| C8 | Late location replies replaced manual or swapped endpoints. | A location version changes on requests and form edits; only the current version may apply a fix. | `planner/planner.spec.ts`: `keeps a manual stop chosen while location is pending`; `keeps swapped endpoints when an earlier location reply arrives` |

The partial-merge and gone-line tests now inspect the per-account key instead of the legacy shared
object. Their merge expectations are unchanged. Visible account-state clearing already existed;
the additional late-description test covers the cache leak across accounts.

Storage limits replace unlimited retention. An evicted account may import current guest favorites
again on a later sign-in. The legacy shared record is removed after successful migration.
Revert check: removing the two `current()` checks after the identity lookup and before the PUT
turns `aborts a merge identity lookup when the account switches` red.
