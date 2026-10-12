# ADR-0035: Sign-in screens and contributor tools

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 3, package 3F

## Context

User story 5 asks for email and password or magic-link sign-in, a ride recorder (foreground
geolocation, Douglas-Peucker on the device, at most 5000 points), stop marking while riding,
proposals for new and changed lines, stops, fares and retirement (diff-based on the published
version) with an optional photo of the fare table or stop sign, and the list of the user's own
proposals. Story 9 puts the open-data licence before the first contribution. ADR-0007 and
ADR-0031 fix the magic link in the URL fragment and the session store that captures it;
ADR-0022 fixes trace privacy (the API trims 200 m at both ends, keeps raw traces 30 days);
ADR-0023 fixes the photo pipeline (JPEG or WebP up to 4 MiB, presigned PUT bound to
`Content-Length`, worker re-encode without metadata). Section 6.5 rate-limits proposals by
reputation and section 6.6 bounds every input.

## Decision

### Sign-in

1. Routes `/giris` (password or magic-link request), `/giris/kayit` (registration) and
   `/giris/baglanti` (the page a link opens). The session store already took `#token=` out of
   the address bar at start-up; the page only calls `completeMagicLink()`. A registration link
   answers 401 `auth.invalid_credentials` without a password, so the page asks for the password
   chosen at registration and verifies again. Native deep links (`appUrlOpen`) now also open
   `/giris/baglanti` (one change in `core/session-bootstrap.ts`).
2. Failures are mapped by `authFailure()`: every failed sign-in shows the same "wrong email or
   password" text (no account enumeration), 429 starts a countdown from `Retry-After` and
   disables the button, `auth.weak_password` lists the policy, an expired link says so.
3. Validators mirror the API: email up to 320 characters, registration password 10 to 128 NFC
   code points and not the address or its local part, sign-in password up to 1024. A breached
   password is only known to the server and is shown from its answer.
4. The password lives in a component signal only. Forms call `preventDefault()` and their
   inputs have no `name`, so nothing reaches the URL; nothing is written to history state or web
   storage; the field is cleared after success and in `ionViewDidLeave` (Ionic keeps tab pages
   alive). `?sonra=` accepts same-app paths only (`safeNext`: no scheme, no `//host`, no
   backslash, never back into `/giris`).
5. `signedInGuard` is UX only. A deep link waits up to 3 s for the start-up session check, a
   guest goes to `/giris?sonra=…`, a session still unknown (offline) is let through.
6. The registration form has no display name: the API accepts `display_name` on
   `POST auth/register` but drops it (it is not kept on the pending registration), so a field
   would silently do nothing.
7. Sign-out lives in Ayarlar > Hesap; it also deletes the unsent ride draft so positions do
   not stay on a shared device. When the server cannot be reached the local sign-out still
   happens and ADR-0031's pending revocation takes over.

### Licence gate

`LicenceGate.ensure()` resolves at once when `licence_accepted` is true; otherwise it opens a
dialog (hosted once in the tab shell) that lists what the licence means (CC BY 4.0 proposed,
attribution, contributions stay anonymised after account deletion, raw traces never published,
text awaiting legal approval) and calls `POST me/licence-accept`. Trace upload, photo presign and
proposals all go through it first. A 403 on a submission re-reads the account and asks again
once (the cached user can be stale).

### Ride recorder

- `RecorderStore` states: `idle`, `starting`, `recording`, `paused`, `review`, `uploading`,
  `uploaded`. Positions come from `@capacitor/geolocation` `watchPosition` (high accuracy, fine
  `location` permission requested in the native shell, the browser prompt on the web); there
  is no background mode. Fixes worse than 50 m are ignored (shown as weak signal), a point is
  kept after at least 5 m of movement, distance is summed from kept points.
- The Screen Wake Lock API holds the screen on while recording where it exists and is
  re-acquired when the page becomes visible; no plugin was added (no `pnpm add` in this
  package).
- The draft (`iv.trace-draft` in Capacitor Preferences) holds positions rounded to 6 decimals,
  the start and end time and the marked stops; no per-point time, speed or accuracy. It is
  written at most every 15 s while riding and at once on pause, stop marks, review and when
  the page is hidden, so a killed app loses at most 15 s and resumes paused ("interrupted").
  It is bounded: more than 20 000 points are compacted in place (Douglas-Peucker from 2 m), at
  most 50 stops, names up to 160 characters, a stored value over 2 MB or malformed is refused
  and deleted. It is deleted after a successful upload, on discard and on sign-out.
- Review shows the simplified line on the map with start and end markers and the stops, the
  recorded and sent point counts, distance and duration, and blocks sending when fewer than
  two points remain, a point is outside the city bbox, the ride is longer than 12 h or 150 km
  (the API bounds). Simplification always applies a 1 m tolerance and widens it by half until
  at most 5000 points remain; the ends are kept and the start and end are not trimmed here
  (the API trims, ADR-0022). The body is exactly `{city, started_at, ended_at, points}` with
  `[lng, lat]` points and whole-second times.
- Failures keep the draft: 429 shows the countdown, offline says it stays on the phone,
  `trace.outside_bbox`, `trace.future_end` and 413 have their own copy. After the upload the
  user can delete the trace (`DELETE traces/{id}`), propose a new line from it (`trace_id`,
  `geometry_source: trace`) or propose each marked stop as a new stop (kept in memory only).

### Stop marking

One large button ("Durak işaretle") adds the last accepted position as a stop, then offers an
optional name field; names can be edited or the stop removed on the review screen.

### Proposals and photos

- `/katki/oneri?tur=` covers `new_line`, `update_line`, `fare_update`, `retire`, `new_stop`,
  `update_stop`. Line and stop proposals load the target from the API (never the offline pack,
  whose ids are not the server's) so `base_version_no` is the published version. Updates send
  only changed fields; an emptied field means unchanged (the contract cannot clear a field
  through a proposal). New lines pick at least two stops in order from the API stop list.
  The Katkı hub offers the line kinds when opened from a line page ("Bu hat değişti", already
  wired by 3C) and the stop page got a "Bu durak değişti" button (`pages/stop.page.ts`).
- Fares are typed in lira (`25`, `25,50`, `₺1.250,00`) and sent in kuruş up to ₺100 000; the
  form shows the current fare with its update date. `FareUpdate` has no date field: the form
  says the fare is reported as of today and the server stamps the date on approval.
- Photos: the client checks the declared type and the magic bytes (JPEG or WebP) and the size
  (1 byte to 4 MiB) before anything is sent, presigns with that type and exact size, then
  `ContributionApi.uploadPhoto()` PUTs the file with the signed headers only (no credential,
  cookie or request id; the browser sets `Content-Length` from the body; a signed length that
  differs from the file is refused before sending). The app never reads EXIF and never uses or
  shows a location from it; the worker strips metadata. Upload states: preparing, uploading,
  done, rejected (type, size, empty), failed (offline, quota with countdown, storage off,
  expired upload) with retry.
- The worker picks a photo up only after its presign window (300 s) and runs every minute, and
  the API refuses an unprocessed photo with 404 `photo.not_found` while counting the attempt
  against the daily proposal quota. The form therefore holds the send button for
  `expires_in + 60` s after the upload, says so, and lets the user remove the photo to send at
  once.
- `/katki/onerilerim` lists the user's proposals with a state badge (pending, approved,
  rejected; shape plus colour) and, for rejected ones, the moderator's reason as plain text.
- Everything user-typed or server-provided is interpolated as text; no HTML binding.

### Translations and bundle

Transloco tr and en for every string. The sign-in and contributor copy is split into
`i18n/contrib.tr.ts` and `contrib.en.ts`: English loads with `en.ts`; Turkish is merged by the
`contributorCopy` route guard before those routes render, so the main bundle does not carry it
(initial 716.8 kB raw, 3E 703.8 kB; budget warning at 720 kB not reached).

## Additions outside the app

- `libs/data-access`: `ContributionApi.uploadPhoto(upload, body, signal?)` (the only new
  method; it uses the existing `FETCH` token and `send()`), with `upload.spec.ts`.
- `libs/ui`: `StatusBadgeComponent` and `styles/forms.css` (form controls, segmented control,
  chip toggles), imported in `apps/mobile/src/styles.scss`.
- Minimum wiring in earlier packages' files: `app.routes.ts` (five routes, guards),
  `tabs/tabs.page.ts` (licence dialog host), `core/session-bootstrap.ts` (native link opens the
  consume page), `pages/settings.page.*` (account panel and sign-out), `pages/stop.page.ts`
  (report button), `pages/contribute.page.*` (hub rewritten), `i18n/i18n.ts`,
  `translation.ts`, `i18n.spec.ts`, `testing/i18n.testing.ts`, `testing/catalog.fixtures.ts`
  (fakes extended additively), `apps/mobile-e2e/serve.mjs` (`IV_E2E_ORIGIN` presents an allowed
  local web origin to the API, as Caddy's same-origin setup does).

## Evidence

Run on 2026-10-12 on the owner's Windows 11 machine, branch `feat/inecekvar-p3`:

| # | Command or check | Result |
| - | ---------------- | ------ |
| 1 | `pnpm nx run-many -t lint test build -p data-access domain mobile ui --skip-nx-cache` | exit 0; lint clean; data-access 104 tests, domain 4, ui 22, mobile 277; production build without budget warnings |
| 2 | `pnpm exec prettier --check` on the changed paths | clean |
| 3 | Bundle | initial 716.8 kB raw / 176.7 kB transfer; `proposal-page` 32 kB, `recorder-page` 18 kB, `contrib-tr` 11 kB lazy chunks |
| 4 | Unit and page tests added | `contribute/contribute.spec.ts` (dedupe, Douglas-Peucker corners and doubling back, 1 m base tolerance with a distance-to-line property check, 12 000 and 100 000 point caps, draft parsing refusals, refused write; recorder: permission denied, spacing and accuracy filter, pause ignores fixes, permission withdrawn mid-ride, stop marking, app kill and restore, hidden page write, exact upload body, 6500 fixes capped at 5000, draft compaction, licence decline then accept, 429 and offline keep the draft, bbox block, too few points, discard, delete uploaded, watch start failure), `auth/auth.spec.ts` (validators, generic sign-in error, 429, open-redirect refusal, guard incl. waiting and offline, licence gate), `pages/auth-pages.spec.ts` (validation, sign-in with return path and nothing kept in URL, history or storage, external return refused, generic failure, 429 countdown, field cleared on leave, magic link sent and paced, register policy hints and server answer, consume page missing, verify, registration password, expired), `proposals/proposals.spec.ts` (fare parsing, all six builders and diffs, magic bytes, size bounds, presign and upload failures with retry, quota countdown, licence before presign, processing hold), `pages/contribute-pages.spec.ts` (hub guest and line actions, new line with ordered stops, update diff, fare with date and 429, licence declined, photo attached after processing, renamed PNG refused, proposal list states and plain-text reason, list error, recorder walk-through), `libs/ui` `status-badge.spec.ts`, `libs/data-access` `upload.spec.ts` |
| 5 | Local stack: `docker compose -p inecekvar-p3f up -d postgres redis minio mailpit` (host ports 57962-57967), `alembic upgrade head`, `python -m app.seed`, `uvicorn` on 127.0.0.1:57960 and the `arq` worker with `INECEKVAR_HIBP_ENABLED=false` and `INECEKVAR_PRESIGN_TTL_SECONDS=30`, `serve.mjs` on 127.0.0.1:57970 with `IV_E2E_ORIGIN=http://localhost:4200`; containers and volumes removed afterwards | |
| 6 | `pnpm nx run mobile-e2e:e2e --skip-nx-cache` (Chromium, 360 × 800) on a freshly seeded database | 2 passed: the 3E pack scenario and `sign-in-contribute.spec.ts`: a guest opening the recorder lands on `/giris?sonra=`; registration, the link read from Mailpit, the token gone from the address bar, the password asked and the account opened in cookie mode; nothing secret in web storage; magic-link request; a 36-fix ride with a named stop, review on the map, licence dialog, `POST traces` body with exactly the four keys, draft deleted; fare proposal with a canvas-drawn JPEG through presign and a credential-free PUT to MinIO, send held until the worker processed it, then 201; hours update and new stop; a second account promoted to moderator in the database approved the fare and rejected the stop with a reason; the list shows the three states |
| 7 | Screenshots, light and dark, in `docs/screenshots/phase3/` | `giris`, `giris-link-sent`, `katki`, `katki-kayit-idle`, `katki-kayit-recording`, `katki-kayit-review`, `katki-lisans`, `katki-oneri`, `katki-foto`, `katki-onerilerim` |
| 8 | Mutation: licence gate skipped in `RecorderStore.submit` | 1 test fails (`does not send without the licence and sends once it is accepted`); restored, file identical |
| 9 | Mutation: raw points sent instead of the simplified line, cap check removed | 2 tests fail (`sends the reviewed ride…`, `never sends more than 5000 points however long the ride`); restored |
| 10 | Mutation: password written to `sessionStorage` on sign-in | 2 tests fail (`signs in … keeps the password nowhere`, `shows one generic message for a failed sign-in`); restored |

The screenshots were reviewed and iterated once: the selected segment of the sign-in method
switch disappeared in dark mode (chrome on chrome), the photo box legend sat above its border
and wrapped, a missing fare date printed "—", and an hours-only update had no subject line in
the proposal list. The segment now inverts ink and background, the legend sits inside the box,
the fare line says "güncelleme tarihi yok" and the list falls back to the changed text or fare.

Findings from the real run that changed the client: registration rejected `example.test`
addresses (the API's email validation refuses special-use domains), the guard let a deep link
through while the start-up session check was still running, `display_name` at registration is
dropped by the API, and a photo is attachable only after the presign window.

## Proposals for the API owner

- Process a photo when its upload completes (or let a proposal reference a pending photo), and
  do not count refused proposal attempts (404 `photo.not_found`) against the daily quota.
- Keep `display_name` from `POST auth/register` on the pending registration.
- A field to clear optional line texts (hours, hail notes) through `update_line`.

Not exercised:

- `not exercised: the native shell` (no `cap sync`, no emulator run: Android location
  permission prompts, `watchPosition` with the screen locked, the app being killed by the OS,
  native deep links into `/giris/baglanti` and the bearer strategy were covered by unit tests
  with fakes only; iOS not available).
- `not exercised: background recording` (out of scope by design; foreground only).
- `not exercised: a real wake lock` (headless Chromium reported "ekran kapanabilir"; the unit
  tests use a fake).
- `not exercised: HIBP and real email delivery` (HIBP disabled locally, Mailpit caught mail).
- `not exercised: Cloudflare R2` (MinIO stand-in, as ADR-0023).
- `not exercised: the 429 paths against the running API` (unit and page tests with the API's
  problem shape and `Retry-After`; an earlier real run did hit the proposal quota, which is how
  the photo-processing finding surfaced).
- `not exercised: English screenshots` (English copy is covered by the key-parity test).
- `not exercised: a real basemap under the review map` (no tiles host; the route is drawn on
  the plain background as in ADR-0032).

## Consequences

- A contributor who attaches a photo waits about six minutes before sending in production, or
  removes the photo; the form explains this until the API processes uploads sooner.
- The ride draft stores personal positions on the device until upload, discard or sign-out;
  the recorder's privacy note says so before recording starts.
- The e2e scenario changes data (approval publishes a line version), so it runs after the pack
  scenario and expects a freshly seeded database for a rerun of both.

## Review round

Draft coordinates, uploaded marks and proposal state belong to one account. Pending work is
invalidated when its account or form changes. Cleanup failures remain visible and are retried
at startup, on account changes and on the next draft load.

Test files below are in `apps/mobile/src/app`: C = `contribute/contribute.spec.ts`,
P = `pages/contribute-pages.spec.ts`, U = `proposals/proposals.spec.ts`,
B = `core/session-bootstrap.spec.ts`.

| # | Finding | Fix | Test(s) |
| --- | --- | --- | --- |
| F1 | Local coordinates cross accounts. | Store owner and draft ids; delete legacy or foreign drafts, reset on identity changes and check ownership before upload. | C: `deletes account A draft instead of loading it for account B`; `deletes a legacy draft without an owner`; `refuses to upload a draft owned by another account`; `clears the in-memory ride when the signed-in user changes` |
| F2 | Uploaded stop marks survive discard and prefill unrelated forms. | Reset all recorder state; require an integer mark parameter and matching owner and city. | C: `discard resets uploaded marks and every recorder readout`; P: `does not prefill an uploaded stop when isaret is absent`; `does not prefill uploaded marks belonging to another user`; `rejects non-integer and negative mark indexes` |
| F3 | Cached proposal lists show another account or stale results. | Key requests and visible rows by user id, reload on Ionic entry and drop stale responses. | P: `clears account A proposals immediately when the user changes`; `reloads proposals on every Ionic page entry for the same user`; `drops a late account A proposal list after switching to account B` |
| F4 | Form data and photos survive account or target changes. | Reset fields, searches, errors and photo work on account, kind or target changes. | P: `clears a selected photo when the proposal target changes`; `resets the cached proposal form and photo when the user changes` |
| F5 | Concurrent transitions leak watches or restart discarded rides. | Lock transitions before awaiting, invalidate operations and close late watch handles. | C: `concurrent resumes open only one live position watch`; `discard invalidates a start waiting for location permission`; `closes a late watch handle after discard` |
| F6 | Submissions duplicate during the licence wait. | Set submission locks synchronously and check account and draft or form generation after awaits. | C: `submits a trace only once while the licence check is pending`; P: `submits a proposal only once during a deferred licence check` |
| F7 | An old upload erases a replacement draft. | Abort on discard and account changes; apply results only to the captured generation, draft and owner. Serialize local writes and deletes. | C: `a late trace upload cannot erase the replacement recording` |
| F8 | Obsolete photo selections upload after clear or replacement. | Create a controller and generation before validation; invalidate and abort on selection, clear and destruction. | U: `only uploads the latest photo after an earlier licence wait resolves`; `clear during photo validation prevents a later upload` |
| F9 | An earlier target response overwrites a newer target of the same kind. | Abort previous target requests and match the full current target and request before applying success or failure. | P: `drops an earlier line target response when the next line resolves first` |
| F10 | New lines without geometry always fail on the server. | The contract field is `geometry`; this form has no manual geometry input, so require a trace and offer the recorder route. | U: `requires a trace for a new line without a geometry input`; P: `offers the recorder and blocks a complete new line without a trace` |
| F11 | Failed local deletion is silently reported as success. | Retry deletion three times, retain a cleanup marker and flag, block successful completion and show translated recovery copy. Retry pending deletion at startup and on load. | C: `retries a refused draft deletion before reporting discard success`; `surfaces failed cleanup and retries it on the next draft load`; B: `retries pending coordinate cleanup during app startup` |
| F12 | Photo presign retries trust stale licence state. | Recheck the licence after the first presign 403 and retry exactly once; a second 403 fails. | U: `rechecks the licence and retries photo presign once after a 403`; `a second photo presign 403 fails without a third call or another recheck` |

The existing `builds a new line with ordered stops and sends it` page test now supplies a trace;
its previous setup accepted a line with neither trace nor geometry. The draft fixture includes
owner and draft ids, and its storage test passes the current owner to `load`. The e2e scenario
submits fares, hours and stops, so it needs no change. Revert checks: loading a draft whatever
its owner turns `deletes account A draft instead of loading it for account B` red; leaving the
uploaded marks in place on discard turns `discard resets uploaded marks and every recorder
readout` red; deriving the mark index with `Number(rawIndex)` turns `does not prefill an
uploaded stop when isaret is absent` and `rejects non-integer and negative mark indexes` red.
