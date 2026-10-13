# ADR-0057: Web account deletion, first-run bootstrap and app links on the PWA host

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 6, package 6G

## Context

Package 6F found release blockers that engineering can close: Google Play asks for a web path to
request account deletion and `/hesap-silme` had none (`privacy-labels.md` M5, specification story
10 and item 21); no tool created the first admin or the first real city (release checklist G3,
G4); the PWA host served no app-link association files (G6); signing property files were not
ignored; 14 web and proxy keys were documented outside `docs/ops/env.md`; and the cost note named
a tiles path the code never reads.

## Decision

1. **Web deletion panel.** `/hesap-silme` stays a server-rendered, indexable content page. A
   `DeletionSlot` (`apps/web/src/app/deletion-entry.ts`) renders a heading and a fallback
   sentence on the server; after hydration it calls `DELETION_PANEL_LOADER`, which only the
   browser entry (`main.ts`) provides, and mounts `DeletionPanelComponent`
   (`apps/web/src/app/deletion/`) with its own providers in a child environment injector:
   `API_BASE_URL = /api/v1`, `CookieAuthStrategy`, `ApiClient`, `AuthApi`, `AccountApi`,
   `SessionStore`. Same architecture as `/admin` (ADR-0041): the server bundle and every public
   chunk stay free of the session client. ESLint bans static and dynamic imports of
   `src/app/deletion/**` outside `main.ts`; `check-public-bundle.mjs` now also requires a lazy
   chunk carrying `data-iv-deletion` and treats it as marked.
2. **Flow.** Email and password sign-in only (the page says magic-link sign-in is not offered and
   passwordless accounts delete in the app). Before sign-in the page warns that signing in during
   the grace period cancels an earlier request (ADR-0026 rule, so "already requested" is handled
   by telling the person not to sign in). After sign-in it lists what goes now, after 7 days and
   what stays under the licence as "silinmiş katkıcı", with the app's wording. `DELETE me` is sent
   only with the password typed again and the confirmation box ticked; the API answers 202
   `{"status":"deletion_scheduled"}` with no date, so the page shows the result and the fixed
   7-day grace from `FACTS` and says the answer carries no exact date. Wrong password: the session
   stays (the shared client treats `auth.invalid_credentials` as an answer, the 3G rule), the
   field is cleared, retry possible. 429 shows `Retry-After`; offline (`navigator.onLine`) sends
   nothing; a network error reads as offline; `admin.last_admin` has its own copy; any other 401
   ends the flow. On success the page forgets inputs and sign-in state; the API clears the cookie.
   Leaving the page while signed in logs out. Messages come from the status and problem `code`
   only; no problem body, `detail` or request id is rendered.
3. **Robots and privacy text.** Unchanged indexability (ADR-0040 amendment). `/gizlilik` and the
   FAQ name the deletion panel as the second place that sets session and CSRF cookies.
4. **Bootstrap.** `python -m app.ops.bootstrap admin --email A [--password-stdin]
   [--force-additional]` promotes an existing account or creates one (password from stdin only,
   registration policy enforced), refuses while another active admin exists unless
   `--force-additional`, sets `email_verified_at`, revokes earlier step-ups and leaves TOTP alone,
   so the first step-up action answers `auth.totp_enrolment_required`. `city --slug --name --bbox
   --timezone` creates an empty non-sample city, validates slug, name, bbox (order, ranges, finite,
   at most 3 degrees per side) and IANA zone, is a no-op for identical values and refuses changed
   ones or the sample slug. Audit rows: `ops.bootstrap_admin` (account id, keyed HMAC digest of the
   address in `diff_hash`), `ops.bootstrap_city` (city id). Output is one JSON line without
   address, password, key or database URL; invalid settings print field names only. Settings are
   the API's (`INECEKVAR_ENV=production` needs the full API environment).
5. **App links on the PWA host.** `ops/Caddyfile` snippet `(app_association)` forwards
   `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` on the PWA site to
   the web SSR server with `Host: {$INECEKVAR_WEB_HOST:inecekvar.app}`; compose passes the key.
   The values stay owner-provided (`IV_WEB_ANDROID_CERT_SHA256`, `IV_WEB_IOS_TEAM_ID`).
6. **Small fixes.** `key.properties`, `keystore.properties` and `*signing*.properties` under
   `apps/mobile/android` ignored (both `.gitignore` files), `gradle.properties` still tracked; the
   web and Caddy keys documented in `docs/ops/env.md`; the cost note's cache rule now matches
   `*.pmtiles` at the root of the tiles host, as `export/router.py` and `basemapUrlFor` build it.

7. **Review amendment: the address can stay off the command line** (phase 6 review F15).
   `admin --email-stdin` reads the address from the first stdin line (the password, with
   `--password-stdin`, from the second); without `--email` or `--email-stdin` the command reads
   `INECEKVAR_BOOTSTRAP_EMAIL`. Every stdin line is bounded (`STDIN_LINE_MAX`, 1024 characters;
   longer is refused with exit 2), and `--email` and `--email-stdin` exclude each other. Tests:
   `test_address_from_stdin_or_environment_stays_off_the_command_line`,
   `test_stdin_lines_are_bounded_and_checked`, `test_email_and_email_stdin_are_exclusive`; red with
   the change reverted.

## Evidence

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 1 | Bootstrap tests | `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest -q tests/ops` | `18 passed`: empty database creates the admin (audit digest, no address or password in output, then `GET /v1/admin/users` answers 403 `auth.totp_enrolment_required`), promotion, unchanged, second admin refused then allowed with `--force-additional`, refusals write nothing, idempotent city, 7 invalid bbox cases, 5 invalid argument cases, sample slug, CLI subprocess output scanned for password, address, log hash key, CSRF secret, PEM marker and database password |
| 2 | Web unit tests | `pnpm nx run web:test` | 48 files; panel suite 9 tests (sign-in and summary, wrong password keeps session then deletes, never without password, 429 seconds, offline and network failure, ended session, hostile problem rendered as fixed copy with no `img`/`script`/`onerror`, mapping, logout on leave), slot suite 3 tests, content tests updated |
| 3 | Bundle boundary | `pnpm nx run web:bundle-check` | `Admin chunks (lazy, browser only): chunk-DF87hY0l.js; deletion panel chunks (lazy, browser only): chunk-BtheHg7O.js; initial browser chunks: 4; marked chunks: 3.` `Public web bundle clean: 63 files, 6 markers.` |
| 4 | Web e2e against the real stack | `node apps/web-e2e/scripts/real-stack.mjs up`, `IV_E2E_REAL_API=1 pnpm nx run web-e2e:e2e` | `64 passed (1.2m)`, including `[deletion] account deletion on /hesap-silme against the real API`: register and favourite through the API, robots `index,follow`, panel replaces the fallback, labelled controls, sign-in on the page, wrong password alert while `GET /api/v1/me` stays 200, offline sends nothing, delete answers 202 `{"status":"deletion_scheduled"}`, no session cookie and no address or password in storage, old bearer token 401, `deactivated_at` set, request `scheduled`, favourites 0, live refresh tokens 0; then `scheduled_for` moved into the past and the real `deletion_job` run once: user row, deletion request and audit targets gone, password login 401 `auth.invalid_credentials` |
| 5 | App links through compose Caddy | SSR server on 127.0.0.1:58200 (`INECEKVAR_ENV=production`, test-only fingerprint `AB:...` and team `TESTTEAM01`), `docker compose -p iv6g up caddy` on ports 58080/58081/58443-58445 | `curl -sk -i https://127.0.0.1:58444/.well-known/assetlinks.json`: `HTTP/1.1 200 OK`, `Content-Type: application/json; charset=utf-8`, HSTS, body with `app.inecekvar.mobile` and the fingerprint; the AASA path: 200, same type, `TESTTEAM01.app.inecekvar.mobile`; another `.well-known` path stays 404 from the static site; plain http 308 to https. Stack removed afterwards |
| 6 | Mutation: wrong password ends the session | panel logs out and ends on `wrong-password` | unit "keeps the session after a wrong password and deletes on the second try" red; e2e `[deletion]` red at `[data-deletion="email"]`; restored |
| 7 | Mutation: deletion without re-auth | password guard removed, `deleteAccount(secret \|\| undefined)`, button enabled without password | unit "never sends the deletion without the password, whatever the button state" red; restored |
| 8 | Mutation: bootstrap admin while one exists | existing-admin check disabled | `test_promotes_existing_account_and_refuses_a_second_admin` red (1 failed, 17 passed); restored |
| 9 | Release documents | `node ops/release/check-release-docs.mjs` | `env keys: 65 named, 65 in docs/ops/env.md, 0 only elsewhere`; passed with 6 warnings, all the owner's 2.22 screenshot ratio |
| 10 | Ignore rules | `git check-ignore -v` | `key.properties` and `release-signing.properties` ignored; `gradle.properties` and the wrapper properties stay tracked |

## Not exercised

- `not exercised: the panel on a public host with real TLS`, a production database for the
  bootstrap, and the association files with owner fingerprints or a team id.
- `not exercised: real RevenueCat subscriber deletion` (REST double only, ADR-0050) and
  `backup replay review` on a real bucket (ADR-0053), both still open for item 21.
- `not exercised: a deletion request path for people who cannot sign in` (no password, lost
  access): needs the contact channel of `legal-open-items.md` L6.
- The AASA served on the PWA host lists the web host's components (`/*/hat/*`, `/*/durak/*`), not
  `/giris/baglanti`; universal magic links on iOS need a per-host list when the iOS platform is
  added (G7).
- Firefox and Safari; a screen reader pass (the e2e label check is light, axe is not in the
  workspace).
