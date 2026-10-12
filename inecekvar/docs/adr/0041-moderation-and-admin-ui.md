# ADR-0041: Moderation and admin UI

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 4, package 4E (builds on ADR-0021, ADR-0037, ADR-0038)

## Context

Section 3 story 6 asks for a moderation queue with a map diff, approval into an immutable
version, rejection with a reason, rollback to any version and no self-approval. Section 6.18 asks
for a role-guarded `/admin` UI with a TOTP step-up for `admin/**`, rollback and retirement, and
an admin e2e; section 6.4 keeps every decision in the API; section 6.16 bans HTML sinks; section 7
keeps `/admin/**` out of indexes and sitemaps. ADR-0037 defines the TOTP, step-up and admin
routes and their codes; ADR-0038 keeps the session and auth parts of `libs/data-access` out of
every public SSR bundle and bypasses the page cache for `/admin`.

## Decision

### Routing and the bundle boundary

1. `/admin` is a lazy route that renders on the client only (`RenderMode.Client` for `admin` and
   `admin/**`; the server sends the CSR shell). The route's `loadChildren` asks an injection token
   (`ADMIN_ROUTES_LOADER`, `src/app/admin-entry.ts`) for the routes. Only the browser entry
   (`src/main.ts`) provides the real loader, a dynamic import of `app/admin/admin.routes`; the
   token's default (used on the server and in route extraction) is a placeholder route. The server
   bundle therefore never contains admin code or the session store, and the browser loads the
   admin chunk only when `/admin` opens.
2. Lint (`apps/web/eslint.config.mjs`): public code may not import `admin` paths (pattern) nor
   load them with `import()` (selector); `src/main.ts` is the one exception for the dynamic
   import. Files under `src/app/admin/**` may import `@inecekvar/data-access`; the HTML-sink,
   sanitizer-bypass, JSON-LD and browser-storage bans stay in force there.
3. `web:bundle-check` (`apps/web/scripts/check-public-bundle.mjs`) now distinguishes the server and
   browser output. Markers are the four data-access markers plus `data-iv-admin` (the admin shell
   host attribute). It fails when the server output contains any marker, when the browser entry
   (main, polyfills, the `modulepreload` links of `index.csr.html`) or anything it imports
   statically contains one, when a chunk public code can reach imports a marked chunk statically,
   when no chunk carries the admin marker (so the check cannot pass vacuously) or when an admin page
   is prerendered.

### Session, API and errors

4. The admin route provides its own instances of `ApiClient`, `AuthApi`, `AccountApi`,
   `SessionStore` and `CookieAuthStrategy` (always cookie plus CSRF, never bearer) with
   `API_BASE_URL = /api/v1`, same origin behind the reverse proxy. The SSR server answers GET and
   HEAD only, so `/api/*` must be routed before it: Caddy does this in production and locally
   (`ops/Caddyfile`, `docker compose up caddy`, web dev server on 4200, API on 57800); the e2e uses
   `apps/web-e2e/admin-proxy.mjs` with the same shape.
5. Sign-in is password only through the shared auth API; the magic link is not offered in the
   admin. An account without the moderator or admin role is signed out at once with a notice.
   Guards (`staffGuard`, `roleGuard(['admin'])`, `guestGuard`) are UX only; every screen shows the
   API's answer, including a 403 the UI did not expect.
6. `AdminSession` keeps a generation number that changes on every account switch, sign-out or
   server-ended session. The queue store, the step-up window, open dialogs and the TOTP status reset
   on each change, so a second account never sees the first one's queue. A 401 anywhere ends the
   session in the strategy; the shell returns to the sign-in page with "Oturumun sona erdi".
   Because another tab of the same browser can sign out or sign in as someone else on the shared
   cookie, the shell re-reads `GET me` (`AdminSession.recheck`, one request for concurrent calls)
   whenever the window regains focus or the tab becomes visible; a different user id moves the
   generation, so the area resets before the person acts on a stale account. (The first version
   sampled the identity only at start, sign-in, sign-out and 401.)
7. Problem codes map to Turkish copy in `admin-errors.ts`; bodies, details and request ids are never
   shown. A 403 `auth.forbidden` reads as "kendi önerini onaylayamazsın ya da rolün yetmiyor" on the
   approve button and as a role message elsewhere; 409 `admin.last_admin`, the reciprocal-approval,
   version-conflict, export and rate-limit (`Retry-After` in minutes) codes have their own text.

### Step-up and TOTP

8. `StepUpService.run(action)`: an answer of 403 `auth.step_up_required` opens the code dialog;
   after `POST auth/step-up` succeeds the action runs exactly once more and that answer is final
   (no loop). A wrong or replayed code keeps the dialog open; `auth.totp_enrolment_required` or a
   401 ends the flow; cancelling rejects without retrying; concurrent actions share one dialog.
   Before the retry the service calls `AdminSession.recheck()`; if the account changed or the user
   id differs from the one that started the action, the retry is not sent, the step-up state is
   reset and the action fails with `AccountChanged` ("Oturumdaki hesap başka bir sekmede değişti;
   işlem yapılmadı …"). All
   moderation approvals, rollback, and every admin call go through it.
9. Enrolment: `POST me/totp/enrol` returns the secret and the otpauth URI once. The QR is drawn in
   the page by an in-repo encoder (`admin/totp/qr-code.ts`: byte mode, level M, versions 1 to 40,
   ISO/IEC 18004 penalty rules) as one SVG path bound with `[attr.d]`; only `otpauth://totp/` URIs
   are drawn; no external QR service and no added dependency. The secret is shown grouped with a
   copy button and a one-time warning, lives only in the component and is dropped on confirmation
   or when the page is left. Code inputs use `inputmode="numeric"` and
   `autocomplete="one-time-code"`; codes travel only in POST bodies.

### Screens

10. Queue (`/admin/kuyruk`): pending edits with kind, city, author name (text only), a map diff drawn
    from the numeric `current_geometry` and `proposed_geometry` (old dashed grey, new turquoise,
    unchanged as one line, a retirement dashed red), the server diff as text rows (fare in TRY,
    hours, notes, payment methods, stop and point counts, status) and "Fotoğraf eklenmiş; önizleme
    yok" when a `photo_id` exists, because the API offers no presigned read for moderators. The
    reviewer's own proposals (from `GET edits`) are marked and their buttons disabled; the API's
    403 is still shown if the UI did not know. Reject needs a reason of 1 to 1000 characters.
    Retirement is the approval of a `retire` edit (ADR-0021): confirmation dialog, then step-up.
11. Versions (`/admin/surumler`): city, line search, version table, "Bu sürüme dön" with a
    confirmation and the step-up.
12. Admin only: users and roles (`/admin/kullanicilar`, paged, role filter, confirmation, the
    select returns to the stored role when a change fails), export per city (`/admin/disa-aktar`)
    and the audit log (`/admin/denetim`, filters validated like the API, empty dates mean the last
    30 days, at most 366 days, Istanbul day bounds, offset paging).
13. Every button is disabled while its request runs and a second click is ignored; rollback,
    retirement and role changes ask for confirmation (focus on "Vazgeç", Escape cancels). Text is
    Turkish in TypeScript constants, as on the public pages (the web app has no translation
    mechanism and no dark mode, so there is no English and no dark variant). User text is rendered
    by interpolation only.

### Server headers

14. `isAdminPath` (shared with the page cache) matches `/admin` as the first path segment after
    one percent-decoding, in any case, followed by `/`, `;` or the end: `/admin`, `/ADMIN/x`,
    `/%61dmin`, `/admin;x`, `/ADMIN%3Bx`; an undecodable path counts as admin. The first version
    claimed "any case or encoding" but missed `/admin;x`, which then received the shell without
    `X-Robots-Tag` and with `private, no-cache`. Matching paths get `X-Robots-Tag: noindex,
    nofollow`; canonical admin paths get the CSR shell with HTML `Cache-Control: no-store` and the
    shell adds `<meta name="robots" content="noindex,nofollow">`; non-canonical ones (`/admin;x`,
    `/admin/kuyruk;v=1`) are refused with a `no-store` 404 by URL normalization and encoded
    spellings (`/%61dmin/kuyruk`) are redirected to the canonical path. The global CSP (with
    `frame-ancestors 'none'`), the cache bypass and `Disallow: /admin` in robots are unchanged;
    sitemaps list only API data and content paths.
15. Admin origin (deployment, no code change): the staff session cookie `__Host-iv_session` has
    `Path=/`, so while the admin lives under `inecekvar.app/admin` every public page request of a
    signed-in moderator carries it, and the CSRF cookie, to the public SSR Node process, which
    never reads them. Production should serve the admin on a separate origin (for example
    `yonetim.inecekvar.app`) or behind a path whose cookie never reaches the public SSR node. The
    repository holds only the local `ops/Caddyfile`; no production proxy configuration exists, so
    this is recorded for the hosting work (`docs/ops/env.md`, "Admin origin and the staff session
    cookie") rather than claimed as done.

### API gaps (no API change made)

- `QueueOut` carries no author id, so own proposals are detected through `GET edits`; an own
  proposal beyond the first 100 would only be refused by the API (the 403 is shown).
- There is no presigned read for proposal photos; the queue says "önizleme yok".
- `GET lines` lists published lines only, so a retired line cannot be found for a rollback from
  the versions screen.
- Audit rows show actor and target ids, not names (the API returns ids only).

## Evidence

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 1 | Baseline | `pnpm nx run-many -t lint test build -p web ui domain data-access --skip-nx-cache` | 9 tasks succeeded |
| 2 | Workspace gate | same command after the package | "Successfully ran targets lint, test, build for 4 projects"; web 704 tests (11 admin spec files, `server/admin-headers.spec.ts`), data-access 110, ui 39, domain 4 |
| 3 | Bundle boundary | `pnpm nx run web:bundle-check` | "Admin chunks (lazy, browser only): chunk-…js; initial browser chunks: 3; marked chunks: 1" and "Public web bundle clean: 60 files, 5 markers"; admin chunk 97.7 kB raw, 26.7 kB transfer |
| 4 | QR encoder | `qr-code.spec.ts` against matrices from segno 1.6.6 (level M, byte mode, its padding step corrected to ISO/IEC 18004 7.4.10) | version 1 with all 8 masks, version 8 (version bits, 4 blocks) with the automatic mask: identical; a version 12 case also matched during development |
| 5 | Web e2e with the real API | `node apps/web-e2e/scripts/real-stack.mjs up` (compose project `iv4e`, 127.0.0.1:57941-57946, fresh database, migrations, sample city, Redis `FLUSHALL`), then `IV_E2E_REAL_API=1 pnpm nx run web-e2e:e2e` (uvicorn 127.0.0.1:57947 with `INECEKVAR_ENV=local`, a per-run `INECEKVAR_TOTP_ENCRYPTION_KEY`, proxy 57996) | 56 passed (32 s): the 50 earlier specs, 5 admin-shell checks and `moderation.spec.ts` (11 s); stack removed afterwards (`down -v`) |
| 6 | Moderation scenario | `moderation.spec.ts` | contributor (API, bearer) proposes a fare change and a retirement; moderator signs in on `/admin` (cookie), approves the fare; rollback without TOTP shows the enrolment message; after enrolment the rollback answers 403 `auth.step_up_required`, the dialog takes a code from an RFC 6238 helper and the single retry answers 200 (new version, fare restored, checked through the API); retirement after confirmation (step-up still valid); a moderator is sent away from `/admin/kullanicilar`; sign-out leaves no queue; the admin enrols, steps up, sees `moderation.approve`, `moderation.rollback`, `auth.step_up`, `totp.confirm` rows, filters to one rollback row, is refused demoting itself (last admin) and exports the sample city; no password or code in web storage or URLs |
| 7 | Admin shell e2e (no API needed) | `admin-shell.spec.ts` | first version: `/admin`, `/admin/kuyruk`, `/admin/denetim` only; since the phase 4 review all nine admin paths (`/admin`, `giris`, `kuyruk`, `surumler`, `dogrulama`, `kullanicilar`, `disa-aktar`, `denetim`, an unknown child) on the test and production servers: 200, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, CSP with `frame-ancestors 'none'` and a fresh nonce, `X-Cache: BYPASS` twice; robots disallows `/admin`; sitemap index and city sitemaps contain no `/admin`; four public pages never request the admin chunk; the sign-in screen renders client-side with the robots meta, labelled fields, no CSP violation and empty web storage; the TOTP helper matches the RFC 6238 vector ; second test "matrix and encoded admin variants are noindex and never serve the shell": `/admin;x`, `/ADMIN%3Bx`, `/admin%3bx/kuyruk`, `/admin/kuyruk;v=1` answer 404 with `X-Robots-Tag` and `no-store` and no shell, `/%61dmin/kuyruk` answers 301 to `/admin/kuyruk` with `X-Robots-Tag` |
| 8 | Without the stack | `pnpm nx run web-e2e:e2e` | 55 passed, 1 skipped (the moderation scenario names the missing stack) |
| 9 | Screenshots | `docs/screenshots/phase4/admin-*-{360,1280}.png` | sign-in, queue, versions, rollback confirmation, step-up dialog, TOTP enrolment (secret and QR masked), audit log, users, export; reviewed and revised once (stacked tables below 40rem, clearer map diff for unchanged and retired lines, link colour, full masking of the secret, role select reset) |
| 10 | Mutation: step-up retries in a loop | `return this.run(action)` instead of one retry | red: `step-up.service.spec.ts` "retries only once: a second auth.step_up_required is final and opens no new dialog" (re-run after the phase 4 review); restored |
| 11 | Mutation: UI role check hides the API error | users page drops 403 messages | red: `users.page.spec.ts` "shows the API 403 instead of hiding it behind the UI role check" (re-run after the review); restored |
| 12 | Mutation: public route loads the admin chunk | `app.routes.ts` imports `./admin/admin.routes` directly | lint error (`no-restricted-syntax`) and `web:bundle-check` red (all five markers in a server chunk), restored (not re-run after the review) |
| 13 | Mutation: admin code in the initial bundle | `main.ts` imports the admin routes statically | `web:bundle-check` red ("initial browser chunk main-…js", five markers), restored (not re-run after the review) |
| 14 | Mutation: own proposal not blocked | the own-edit check in `QueueStore.approve` disabled | red: `queue.store.spec.ts` "blocks approving an own proposal without calling the API" (re-run after the review); restored |
| 15 | Words | the CI banned-word grep over the new files | clean |
| 16 | Review fix: `/admin;x` classified as admin | `server/admin-headers.spec.ts` "are noindex and no-store: %s" and "classifies %s" with `/admin;x`, `/ADMIN%3Bx`, `/admin%3bx/kuyruk`, `/%61dmin%3b`, `/admin;x/kuyruk`, `/admin/kuyruk;v=1` | mutation "`;` removed from the separator class (the first version)": red, 3 header cases and 4 classification cases; restored |
| 17 | Review fix: account re-check | `admin-session.spec.ts` "re-checks GET me and resets everything when another tab signed in as someone else", "keeps the generation when the re-checked account is unchanged and shares one request", "does not call GET me while signed out", "treats a session ended during the re-check as an account change"; `step-up.service.spec.ts` "re-checks the account after a valid code and aborts the retry when another tab switched it", "aborts the retry when the user id differs from the one that opened the dialog", "re-checks the account before the retry when it is unchanged"; `shell/admin-shell.component.spec.ts` "re-checks GET me when the window regains focus", "re-checks GET me when the tab becomes visible, not when it is hidden", "stops listening once the shell is destroyed" | mutations: step-up owner check disabled → the two abort tests red; `recheck` without `GET me` → 3 session tests red; shell handler empty → the focus and visibility tests red; all restored |

## Not exercised

- `not exercised: axe` (no axe package in the workspace and no dependency added); a lighter check
  asserts that every form control on the admin screens has a label.
- `not exercised: a real authenticator app scanning the QR` (the matrix is checked against an
  independent encoder; the e2e types the secret through an RFC 6238 helper).
- `not exercised: Firefox and Safari` (Chromium only), real hosting behind Caddy with TLS (the e2e
  proxy has the same routing shape), and the CI run (branch not pushed).
- `not exercised: photo preview` (no presigned read in the API), dark mode and English (the web app
  has neither).
- `not exercised: the Caddy dev proxy in this package` (documented above; the e2e used its own proxy).
