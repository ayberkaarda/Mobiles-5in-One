English | [Türkçe](README.tr.md)

# Mobiles-5in-One

A portfolio monorepo of five independent mobile products, each built end to end on a different
stack: a mobile app, a backend API, a public SEO web and an admin area, with tests, CI, security
documents and release material. Each product lives in its own folder with its own tooling and
release cycle; no code is shared between them. Nothing is published to a store or a production
host: payments, store billing and third-party providers run against fakes or sandboxes, and every
README says which parts are real and which are simulated. Static snapshots of the public web pages
are on [GitHub Pages](https://ayberkaarda.github.io/Mobiles-5in-One/).

## Projects

| Folder                    | Product                                                                                                               | Stack                                                                          | Status                                                     | Security matrix (23 items) |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------- |
| [`kadro`](kadro/)         | Match organizer for amateur pitch football: build the squad, fill missing players, split the pitch fee                | Expo (React Native), Next.js, PostgreSQL + PostGIS, pg-boss                    | Phases 0 to 6 merged, then a light and dark redesign       | 13 done, 10 partial        |
| [`askida`](askida/)       | Pay-it-forward network: donors prepay everyday items at verified local shops, recipients collect with a one-time code | Flutter, Laravel, PostgreSQL + PostGIS, Redis, iyzico (fake provider locally)  | Phases 0 to 6 merged                                       | 14 done, 9 partial         |
| [`cetele`](cetele/)       | Offline-first digital credit ledger (veresiye defteri) for small shop owners                                          | Kotlin (Jetpack Compose), Spring Boot, PostgreSQL                              | Phases 0 to 6 merged, then hardening and design batches    | 12 done, 11 partial        |
| [`inecekvar`](inecekvar/) | Crowdsourced dolmuş / minibus route map for Turkish cities with A to B planning and offline city packs                | Ionic (Angular + Capacitor), Angular SSR, FastAPI, PostgreSQL + PostGIS, Redis | Phases 0 to 6 merged, then the route-sign redesign         | 15 done, 8 partial         |
| [`patika`](patika/)       | Community platform for street animals: feeding-station map, check-ins, adoption listings, vet directory               | .NET 10 MAUI (Android), ASP.NET Core, PostgreSQL + PostGIS                     | Phases 0 to 6 merged, simulated Play billing               | 19 done, 4 partial         |

Each project went through seven phases, from the foundation (phase 0) to hardening and release
readiness (phase 6), and grades the same 23-item security checklist in its own verification
matrix. A `partial` row names the missing proof; most of it needs systems that do not exist here (a
domain and TLS, store or provider accounts, cloud storage, a physical device, iOS).

## Gallery

One card per project. Each card has the same layout: a composite of the real web home page (a local build, sample data) with one Android screen, and below it three Android app screens (emulator, sample data). The full sets are in [`kadro/docs/screenshots/README.md`](kadro/docs/screenshots/README.md), in [`askida/README.md`](askida/README.md#screenshots) in [`cetele/docs/release/screenshots`](cetele/docs/release/screenshots/README.md), in [`inecekvar/docs/screenshots`](inecekvar/docs/screenshots/route-sign/) and in [`patika/README.md`](patika/README.md#gallery). The "web demo" links open static snapshots of each project's real public pages from local builds with sample data, hosted on GitHub Pages ([index](https://ayberkaarda.github.io/Mobiles-5in-One/)); sign-in, forms and payments do not work there.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/kadro.png" alt="Kadro: web home page and mobile lineup screen, sample data" width="100%"><br>
      <img src="kadro/docs/screenshots/mobile/03-matches-light.png" alt="Kadro mobile app: matches tab with two upcoming matches, sample data" width="32%">
      <img src="kadro/docs/screenshots/mobile/04-match-detail-rsvp-light.png" alt="Kadro mobile app: match detail with RSVP and fee share, sample data" width="32%">
      <img src="kadro/docs/screenshots/mobile/18-match-lineup-light.png" alt="Kadro mobile app: lineup on a pitch diagram with open places, sample data" width="32%"><br>
      <sub><b>Kadro</b>: web pages and Android app screens (emulator, sample data); all planned phases merged · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/kadro/">web demo</a></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/askida.png" alt="Askıda web home page and Android recipient screen (local stack, sample data)" width="100%"><br>
      <img src="askida/docs/release/screenshots/01-recipient-nearby.png" alt="Askıda recipient mode: nearby shops, sample data" width="32%">
      <img src="askida/docs/release/screenshots/04-donor-donate.png" alt="Askıda donor mode: item and quantity, sample data" width="32%">
      <img src="askida/docs/release/screenshots/16-merchant-home.png" alt="Askıda merchant mode: shop home, sample data" width="32%"><br>
      <sub><b>Askıda</b>: web home page and Android recipient screen (local stack, sample data) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/askida/">web demo</a></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/cetele.png" alt="Cetele card: web home page and Android customer list, local server, sample data" width="100%"><br>
      <img src="cetele/docs/release/screenshots/01-customers.png" alt="Cetele Android app: customer list with balances, sample customers, emulator" width="32%">
      <img src="cetele/docs/release/screenshots/02-customer-ledger.png" alt="Cetele Android app: one customer's ledger with debts, a payment and a reversed entry struck through, sample data, emulator" width="32%">
      <img src="cetele/docs/release/screenshots/03-dashboard.png" alt="Cetele Android app: dashboard with the total owed and the top debtors, sample data, emulator" width="32%"><br>
      <sub><b>Cetele</b>: web home page and Android customer list (local server, sample data) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/cetele/">web demo</a></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/inecekvar.png" alt="Inecek Var card: web home page with the red route sign, the from-to board and the street scene, and the Android line page with the ORN-1 placard, the stop diagram and the fare ticket, local stack, sample data" width="100%"><br>
      <img src="inecekvar/docs/screenshots/route-sign/android-01-search.png" alt="Inecek Var Android app: search screen with the Nereye inecek var? sign, the labelled sample city and the shortcuts, sample data, emulator" width="32%">
      <img src="inecekvar/docs/screenshots/route-sign/android-02-line.png" alt="Inecek Var Android app: line page with the ORN-1 placard, the first and last stop, the stop diagram and the fare ticket, sample data, emulator" width="32%">
      <img src="inecekvar/docs/screenshots/route-sign/android-03-planner-dark.png" alt="Inecek Var Android app in the dark scheme: A to B planner result with two transfers, the line placards and the stop diagram, sample data, emulator" width="32%"><br>
      <sub><b>Inecek Var</b>: web home page and Android search, line and planner screens, light and dark (local stack, sample data) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/inecekvar/">web demo</a></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/patika.png" alt="Patika card: web home page with the hero and the illustrated Moda morning-round map, and the Android adoption list with the Pamuk and Karabaş tag cards, local stack, sample data" width="100%"><br>
      <img src="patika/docs/design/screenshots/android-harita.png" alt="Patika Android app: map with station pins, filters and the station sheet with the Beslendi button, sample data, emulator" width="32%">
      <img src="patika/docs/design/screenshots/android-acil.png" alt="Patika Android app: dark urgent-help screen with the Acil yardım çağrısı aç button and nearby care places, sample data, emulator" width="32%">
      <img src="patika/docs/design/screenshots/destekci-profile.png" alt="Patika Android app: profile after a simulated test purchase with the Patika Destekçi card and badge, emulator" width="32%"><br>
      <sub><b>Patika</b>: web home page and Android adoption, map, urgent-help and Destekçi screens (local stack, sample data, simulated billing) · <a href="https://ayberkaarda.github.io/Mobiles-5in-One/patika/">web demo</a></sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Status

**Kadro.** All seven phases are merged: the domain API and pg-boss worker, the Expo app, the
Next.js marketing and SEO pages, the Kadro Pro subscription (RevenueCat) with the staff admin
panel, and the hardening work (attack suite, MobSF scan, dependency audit, restore drill, cost
guard, store copy, privacy labels, SEO and GEO checklist), followed by the light and dark redesign
(ADR-0084). Open: the 11 Maestro flows have no recorded run, purchases have not run against real
store accounts, Lighthouse lab LCP is 2.5 to 2.7 s on some pages, and there is no hosted origin,
Sentry account, production backup bucket or iOS build. See [`kadro/README.md`](kadro/README.md).

**Askıda.** All seven phases are merged: the Laravel server in Docker (authentication, shops and
catalog, hooks, donations with the iyzico flow, webhooks, payouts, the Filament admin panel, an
OpenAPI contract), the Flutter app for donors, merchants and anonymous recipients, the public web
with SEO and GEO, and the hardening phase (attack suite, stored-XSS sweep, ZAP and MobSF scans,
dependency audits, encrypted backups with a restore drill, a send budget, release and store
documents). Real payments and attestation have not been exercised and iOS has never been built.
See [`askida/README.md`](askida/README.md).

**Cetele.** All seven phases are merged: the Spring Boot server (authentication, sync with a
change log, ledger, reminders, media, Play billing, webhooks, the admin console), the offline-first
Android app (Kotlin, Jetpack Compose, local outbox, Play Billing), the public web with SEO and GEO,
and release hardening, followed by a hardening batch (PR #115), a design refresh (PR #116) and a
second security batch (PR #117). Play Billing, RTDN and Play Integrity ran against fakes and
recorded fixtures; no physical device and no end-to-end flow run. See
[`cetele/README.md`](cetele/README.md).

**Inecek Var.** All seven phases are merged (PRs #118 to #121, #123 and #126 to #128): an Nx workspace with the
Ionic/Angular app and PWA on a Capacitor Android shell, the Angular SSR web with city, line and stop
pages, guides and the moderation and admin area, and a FastAPI API with dual authentication,
moderation, traces, the planner, city packs, export, RevenueCat and Resend webhooks, plus the
hardening, scans, backups, cost guards and release documents. Then came a flake fix, the gallery,
and the visual redesign with its route-sign restyle (PRs #129 to #131, #133, #137, #138 and #140). Hosting, TLS, R2, provider
accounts and iOS are not exercised. See [`inecekvar/README.md`](inecekvar/README.md).

**Patika.** All seven phases are merged (PRs #134, #135, #139 and #141 to #147): a .NET 10 solution with the ASP.NET
Core API (Argon2id, ES256 tokens, refresh families and TOTP; stations, feedings, animals, adoption,
urgent posts with geofenced push, a media pipeline, account deletion), the Razor Pages public web
with SEO and GEO pages and the admin console with TOTP step-up, the Worker, the .NET MAUI Android
app, a simulated Google Play Destekçi subscription, and the phase 6 hardening with ZAP and MobSF
scans, backups with a restore drill, cost guards and release documents. The last full test run
records 1,456 passed. See [`patika/README.md`](patika/README.md).

### Progress

Last updated: 2026-10-26.

| Project     | Progress | Basis                                                                                                                                      |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `kadro`     | 100%     | Phases 0 to 2 done, phases 3 to 5: 34 of 34 work packages merged, phase 6: 11 of 11 deliverables merged; (3 + 3 x 34/34 + 11/11) / 7 = 100% |
| `askida`    | 100%     | 7 of 7 phases merged, weighted equally                                                                                                     |
| `cetele`    | 100%     | 7 of 7 phases merged, weighted equally                                                                                                     |
| `inecekvar` | 100%     | 7 of 7 phases merged, weighted equally                                                                                                     |
| `patika`    | 100%     | 7 of 7 phases merged, weighted equally                                                                                                     |

Progress means merged into `main`; work that is only on a branch or in an open pull request is not
counted. 100% means the planned work is merged, not that every control is proven in production:
the partial rows of each verification matrix and the "real vs simulated" table of each project
README stay the record of what is not verified.

## Repository layout

```
.github/workflows/   per project: CI, a security workflow (not for Patika, whose CI holds its scans)
                     and a restore drill; Kadro also has a manual Maestro end-to-end workflow
.github/dependabot.yml, renovate.json   dependency update configuration
.gitleaks.toml       secret-scanning configuration
lefthook.yml         git hook configuration
docs/readme/         the gallery cards of this README
kadro/               Kadro: pnpm workspaces + Turborepo (Expo app, Next.js web and API, worker, packages)
askida/              Askıda: Laravel server (Docker), Flutter app, brand package, ADRs, spec
cetele/              Cetele: Spring Boot server, Android app, brand package, ADRs, spec
inecekvar/           Inecek Var: Nx workspace (Ionic/Angular app, Angular SSR web), FastAPI api, ADRs, spec
patika/              Patika: .NET solution (API, Web, Worker), MAUI Android app, ADRs, spec
```

## Quickstart per project

Every project builds from its own folder; the full setup is in its README.

| Project                     | Needs                          | Check commands, from the project folder                                                                              |
| --------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [Kadro](kadro/README.md)    | Node 22, pnpm, Docker          | `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`                                             |
| [Askıda](askida/README.md)  | Docker, Flutter SDK            | `docker compose up -d --wait`, `docker compose exec server php artisan test`; in `app/`: `flutter test`              |
| [Cetele](cetele/README.md)  | JDK 21, Android SDK, Docker    | in `android/`: `./gradlew testDebugUnitTest :app:assembleDebug`; in `server/`: `./gradlew check`                     |
| [Inecek Var](inecekvar/README.md) | Node 22, pnpm, uv, Docker | `pnpm install --frozen-lockfile`, `pnpm nx run-many -t lint test build`; in `api/`: `uv sync --locked`, `uv run pytest` |
| [Patika](patika/README.md)  | .NET SDK 10.0.4xx, Docker      | `dotnet build Patika.slnx`, `dotnet test Patika.slnx`                                                                |

Database-backed tests in every project start containers, so a running Docker daemon is needed.

The repository uses Conventional Commits, checked by commitlint through the hooks in
`lefthook.yml`. Hooks are installed explicitly with `pnpm --dir kadro exec lefthook install`.

## Documentation per project

- Kadro: [`kadro/README.md`](kadro/README.md) ([Türkçe](kadro/README.tr.md)); ADRs in [`kadro/docs/adr/`](kadro/docs/adr/README.md)
- Askıda: [`askida/README.md`](askida/README.md) ([Türkçe](askida/README.tr.md)); [`askida/CONTRIBUTING.md`](askida/CONTRIBUTING.md), ADRs in [`askida/docs/adr/`](askida/docs/adr/)
- Cetele: [`cetele/README.md`](cetele/README.md) ([Türkçe](cetele/README.tr.md)); ADRs in [`cetele/docs/adr/`](cetele/docs/adr/README.md)
- Inecek Var: [`inecekvar/README.md`](inecekvar/README.md) ([Türkçe](inecekvar/README.tr.md)); ADRs in [`inecekvar/docs/adr/`](inecekvar/docs/adr/)
- Patika: [`patika/README.md`](patika/README.md) ([Türkçe](patika/README.tr.md)); ADRs in [`patika/docs/adr/`](patika/docs/adr/)

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
