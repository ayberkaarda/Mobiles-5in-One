# ADR-0036: Phase 3 gate, package 3G (settings, deletion, Plus, app links, i18n, Android)

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 3, package 3G and the phase 3 gate

## Context

Section 10 closes phase 3 with: the Playwright PWA offline scenario green, Capacitor builds for
Android and iOS, Lighthouse PWA at least 90. Package 3G adds the last stories of the app: settings
and in-app account deletion (story 10, section 6.21, ADR-0026), the Plus paywall (story 8, native
only, the API decides, ADR-0024), app links (`appUrlOpen`), the completion of Transloco tr and en,
the Android build and the gate documents. ADR-0005 governs evidence: done needs executed output.

## Decision

### Settings and account deletion

1. Ayarlar holds theme, language, offline cities, a Plus row, the account (email, role,
   reputation, sign-out), the privacy notes, the data-licence view (the licence points, the
   pending legal approval, a link to the web licence page) and the version.
2. "Hesabı sil" opens an inline panel that states what happens now (sessions end, favourites and
   raw traces deleted, pending proposals withdrawn), within 7 days (a sign-in cancels, then the
   address, account and photos go), what stays (approved contributions under the licence as
   "silinmiş katkıcı") and what this phone forgets or keeps. The submit button needs the
   confirmation box; the password field is optional because the API re-authenticates a
   passwordless account by a session younger than 10 minutes (`auth.reauth_required`).
3. `AccountDeletion` (`apps/mobile/src/app/account`) sends nothing while offline and removes
   nothing locally until the API answered 202. Then it discards the ride draft, removes the
   favourites merge records of that account id (`FavoritesStore.forgetAccount`) and tells the
   store SDK to forget the app user id; the strategy already cleared the tokens. Offline packs
   (public data) and the guest favourites of the device stay, and the panel says so. The password
   lives in a signal only and is cleared after every attempt and on `ionViewDidLeave`.
4. A wrong password used to end the session: `DELETE me` answers 401 and the client treated every
   credentialed 401 as a dead session (cookie mode ended it, bearer mode refreshed and replayed
   the DELETE). `ApiRequest.answerCodes` (additive) lists problem codes that are answers on a
   401; `AccountApi.deleteAccount` passes `auth.invalid_credentials` and `auth.reauth_required`.
5. The web page `/hesap-silme` is linked from the panel (`https://inecekvar.app/hesap-silme`); the
   page itself is phase 4.

### Plus

6. `PurchasesAdapter` (`apps/mobile/src/app/plus/purchases.ts`) with three bindings:
   `createPurchasesAdapter` returns an adapter that sells nothing on the web (`web`) and in a
   native build without a public key (`not-configured`); with a public `goog_`/`appl_` key inside
   the native shell it returns a lazy wrapper that imports `revenuecat-purchases.ts` (the thin
   `@revenuecat/purchases-capacitor` binding) on first use. The web never imports the plugin; the
   chunk is excluded from the service-worker prefetch. `FakePurchases` (deterministic plans,
   controls for outcome, failures and the store entitlement) lives in `src/app/testing`, which no
   production file imports: `grep` over `dist/apps/mobile/browser/*.js` for `iv_fake`,
   `FakePurchases` and `fake store` finds nothing.
7. `environment.revenueCatPublicKey` is the only key field and is empty in the repository; a store
   build sets the public SDK key. No secret is in the app.
8. `PlusStore` and `/plus` never unlock anything: the page says the server verifies Plus, a
   purchase result sends the user back to the packs, where the next download asks the API again
   (403 `pack.entitlement_required` until phase 5 webhooks record a subscription). Purchases need
   a signed-in user because the app user id is the API account id. A sign-out or account change
   makes the store SDK forget the previous id. The packs page's 402/403 explanation now links to
   `/plus?sehir=<slug>`.
9. Dependency: `@revenuecat/purchases-capacitor` 13.6.1 (published 2026-09-24, 18 days before this
   package; listed in ADR-0004), exact version.

### App links

10. `resolveDeepLink` (`core/deep-link.ts`) routes only `https` links on `inecekvar.app` and
    `app.inecekvar.app` without port or credentials: `/hat/{slug}`, `/durak/{slug}`, the web
    shapes `/{city}/hat/{slug}` and `/{city}/durak/{slug}` (as `?city=`), and `/giris/baglanti`
    (the `#token=` fragment is captured in memory by the session store and never routed). Slugs
    are lower-case words joined by single hyphens, at most 120 characters; anything else goes to
    `/bulunamadi` (the not-found page). `bootstrapSession` uses it for every `appUrlOpen`.
11. `AndroidManifest.xml`: an `autoVerify` intent filter for those hosts and paths (https only),
    `usesCleartextTraffic="false"`, and the foreground location permissions the geolocation
    plugin needs (they were missing). `assetlinks.json` is phase 4, so Android reports both
    domains as unverified (`pm get-app-links`: state 1024) and the links open the app only when
    sent to it explicitly.

### i18n

12. Count texts are plural objects (`{ one, other }`) in both languages; `TranslationKey` excludes
    them, so `'line.stops' | t` no longer compiles and every call site moved to the `tp` pipe or
    `LanguageService.tp()`, which picks the form with `Intl.PluralRules` and formats `{{count}}`
    with `Intl.NumberFormat`. Fares use `Intl.NumberFormat` with TRY in the active locale
    (`formatFare` in `libs/ui`, `locale` inputs on `iv-fare-chip` and `iv-line-card`); Plus prices
    use the store currency. Itinerary distances and minutes use the language's number format.
    New copy (account and Plus) went into the lazily merged contributor chunk so the initial
    bundle stays under its budget.

### Decisions carried from the earlier packages

13. Initial bundle warning budget 720 kB (ADR-0034 decision 8): measured 717.36 kB raw, 180.62 kB
    transfer at this gate, below the warning; the error budget stays 1 MB.
14. Stop search without a pack still uses the 3C grid of `stops/near` calls (ADR-0032, ADR-0034);
    the proposal for the API owner stays a `GET stops?city=&q=` route.
15. Plus runs on the fake adapter in tests and on no store at all in this build; a real
    RevenueCat project, store products and webhooks are phase 5 and external gates (ADR-0005).

## Additions outside `apps/mobile`

- `libs/data-access`: `ApiRequest.answerCodes`, `REAUTH_ANSWERS`, `deleteAccount` passes them;
  three tests in `session.store.spec.ts`.
- `libs/ui`: `formatFare(minor, locale)`, `FarePipe` locale argument, `locale` inputs on the fare
  chip and line card; one test.
- `apps/mobile-e2e`: `settings-account.spec.ts`; `serve.mjs` gzip option `IV_E2E_GZIP=1` (Caddy
  compresses in production; Lighthouse ran with it).
- Repository root `.gitleaks.toml`: one path allowlist for the fixed dummy passwords and tokens in
  `auth-pages.spec.ts` (3F) and `session.store.spec.ts` (3B), rule `generic-api-key` only.

## Evidence

Run on 2026-10-12 on the owner's Windows 11 machine, branch `feat/inecekvar-p3`.

| # | Command or check | Result |
| - | ---------------- | ------ |
| 1 | `pnpm add --save-exact @revenuecat/purchases-capacitor@13.6.1` | added, lockfile +18 lines |
| 2 | `pnpm nx run-many -t lint test build --skip-nx-cache` (all 5 inecekvar projects) | exit 0, "Successfully ran targets lint, test, build for 5 projects"; tests: data-access 110, domain 4, ui 23, mobile 460, web 1, all passed; lint clean |
| 3 | Mobile production bundle | initial 717.36 kB raw, 180.62 kB transfer; `settings.page` 22 kB, `revenuecat-purchases` 9 kB lazy (native only) |
| 4 | `pnpm nx run mobile-e2e:e2e --skip-nx-cache` against a seeded local stack (compose project `inecekvar-p3g`, ports 57962-57967, API 127.0.0.1:57980, worker, `IV_E2E_ORIGIN=http://localhost:4200`) | 6 passed (2.2 m): the four pack scenarios, `settings-account.spec.ts` (web paywall sells nothing; cookie sign-in; role and reputation shown; English settings; wrong password keeps the session; `DELETE me` 202; guest afterwards; `GET me` 401; no email, password or draft in web storage) and the contributor scenario; stack removed afterwards (`down -v`). Final rerun after the last gate on a fresh stack: 6 passed (2.1 m). One intermediate rerun failed the pack install because an API process from the previous run still held port 57980 against the recreated database; it was stopped and the stack reset before the final run |
| 5 | `pnpm exec cap sync android` | 7 plugins: app, filesystem, geolocation, network, preferences, `@revenuecat/purchases-capacitor` 13.6.1, `capacitor-secure-storage-plugin` 0.13.0 (all on the ADR-0004 allowlist) |
| 6 | `JAVA_HOME=jdk-21.0.12 ./gradlew assembleDebug` | BUILD SUCCESSFUL; `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`, 9,864,886 bytes (unsigned debug build, not in git) |
| 7 | `aapt2 dump xmltree` on the APK | `autoVerify=true`, scheme `https`, hosts `inecekvar.app` and `app.inecekvar.app`, the five paths, `usesCleartextTraffic=false`, both location permissions |
| 8 | Emulator `Pixel_8` (headless), `adb install -r`, `am start` | app starts; `https://inecekvar.app/ornek-test-sehri/hat/ornek-hat-1` opened the line page (it then shows "Hat açılamadı": the native build points at `api.inecekvar.app`, which does not exist); `https://inecekvar.app/hat/a--b` reached the app and showed the not-found page; `https://inecekvar.app/giris/baglanti#token=abc` opened the magic-link page, which showed "Bağlantı bulunamadı" (the short token is malformed and was dropped, as in ADR-0031); `https://inecekvar.app/admin` is not claimed by the filter (`unable to resolve Intent`); the packs page reports Filesystem storage; the paywall shows "no store connection"; the hardware back key returns from a pushed page; emulator stopped |
| 9 | Lighthouse 13.5.0 (`npx lighthouse@13.5.0 <url> --only-categories=performance,accessibility,best-practices,seo --form-factor=mobile`), production build served by `serve.mjs` with gzip on 127.0.0.1:57991, no API behind it | `/ara`: performance 75, accessibility 100, best practices 96, SEO 100 (FCP 3.7 s, LCP 4.6 s, TBT 49 ms, simulated slow 4G); `/ayarlar` 75/100/96/100; `/plus` 75/100/96/100. Without gzip `/ara` scored performance 61 |
| 10 | Lighthouse PWA: 13.x has no PWA category, so `npx lighthouse@11.7.1 http://127.0.0.1:57991/ara --only-categories=pwa` | first 88 (`splash-screen`: no PNG icon of at least 512 px); after adding 192 and 512 px PNG icons (any and maskable, rendered from the brand SVGs) 100 |
| 11 | `gitleaks git --no-banner --redact --log-opts="origin/main..HEAD" .` from the repository root | first 3 findings, all in earlier commits' unit-test fixtures (`auth-pages.spec.ts` dummy password, `session.store.spec.ts` dummy token and password); after the path allowlist: 37 commits scanned, no leaks |
| 12 | Mutation M1: `AccountDeletion` reports success without the local cleanup | 1 test fails (`forgets the deleted account and draft while keeping guest favourites`); restored from the copy |
| 13 | Mutation M2: `resolveDeepLink` accepts any host ending in `inecekvar.app` | 1 test fails (`rejects host prefix`, `https://evilinecekvar.app/hat/x`); restored, file hash identical |
| 14 | Mutation M3: `answerCodes` ignored in `ApiClient` | 2 tests fail (`keeps the cookie session when deletion needs a fresh sign-in, and asks once`, `keeps the session after a wrong deletion password, without refreshing or replaying`); restored |
| 15 | Typed-key check | changing `line.stops` to a plural object made `i18n.spec.ts` fail to compile (`'"line.stops"' is not assignable to parameter of type 'TranslationKey'`) until the call moved to `tp`; key parity, placeholder parity and plural-form tests pass |

Screenshots: web (Playwright, 360 × 800, light and dark) `plus-web`, `ayarlar-hesap`, `ayarlar-en`,
`ayarlar-silme`, `ayarlar-silindi` in `docs/screenshots/phase3/`; Android (emulator, 1080 × 2400)
`android-ara`, `android-hat-deeplink`, `android-deeplink-rejected`, `android-giris`,
`android-giris-baglanti`, `android-ayarlar`, `android-plus`, `android-cevrimdisi` in
`docs/screenshots/phase3/android/`. They were reviewed; the contributor scenario rewrote its 3F
screenshots in the same run.

### Lanes

| Package | Written by | Tested and gated by |
| ------- | ---------- | ------------------- |
| 3A to 3F and the review round | not recorded per package in the repository (single author on every commit, no handoff files); the working rule at the time was writer lanes for bulk code and the lead lane for gates | the lead lane ran the gates recorded in ADR-0030 to ADR-0035 |
| 3G app code, data-access and ui changes, e2e scenario, docs | lead lane | lead lane |
| 3G unit specs `deep-link.spec.ts`, `deep-link-bootstrap.spec.ts`, `account/account.spec.ts`, `plus/plus.spec.ts` | Sol lane (from a written brief; it could not run them) | lead lane (compiled, ran, mutation-checked) |

## Not exercised

- `not exercised: iOS build` (no macOS host; section 10 asks for it, so the phase 3 gate is
  partly open on this item).
- `not exercised: the native app against a running API` (the native build uses
  `https://api.inecekvar.app`, which does not exist; a local http API is blocked as mixed content
  from `https://localhost`). Native sign-in, bearer refresh with secure storage, pack download to
  Filesystem and deletion were therefore not run on the emulator.
- `not exercised: verified app links` (no `assetlinks.json` on a public host until phase 4).
- `not exercised: a RevenueCat purchase` (no RevenueCat project, no store products, no key;
  the RevenueCat binding ran in unit tests against a fake plugin API only).
- `not exercised: the entitlement refusal against the API in e2e` (one seeded city).
- `not exercised: a real PMTiles basemap` (no tiles host).
- `not exercised: a signed release build` (no keystore, by design out of the repository).
- `not exercised: Lighthouse on a hosted origin` (local server, no TLS, no API behind it; best
  practices 96 comes from the 502 console errors of the missing API).

## Consequences

- Lighthouse performance on simulated slow 4G is 75, below the section 7 target of 90 for web
  pages (that target is phase 4's SSR pages; phase 3's gate names PWA only). The initial bundle is
  the Ionic tab shell and Angular core (ADR-0034); a lighter shell is a later decision.
- Proposals for the API owner: keep the `GET stops?city=&q=` proposal; a pack digest header.
- The phase 3 gate stands at: PWA offline scenario green, Android build green, PWA 100, iOS open.
