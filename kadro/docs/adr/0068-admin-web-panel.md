# ADR-0068: Admin web panel

- Status: Proposed
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §3 story 7, §6 items 9, 12, 16 and 18, §8 (Playwright); authorization
  matrix §3.8; ADR-0014, ADR-0021, ADR-0040, ADR-0055, ADR-0064, ADR-0066, ADR-0067;
  `apps/web/app/(admin)/**`, `apps/web/components/admin/**`, `apps/web/lib/admin/**`,
  `apps/web/tests/e2e/**`

## Context

The admin API (ADR-0064, ADR-0066, ADR-0067) is complete, but staff had no screen: venue
verification, the venue import, role and ban changes and the audit log were reachable only with
hand-made requests. The panel has to keep the API's guarantees (staff role, a 15-minute TOTP
step-up bound to the session, a fresh code per role or ban change, audit rows) and the web
surface rules (nonce CSP without inline scripts, CSRF double submit, no indexing).

## Decision

1. **Routes.** A `(admin)` route group under `/admin`: `giris` (sign-in), `dogrulama`
   (step-up), `totp-kurulum` (enrollment) and, behind a staff layout, `sahalar` (verification
   queue), `sahalar/ice-aktar` (CSV upload), `sahalar/ice-aktar/[importId]` (state, counters,
   issues), `kullanicilar` (users, role and ban) and `denetim` (audit log). `/admin` redirects to
   the queue. Copy is Turkish. The mobile app has no admin screens (ADR-0064).
2. **Surface.** `/admin/**` gets its own row in the surface table (`admin`): the per-request
   nonce CSP of every HTML surface, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`
   and `Referrer-Policy: no-referrer`, so ids in panel URLs never leave in a `Referer`. The pages
   also carry `<meta name="robots" content="noindex, nofollow">`. The layout calls
   `connection()`, so every response renders per request and carries its nonce (ADR-0055). No
   page renders a script element or injects markup.
3. **Reads are API calls in process.** Server components never query admin data. They call the
   `/api/v1/admin/**` route handler functions directly with a `Request` that carries only the
   browser's cookies, the trusted client-address header and the request id, plus
   `x-kadro-client: web`. The route wrapper therefore applies exactly what a browser request gets:
   session check, staff role, step-up window, strict query validation, policy gate and logging.
   Answers are validated against the contract schemas before rendering; 401
   `step_up_required` redirects to the step-up page, other 401s to sign-in, 403 shows a notice.
   The only direct database read is the public district reference table, for `il / ilçe` labels.
4. **Mutations from the browser.** Client components send same-origin `fetch` requests to fixed
   `/api/v1` paths (`mode: same-origin`, `redirect: error`, `referrerPolicy: no-referrer`) with
   `x-kadro-client: web` and the CSRF header read from the CSRF cookie (ADR-0014). Ids are checked
   against the id format before they enter a path. Messages are chosen by problem code; server
   text is never shown. A success re-renders the server list (`router.refresh()`).
5. **Sign-in and step-up.** Staff sign in with the password endpoint, then enter a code on the
   step-up page (`POST admin/step-up`). The panel cannot ask whether a window is open (no such
   endpoint, see `docs/handoffs/wp5-6-to-contracts.md`), so it follows the API: any list read that
   answers `step_up_required` returns to the code form. Section links for admin-only areas are
   hidden from moderators as a convenience; the API still decides.
6. **Enrollment and the QR code.** Enrollment on the web takes the password as the
   re-authentication proof. The secret and `otpauth://` URI of the response live only in the
   component's memory; the QR code is encoded in the browser by a dependency-free encoder
   (`lib/admin/qr.ts`: byte mode, level M, smallest version, lowest-penalty mask) and rendered as
   one SVG path, so the secret never reaches a QR service, a server render or a log. The secret is
   also shown in groups of four for manual entry. Staff accounts without a password (Apple or
   Google only) cannot enroll on the web yet; their reset remains the operator action of ADR-0064.
7. **Fresh codes.** Role changes and bans open an inline confirmation with its own code field;
   each request carries a new code (matrix footnote 27). The panel never stores or reuses a code.
8. **Imports.** The CSV is read in the browser and sent inline; files larger than 900 000 bytes or
   without the `.csv` extension are refused before sending. Dry run is preselected. The status
   page offers a reload link while the import is queued or processing; it does not poll.
9. **End-to-end tests.** Playwright with the installed Chrome (`channel: 'chrome'`, no browser
   download) runs `apps/web/tests/e2e/**` (`pnpm --filter @kadro/web test:e2e`) against the
   production build. Its global setup starts a disposable PostGIS container, applies the
   migrations and pg-boss queues, seeds staff and players with run-time passwords and TOTP
   secrets, and serves the build on `localhost`. The suite covers headers and script nonces,
   cookie attributes, non-staff refusal, step-up, moderator limits, venue verification with its
   audit row, role and ban changes with fresh codes, the import request and enrollment from the
   QR page, and fails on any CSP violation or page error. Vitest keeps excluding `tests/e2e/**`.

## Consequences

- Every panel action goes through the same handlers, tests and audit rows as the API; the panel
  adds no authorization logic of its own.
- Venue imports are not processed by the e2e stack (no worker runs there); the suite checks the
  request, the queued state and the audit row. Worker processing stays covered by its own tests.
- Review and open-call removal have API endpoints but no panel screens yet.
- A step-up status endpoint, a closed set of import issue codes and district labels in the admin
  venue schema are requested in `docs/handoffs/wp5-6-to-contracts.md`.
