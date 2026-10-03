# Staff admin panel

The panel is the web screen for the admin API: venue verification, the venue CSV import, role and
ban changes and the audit log. It lives in the `(admin)` route group under `/admin`
(`apps/web/app/(admin)/`, `apps/web/components/admin/`, `apps/web/lib/admin/`). Decisions:
ADR-0068 (panel; Accepted), ADR-0064 (admin API and TOTP enrollment),
ADR-0066 (TOTP verification and step-up), ADR-0067 (moderation and venue import). Copy is Turkish.
The mobile app has no admin screens.

Related: [pages.md](pages.md), [architecture.md](architecture.md),
[running-and-testing.md](running-and-testing.md).

## Roles

| Role        | What the panel shows                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `user`      | "Bu alan yalnızca yetkili ekip içindir." No panel, and the admin API answers 403.                      |
| `moderator` | Venue verification queue and the user list (read). Admin-only sections are hidden from the navigation. |
| `admin`     | Everything: venue import, role and ban changes, audit log.                                             |

Hiding a section is only a convenience: every read and mutation is decided again by the API (staff
role, step-up window, admin tier). The panel adds no authorization logic of its own.

## Staff sign-in and step-up

1. `/admin/giris`: staff sign in with e-mail and password (the password endpoint of the API). The
   session is a `__Host-` cookie (HttpOnly, Secure, `SameSite=Lax`, path `/`) with a CSRF cookie
   for mutations. Accounts that only use Apple or Google sign-in have no password and cannot use
   the panel sign-in.
2. `/admin/dogrulama`: a TOTP code from the authenticator app opens the step-up window. It lasts
   15 minutes and is bound to the web session (`POST /api/v1/admin/step-up`, ADR-0066 decision 5).
3. The panel cannot ask whether a window is open (there is no such endpoint). It follows the API:
   any list read that answers `step_up_required` sends the user to `/admin/dogrulama`; other 401s
   go to `/admin/giris`; a 403 shows a notice.
4. Role changes and bans need a fresh code each time: an inline confirmation has its own code
   field and every request carries a new code. The panel never stores or reuses a code.
5. Every code check of an account shares one budget of 5 attempts per 15 minutes (ADR-0066
   decision 4), so repeated wrong codes answer 429.

## TOTP enrollment

`/admin/totp-kurulum` enrolls a staff account once (ADR-0064 decision 2, ADR-0068 decision 6):

- The password is the re-authentication proof. `POST /api/v1/admin/totp/enroll` stores a pending
  secret and `POST /api/v1/admin/totp/confirm` activates it with a first code.
- The secret and the `otpauth://` URI live only in the component's memory. The QR code is drawn in
  the browser by a dependency-free encoder (`lib/admin/qr.ts`), so the secret never reaches a QR
  service, a server render or a log. The secret is also shown in groups of four for manual entry.
- The server needs `TOTP_ENCRYPTION_KEY` (AES-256-GCM key for the stored secret). Without it,
  enrollment and step-up answer 503 and fail closed. Locally the key is optional in the schema but
  required for the panel to work.
- An active secret cannot be enrolled again (409 `totp_already_enrolled`). Resetting an active
  secret and creating the first admin are operator actions (ADR-0064, ADR-0009), not panel
  features.

## Sections

| Path                                  | Who                                    | What                                                                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/sahalar`                      | moderator, admin                       | Venue verification queue. Filter: pending (default), verified, all; search by name; cursor pagination. A verify button calls `PATCH /api/v1/admin/venues/:id`; each verification writes an audit row.                               |
| `/admin/sahalar/ice-aktar`            | admin (moderators see a notice)        | Venue CSV import. UTF-8, comma separated, header row, at most 5 000 rows; `il` and `ilce` are district short names; booleans are `true` or `false`; prices are hourly minor units. Real venue lists enter only through this import. |
| `/admin/sahalar/ice-aktar/[importId]` | admin                                  | Import state and counters (total, created or creatable, skipped as existing, rejected) and row issues. A dry run only validates. The page offers a reload link while the import is queued or processing; it does not poll.          |
| `/admin/kullanicilar`                 | read: moderator, admin; actions: admin | User list with masked e-mail; filter by name or role. Role change and ban (deactivate) each ask for a fresh TOTP code.                                                                                                              |
| `/admin/denetim`                      | admin                                  | Audit log viewer (`GET /api/v1/admin/audit-logs`), filters `action`, `targetType`, target, actor. Rows never include the IP hash or personal data.                                                                                  |

Import details (ADR-0068 decision 8): the CSV is read in the browser and sent inline; a file
larger than 900 000 bytes or without the `.csv` extension is refused before sending. Dry run is
preselected. The panel does not process imports; the worker does. An import is `queued` until a
worker runs it (`pnpm worker:dev` locally).

Not in the panel: review removal and open-call removal have API endpoints
(`/api/v1/admin/reviews`, `/api/v1/admin/open-calls`) but no screens yet (ADR-0068 consequences).

## How the panel reads and writes

- Reads: server components call the `/api/v1/admin/**` route handler functions in process
  (`lib/admin/server-api.ts`) with a `Request` that carries only the browser's cookies, the trusted
  client-address header, the request id and `x-kadro-client: web`. The route wrapper therefore
  applies exactly what a browser request gets. Responses are validated against the contract schemas
  before rendering. The one direct database read is the public district reference table, for
  "il / ilçe" labels.
- Writes: client components send same-origin `fetch` requests to fixed `/api/v1` paths
  (`mode: same-origin`, `redirect: error`, `referrerPolicy: no-referrer`) with the CSRF header read
  from the CSRF cookie. Ids are checked against the id format before they enter a path. Messages
  are chosen by problem code; server text is never shown. After a success the server list is
  re-rendered (`router.refresh()`).
- Surface: `/admin/**` is the `admin` row of the surface table (nonce CSP, `noindex, nofollow`,
  `no-store`, `no-referrer`) and the pages repeat `noindex, nofollow` in metadata.

## End-to-end tests (Playwright)

`apps/web/tests/e2e/admin.spec.ts` runs against the production build in installed Google Chrome
(`channel: 'chrome'`, no browser download; configuration in `apps/web/playwright.config.ts`, one
worker, serial specs). `tests/e2e/global-setup.ts` and `tests/e2e/support/stack.ts` start a
disposable PostGIS container (image `postgis/postgis:16-3.5-alpine`, tmpfs, random loopback port,
removed afterwards), apply the migrations and the pg-boss queues, seed staff and players with
passwords and TOTP secrets created at run time (nothing is stored in the repository), and serve
the build with `next start` on a free port. The suite covers:

- headers and script nonces on `/admin/giris`, the anonymous redirect to sign-in;
- a plain player is refused (panel and admin API);
- a moderator needs the step-up and sees only moderator sections;
- venue verification and the matching audit row;
- role change and ban, each with a fresh code;
- a venue CSV upload that lands on its status page (no worker runs in this stack, so processing is
  not covered here; the worker has its own tests);
- enrollment from the locally drawn QR code, then a step-up.

It fails on any CSP violation or page error. Vitest excludes `tests/e2e/**`.

How to run (needs Docker and Chrome; not run for this page, see
[running-and-testing.md](running-and-testing.md)):

```sh
pnpm build
pnpm --filter @kadro/web test:e2e
```
