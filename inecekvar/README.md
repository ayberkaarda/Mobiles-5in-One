English | [Türkçe](README.tr.md)

# İnecek Var

Tagline (tr): "Dolmuş nereden geçer? Mahalle bilir."

<img src="docs/screenshots/route-sign/web-home.png" alt="Inecek Var web home page: the name, the red from-to board, the street scene with the dolmuş, the labelled sample city and the three steps on a route line, local build, sample data" width="100%">

<img src="docs/screenshots/route-sign/android-01-search.png" alt="Inecek Var Android app: search screen with the Nereye inecek var? sign and the labelled sample city, sample data, emulator" width="32%"> <img src="docs/screenshots/route-sign/android-02-line.png" alt="Inecek Var Android app: line page with the ORN-1 placard, the stop diagram and the fare ticket, sample data, emulator" width="32%"> <img src="docs/screenshots/route-sign/android-03-planner-dark.png" alt="Inecek Var Android app in the dark scheme: A to B planner result with two transfers, sample data, emulator" width="32%">

Web home page from a local build and Android screens from the `Pixel_8` emulator, both against the local stack with sample data. The [line page](docs/screenshots/route-sign/web-line.png), a [guide](docs/screenshots/route-sign/web-guide.png) and the [dark home page](docs/screenshots/route-sign/web-home-dark.png) are in `docs/screenshots/route-sign`. A static [web demo](https://ayberkaarda.github.io/Mobiles-5in-One/inecekvar/) runs on GitHub Pages; sign-in and forms do not work there.

## Product summary

İnecek Var is a crowdsourced route map for dolmuş, minibus and servis lines in Turkish cities, where official data is often missing. Passengers can look up lines, stops, fares and hours, plan A to B trips with transfers, and download offline city packs. Neighbourhood contributors record rides as GPS traces and propose or edit lines, and moderators review and publish them. The name is the phrase passengers shout to stop a dolmuş. The tone is street-smart, playful and clear.

## MVP features

- Public search by line code or name, free text, or A to B by typing places or tapping the map; nearby lines using the device location.
- Line page: route on the map, ordered stops, fare with last-update date, hours, payment methods, how-to-hail notes, last verified date, and a "this line changed" report button.
- A to B planner: up to 3 itineraries with at most 2 transfers and an estimated fare.
- Offline city packs (line and stop data plus a map basemap); free tier includes 1 city.
- Contributors: sign up with email and password or a magic link, record a trace while riding, mark stops, submit proposals with fare, hours, notes and an optional photo, and edit existing lines.
- Moderation: review queue with a map diff, approve into an immutable line version, reject with a reason, roll back to any version; contributors cannot approve their own proposals.
- Favorites: local for guests, synced for signed-in users.
- Plus subscription (native apps only): unlimited offline cities and a supporter badge.
- Open data: weekly public export per city under an open licence.
- In-app and web account deletion; contributions stay under the licence, anonymized.
- Website: city hubs, line and stop pages, guides, legal pages and a moderation/admin UI.

## Out of scope

- Real-time vehicle tracking
- Ticketing
- Ride-hailing
- Official-data claims
- Ads
- Driver accounts
- Push notifications (planned for v2)
- Routing across cities

## Planned technology stack

| Layer | Technology |
|---|---|
| Mobile and PWA | Ionic 9, Angular, Capacitor |
| Web | Angular SSR |
| Maps | MapLibre GL JS with PMTiles |
| Monorepo tooling | Nx, pnpm |
| Backend API | FastAPI (Python 3.12+), Pydantic v2 |
| Database | PostgreSQL with PostGIS, SQLAlchemy 2, Alembic |
| Cache and jobs | Redis, arq workers |
| Object storage | S3-compatible (Cloudflare R2) |
| Subscriptions | RevenueCat (native only) |

## Planned architecture

An Nx workspace with `apps/mobile` (Ionic and Angular, also served as a PWA), `apps/web` (Angular SSR) and shared `libs/` for UI, domain types and the API client, plus a separate Python `api/` project. The route planner builds a per-city graph in memory on publish and caches results. Web and PWA clients use a cookie session, while native clients use bearer tokens, behind one auth interface. Public line, stop and city pages are server-rendered, with route maps drawn as SVG so they need no client-side map code. Raw GPS traces are private to their owner and moderators and are deleted 30 days after the derived line version is published.

## Status

Phases 0 to 6 are built and merged into `main` (pull requests #118, #119, #120 and #121, #123, #126, #127 and #128), followed by a test flake fix (#129), the gallery and web home page (#130) and the visual redesign of the app and the web (#131, ADR-0059). Phase 6 (hardening and release readiness) added: the attack suite and the stored-XSS sweep, ZAP and MobSF scans, dependency audits and static scans in a security workflow, encrypted backups with a weekly restore drill and tamper checks, cost guards with the planner degrade mode and the log scrub, the store copy, privacy labels and release checklist, the history-purge runbook (not executed), the web account deletion panel and the first-run bootstrap, and the independent review fixes. The gate is `docs/adr/0058-phase-6-gate.md`, the final report `docs/handoffs/final-report.md` and the final matrix `docs/security/verification-matrix.md`: 15 of 23 items done, 8 partial, 0 not started, so not 23 of 23; the partial rows need hosting, the domain and TLS, R2, provider accounts, GitHub runs of the workflows, iOS and owner decisions. The phase 6 gate recorded API 1195 passed (0 skipped), web e2e 64 and mobile e2e 10 on the real stack, clean scans and audits and a restore drill with six negative runs; after the redesign the workspace tests read domain 4, data-access 110, ui 55, web 801 and mobile 475, with web e2e 65 and mobile e2e 11 (ADR-0059). Not exercised: real hosting, TLS and HSTS preload, R2, RevenueCat, Resend and Sentry accounts, iOS and macOS, the production Caddyfile, legal texts and owner decisions. The final report is `docs/handoffs/final-report.md`. A static web demo snapshot is published at https://ayberkaarda.github.io/Mobiles-5in-One/inecekvar/. Phase 5 (API only), pull request #127: the RevenueCat webhook with nightly REST reconciliation and server-side Plus entitlement for packs beyond the first city, RevenueCat subscriber deletion at account erasure, the Resend webhook with a hashed suppression list that the mailer consults, and idempotent nightly jobs with a dry-run switch. The gate is `docs/adr/0050-webhooks-and-entitlements.md` and the report `docs/handoffs/phase-5-report.md`. Not exercised in phase 5: real RevenueCat and Resend accounts and payloads signed by them, a store purchase, cron firing over real time. Phase 4 is merged into `main` (pull request #126): the Angular SSR web with city, line, stop and route pages and server-rendered SVG maps, five guides, FAQ, open-data and legal pages, sitemaps, robots, JSON-LD, SVG Open Graph images, `llms.txt`, app association files, and the client-only `/admin` moderation and admin area with a TOTP step-up (API side: TOTP enrolment, session-bound step-up, admin routes). The phase 4 gate is `docs/adr/0042-phase-4-gate.md` and the report `docs/handoffs/phase-4-report.md`: moderation e2e green against the real API, JSON-LD valid on 8 page types, Lighthouse 100 in performance, accessibility and best practices on 5 pages, SEO 100 on 2 pages and 66 on the 3 sample-city pages, which are `noindex` by design. Not exercised in phase 4: real TLS and HSTS preload, Search Console and Rich Results, iOS universal links, a real authenticator app, hosted Caddy, a CDN. Phases 0 to 3 are built: the API core with dual auth (phase 1), domain, moderation, planner, packs, exports and deletion (phase 2), and the Ionic app and PWA (phase 3: search and map, line and stop pages, planner, offline packs, sign-in and contributor tools, favourites, settings with account deletion, the Plus paywall behind a store adapter, app links, Turkish and English). The phase 3 gate is `docs/adr/0036-phase-3-gate.md` and the report `docs/handoffs/phase-3-report.md`. Not exercised in phase 3: iOS (no macOS host), a real RevenueCat account and store purchase, verified app links (no public `assetlinks.json` yet), the app against a running API on the emulator, a real PMTiles basemap. Phase 0 (foundation) set up the base. The folder holds the Nx workspace with `apps/mobile` (Ionic 9 on Capacitor, Android project committed), `apps/web` (Angular SSR) and the `libs/` ui, domain and data-access libraries; the FastAPI project in `api/` with a `/v1/health` endpoint and a PostGIS connectivity test; the local Docker Compose stack (PostGIS, Redis, MinIO, Mailpit, Caddy); the brand tokens and logo set; the ADRs, the env reference and the security drafts in `docs/`; and the `inecekvar-ci.yml` workflow. Resolved versions and the Phase 0 evidence are in `docs/adr/0001-stack-and-versions.md`.

Not exercised so far: iOS (no macOS host), the CI workflow on GitHub Actions (the branch is not pushed), the lefthook hooks themselves, the APK on an emulator or device, the dev servers behind Caddy, and wiring the brand icons into the SSR favicon and the Android launcher.

## Getting started

The product and technical specification lives in this folder as `05-inecekvar-ionic-angular.md`. Requirements: Node 22, pnpm 12, uv, Docker; JDK 21 for the Android build. Run the Phase 0 gates as in ADR-0001, from `inecekvar/`:

```sh
pnpm install --frozen-lockfile
pnpm exec prettier --check .
pnpm nx run-many -t lint test build --skip-nx-cache
docker compose up -d
```

and from `inecekvar/api/`:

```sh
uv sync --locked
uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app tests
uv run pytest
uv run uvicorn app.main:app --host 127.0.0.1 --port 57800 --no-proxy-headers --forwarded-allow-ips 127.0.0.1
```

Compose runs only the data and proxy services; the API and the dev servers run on the host. Ports and environment keys are listed in `docs/ops/env.md`.

## License

This project is licensed under the Apache License 2.0. See [LICENSE](../LICENSE).
