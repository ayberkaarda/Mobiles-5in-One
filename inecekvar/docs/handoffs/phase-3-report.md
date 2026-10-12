# İnecek Var — Phase 3 Report

## Summary (5 lines max)

The Ionic app and PWA are built: search and map, line and stop pages, A→B planner, offline packs, sign-in and contributor tools, favourites, settings with in-app account deletion, the Plus paywall behind a store adapter, app links, Transloco tr and en with plurals.
Gate: the Playwright PWA offline scenario is green (6 e2e scenarios passed), the Android debug build succeeds and runs on the `Pixel_8` emulator, Lighthouse PWA is 100 (Lighthouse 11.7.1).
Open on the gate: the iOS build (no macOS host). Lighthouse performance is 75 on simulated slow 4G.
Workspace gate green: data-access 110, domain 4, ui 23, mobile 460, web 1 tests; lint clean; initial bundle 717.36 kB (budget 720 kB).
Security matrix after phase 3: 6 done, 12 partial, 5 not-started.

## Files created / modified (grouped by owner, full paths)

Paths are under `inecekvar/`. Package-level file lists for 3A to 3F are in ADR-0030 to ADR-0035.

**mobile (`apps/mobile`, package 3G)**
- created: `src/app/account/account-deletion.ts`, `src/app/account/account.spec.ts`, `src/app/plus/purchases.ts`, `src/app/plus/revenuecat-purchases.ts`, `src/app/plus/plus.store.ts`, `src/app/plus/plus.spec.ts`, `src/app/pages/plus.page.ts`, `src/app/pages/plus.page.html`, `src/app/pages/plus.page.scss`, `src/app/core/deep-link.ts`, `src/app/core/deep-link.spec.ts`, `src/app/core/deep-link-bootstrap.spec.ts`, `src/app/testing/fake-purchases.ts`, `public/brand/app-icon-192.png`, `public/brand/app-icon-512.png`, `public/brand/maskable-icon-192.png`, `public/brand/maskable-icon-512.png`
- modified: `src/app/pages/settings.page.ts`, `.html`, `.scss`; `src/app/pages/packs.page.ts`, `.html`, `.scss`; `src/app/core/session-bootstrap.ts`, `session-bootstrap.spec.ts`; `src/app/core/favorites.store.ts` (`forgetAccount`); `src/app/core/language.service.ts` (`tp`); `src/app/i18n/translation.ts`, `i18n.ts` (`TpPipe`), `tr.ts`, `en.ts`, `contrib.tr.ts`, `contrib.en.ts`, `i18n.spec.ts`; `src/app/shared/format.ts`, `src/app/shared/line-list.component.ts`; `src/app/planner/itinerary.ts`; `src/app/pages/{plan,line,search,stop,favorites,contribute,recorder}.page.*` and `src/app/city/city-picker.component.ts` (plural pipe); `src/app/app.routes.ts` (`/plus`); `src/app/packs/packs.spec.ts`; `src/app/testing/catalog.fixtures.ts`; `src/environments/environment.ts`; `ngsw-config.json`; `public/manifest.webmanifest`; `android/app/src/main/AndroidManifest.xml`, `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`
- root: `package.json`, `pnpm-lock.yaml` (`@revenuecat/purchases-capacitor` 13.6.1)

**data-access (`libs/data-access`, additive)**: `src/lib/api-client.ts` (`ApiRequest.answerCodes`), `src/lib/endpoints.ts` (`REAUTH_ANSWERS`, `deleteAccount`), `src/lib/session.store.spec.ts`

**ui (`libs/ui`)**: `src/lib/fare.pipe.ts` (`formatFare`, locale argument), `src/lib/fare-chip.component.ts`, `src/lib/line-card.component.ts` (`locale` inputs), `src/lib/ui.spec.ts`

**qa (`apps/mobile-e2e`)**: `src/settings-account.spec.ts` (new), `serve.mjs` (gzip option)

**lead / security docs**: `docs/adr/0036-phase-3-gate.md`, `docs/handoffs/phase-3-report.md`, `docs/security/verification-matrix.md`, `README.md`, `README.tr.md`, `docs/screenshots/phase3/*` (new: `plus-web`, `ayarlar-hesap`, `ayarlar-en`, `ayarlar-silme`, `ayarlar-silindi`, `android/*`)

**repository root**: `.gitleaks.toml` (one test-fixture path allowlist; outside the package's listed paths, recorded here and in ADR-0036)

## Decisions & ADRs added

- ADR-0030 shell and design system; ADR-0031 data access and auth strategies; ADR-0032 search, map and detail pages; ADR-0033 planner UI and favourites; ADR-0034 offline packs and the service worker; ADR-0035 sign-in and contributor tools; ADR-0036 package 3G and the phase 3 gate.
- Key 3G decisions: local data is removed only after the API accepted the deletion; 401 re-authentication answers no longer end the session; Plus is a `PurchasesAdapter` (web and keyless builds sell nothing, RevenueCat loaded lazily in the native shell, fake only in tests) and the API alone grants packs; app links through a strict host and path allowlist; plural objects plus a typed `tp` pipe; initial budget kept at 720 kB; stop search without a pack keeps the `stops/near` grid until a `GET stops?city=&q=` route exists.

## Security checklist status

| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
| - | ---- | ------------------------------------- | ------------------------------ |
| 1 | Remove secrets from source | partial | environment key-set test; gitleaks 37 commits no leaks (ADR-0036); pre-commit and CI scan not exercised |
| 2 | Purge secrets from history | not-started | phase 6 |
| 3 | Define authorization rules | done | `test_policy_matrix.py` (ADR-0011); unchanged in phase 3 |
| 4 | Enforce authorization on server | done | `test_idor.py` (ADR-0021); the app's guards are UX only |
| 5 | Rate limit entry points | done | phase 1 and 2 tests; the app shows `Retry-After` countdowns |
| 6 | Validate input | partial | API tests plus app mirrors (`auth.spec.ts`, `proposals.spec.ts`, `contribute.spec.ts`, `deep-link.spec.ts`) |
| 7 | Constrain uploads | done | `tests/media` (ADR-0023); R2 not exercised |
| 8 | Lock down CORS | done | `tests/core/test_cors.py` (ADR-0012) |
| 9 | Set security headers | partial | API headers; SSR helmet and CSP phase 4 |
| 10 | Require HTTPS | partial | `androidScheme: 'https'`, `usesCleartextTraffic=false` read from the APK, https-only app links; proxy redirect and iOS ATS not exercised |
| 11 | Hash passwords | partial | argon2id tests; TOTP encryption phase 4 |
| 12 | Secure cookies | partial | cookie tests; client strategies (ADR-0031); e2e web-storage checks; native secure storage not run against an API |
| 13 | Limit error details | partial | problem bodies; app code-to-copy mapping; SSR error pages phase 4 |
| 14 | Sanitize logs | partial | phase 1 and 2 log tests; Sentry phase 6 |
| 15 | Parameterize queries | partial | bound parameters, ruff S rules; bandit and semgrep phase 6 |
| 16 | Escape against XSS | not-started | the app binds text only (ADR-0035); the payload sweep is phase 6 |
| 17 | Verify webhook signatures | not-started | phase 5 |
| 18 | Assign admin roles | partial | moderation roles and audit; TOTP and admin UI phase 4 |
| 19 | Audit packages | not-started | phase 6 |
| 20 | Automate backups | not-started | phase 6 |
| 21 | Delete accounts | partial | API deletion tests (ADR-0026); in-app flow `account.spec.ts` and e2e `settings-account.spec.ts`; web page phase 4, RevenueCat REST phase 5 |
| 22 | Set spending alerts | partial | application caps; cost guard phase 6 |
| 23 | Test as an attacker | partial | review rounds ADR-0031 to ADR-0035; Lighthouse; attack suite, ZAP, MobSF phase 6 |

Details: `docs/security/verification-matrix.md`. The authorization matrix is unchanged: phase 3 changed no rule (the app shows what the API decides).

## SEO/GEO status (Phase 4+)

Not in scope for phase 3. The PWA manifest, theme colour and icons are in place (Lighthouse PWA 100); SEO category 100 on three app routes; programmatic SSR pages, sitemaps, JSON-LD and `assetlinks.json` are phase 4.

## Tests executed (command + result counts)

| Command | Result |
| ------- | ------ |
| `pnpm nx run-many -t lint test build --skip-nx-cache` | exit 0; data-access 110, domain 4, ui 23, mobile 460, web 1 passed; lint clean; mobile initial 717.36 kB |
| `pnpm nx run mobile-e2e:e2e --skip-nx-cache` (local stack, seeded) | 6 passed (2.2 m) |
| `pnpm exec cap sync android`; `./gradlew assembleDebug` (JDK 21.0.12) | 7 plugins; BUILD SUCCESSFUL; APK 9,864,886 bytes |
| Emulator `Pixel_8`: install, start, app links | app runs; line link routed; malformed link to not-found; unclaimed path not delivered |
| `npx lighthouse@13.5.0` on `/ara`, `/ayarlar`, `/plus` | performance 75, accessibility 100, best practices 96, SEO 100 |
| `npx lighthouse@11.7.1 --only-categories=pwa` on `/ara` | 100 (88 before the PNG icons) |
| `gitleaks git --no-banner --redact --log-opts="origin/main..HEAD" .` (repository root) | 37 commits, no leaks |
| Mutations M1 to M3 (ADR-0036) | 1, 1 and 2 named tests failed; all restored and green |

`uv run pytest` was not run in this package: `api/` is untouched (phase 2 total in ADR-0029).

## Known gaps / risks

- iOS not built (no macOS host): the phase 3 gate item "Capacitor builds for Android and iOS" is half met.
- The native app was not run against an API (no production host; mixed content blocks a local http API), so native sign-in, secure-storage refresh, Filesystem pack install and deletion are covered by unit tests and the PWA e2e only.
- App links are unverified until `assetlinks.json` is served (phase 4).
- Plus is untested with a real store; the RevenueCat binding ran against a fake plugin API.
- Lighthouse performance 75 (initial bundle dominated by the Ionic tab shell and Angular core).
- No real PMTiles basemap anywhere in the phase.

## Open questions / proposals (scope, cost, legal)

- API: `GET stops?city=&q=` to retire the stop grid; a digest header on the pack route; process photos when the upload completes; keep `display_name` at registration; a field to clear optional line texts.
- Product: whether to offer a development native build that points at a local https API for emulator runs.
- Store: RevenueCat project, Play and App Store products and the public SDK key are owner-level accounts (ADR-0005 external gates).
- Legal: the CC BY 4.0 licence text and the KVKK notice wording shown in Ayarlar still await legal approval (ADR-0003).

## Proposed Conventional Commits (not executed)

The 3G work was committed locally (one-line messages, not pushed):

- `fix(data-access): keep the session when account deletion asks for re-authentication`
- `feat(ui): format fares in the locale of the active language`
- `feat(mobile): add app link intent filters, location permissions and the synced plugins`
- `feat(mobile): add account deletion, the Plus paywall, app link routing and plural translations`
- `test(mobile-e2e): cover settings, the web paywall and account deletion with phase 3 screenshots`
- `docs(adr): record the phase 3 gate, the report and the security matrix`

## Next phase preview (3 lines)

Phase 4: Angular SSR city, line, stop and route pages with server-rendered SVG maps, guides, legal pages including `/hesap-silme` and `/veri-lisansi`.
Sitemaps, robots, JSON-LD, hreflang, OG images, `llms.txt`, AASA and `assetlinks.json` (which verifies the Android app links).
Moderation and admin UI with TOTP step-up; Lighthouse CI on five pages.

STOPPED — waiting for "devam".
