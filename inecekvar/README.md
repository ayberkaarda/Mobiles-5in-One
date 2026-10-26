English | [Türkçe](README.tr.md)

# İnecek Var

[![Inecek Var CI](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/inecekvar-ci.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/inecekvar-ci.yml)
[![Inecek Var Security](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/inecekvar-security.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/inecekvar-security.yml)

"Dolmuş nereden geçer? Mahalle bilir."

<img src="docs/screenshots/route-sign/web-home.png" alt="Inecek Var web home page: the name, the red from-to board, the street scene with the dolmuş, the labelled sample city and the three steps on a route line, local build, sample data" width="100%">

<img src="docs/screenshots/route-sign/android-01-search.png" alt="Inecek Var Android app: search screen with the Nereye inecek var? sign and the labelled sample city, sample data, emulator" width="32%"> <img src="docs/screenshots/route-sign/android-02-line.png" alt="Inecek Var Android app: line page with the ORN-1 placard, the stop diagram and the fare ticket, sample data, emulator" width="32%"> <img src="docs/screenshots/route-sign/android-03-planner-dark.png" alt="Inecek Var Android app in the dark scheme: A to B planner result with two transfers, sample data, emulator" width="32%">

Web home page from a local build and Android screens from the `Pixel_8` emulator, both against the local stack with sample data. The [line page](docs/screenshots/route-sign/web-line.png), a [guide](docs/screenshots/route-sign/web-guide.png) and the [dark home page](docs/screenshots/route-sign/web-home-dark.png) are in `docs/screenshots/route-sign`. A static [web demo](https://ayberkaarda.github.io/Mobiles-5in-One/inecekvar/) runs on GitHub Pages; sign-in and forms do not work there.

## Product summary

İnecek Var is a crowdsourced route map for dolmuş, minibus and servis lines in Turkish cities, where
official data is often missing. Passengers look up lines, stops, fares and hours, plan A to B trips
with transfers, and download offline city packs; neighbourhood contributors record rides as GPS
traces and propose or edit lines, and moderators review and publish them. The name is the phrase
passengers shout to stop a dolmuş. The tone is street-smart, playful and clear. The project is an
Nx workspace (Ionic and Angular app and PWA, Angular SSR web) with a FastAPI backend.

## Status

Portfolio project. All seven planned phases (0 to 6) are merged to `main` (pull requests #118 to
#128): foundation; data model, dual authentication and the security baseline; domain, moderation,
traces, planner, city packs, export and account deletion; the Ionic app and PWA; the Angular SSR
SEO and GEO pages with the moderation and admin UI behind a TOTP step-up; RevenueCat and Resend
webhooks with entitlements and nightly jobs; hardening and release readiness. After the phases came
a test flake fix, the gallery and web home page, the visual redesign (ADR-0059) and its route-sign
restyle (#138).

| Area                                          | State                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API, web, app and PWA, moderation, admin      | Real code; web e2e and mobile e2e suites run against the real local stack                                                                    |
| Android                                       | Capacitor shell, run on the `Pixel_8` emulator for the screenshots; the Android CI job is manual                                             |
| Plus subscription (RevenueCat), email (Resend) | Webhooks, reconciliation and the suppression list tested with fixtures; no real accounts, no store purchase                                 |
| Maps                                          | MapLibre with PMTiles; no hosted basemap is configured, so the app and the web lead with the stop diagram (ADR-0059)                          |
| Backups                                       | Encrypted backups and the `Inecek Var restore drill` workflow (last run on GitHub Actions passed on 2026-10-20); no R2 bucket                 |
| Hosting, domain, TLS and HSTS preload, Sentry, iOS | Not set up; the production Caddyfile is not exercised                                                                                   |
| Legal texts                                   | Samples, with the open items in [`docs/release/legal-open-items.md`](docs/release/legal-open-items.md)                                        |

The final verification matrix ([`docs/security/verification-matrix.md`](docs/security/verification-matrix.md))
has 15 rows done, 8 partial and 0 not started; the partial rows need hosting, the domain and TLS,
R2, provider accounts, GitHub runs of the workflows, iOS and owner decisions. The phase 6 gate
([ADR-0058](docs/adr/0058-phase-6-gate.md)) recorded 1195 API tests passed with 0 skipped; after the
redesign ([ADR-0059](docs/adr/0059-visual-redesign.md)) the web e2e suite reads 65 passed and the
mobile e2e suite 11 passed on the real stack.

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

Out of scope: real-time vehicle tracking, ticketing, ride-hailing, official-data claims, ads,
driver accounts, push notifications (planned for v2), routing across cities.

## Technology stack

| Layer            | Technology                                                                          |
| ---------------- | ----------------------------------------------------------------------------------- |
| Mobile and PWA   | Ionic 9.0.7, Angular 22.2, Capacitor 8.5 (Android shell)                            |
| Web              | Angular SSR 22.2 on Express                                                         |
| Maps             | MapLibre GL JS 6.11 with PMTiles 4.5; server-rendered SVG route maps on public pages |
| Monorepo tooling | Nx 23.3, pnpm 12, Vitest, Playwright, ESLint, Prettier                              |
| Backend API      | FastAPI 0.143 on Python 3.12, Pydantic 2.14                                         |
| Database         | PostgreSQL 16 with PostGIS 3.5, SQLAlchemy 2.1, Alembic 1.20                        |
| Cache and jobs   | Redis 7.4, arq 0.25 workers                                                         |
| Object storage   | S3-compatible (MinIO locally, Cloudflare R2 planned)                                |
| Subscriptions    | RevenueCat (native only)                                                            |

Resolved versions and the reasoning are in [`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md).

## Architecture

An Nx workspace with `apps/mobile` (Ionic and Angular, also served as a PWA), `apps/web` (Angular
SSR) and shared `libs/` for UI, domain types and the API client, plus a separate Python `api/`
project. The route planner builds a per-city graph in memory on publish and caches results. Web and
PWA clients use a cookie session, while native clients use bearer tokens, behind one auth
interface. Public line, stop and city pages are server-rendered, with route maps drawn as SVG so
they need no client-side map code. Raw GPS traces are private to their owner and moderators and are
deleted 30 days after the derived line version is published.

## Getting started

Requirements: Node 22, pnpm 12, uv, Docker; JDK 21 for the Android build. From `inecekvar/`
(Compose runs only the data and proxy services: PostGIS, Redis, MinIO, Mailpit, Caddy):

```sh
pnpm install --frozen-lockfile
docker compose up -d
pnpm exec prettier --check .
pnpm nx run-many -t lint test build
pnpm nx serve web        # or: pnpm nx serve mobile
```

From `inecekvar/api/`:

```sh
uv sync --locked
uv run alembic upgrade head
uv run ruff check . && uv run ruff format --check . && uv run mypy --strict app tests alembic
uv run pytest
uv run uvicorn app.main:app --host 127.0.0.1 --port 57800 --no-proxy-headers --forwarded-allow-ips 127.0.0.1
```

Caddy proxies `/api/*` to port 57800; ports, environment keys and the first-run bootstrap
(`python -m app.ops.bootstrap`) are in [`docs/ops/env.md`](docs/ops/env.md). Contributor rules are
in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## CI

- `Inecek Var CI`: workspace (brand tokens, Prettier, `nx run-many -t lint test build`), API (ruff,
  mypy, pytest, OpenAPI contract), checks (Compose validation, full-history gitleaks) and a manual
  Android debug build.
- `Inecek Var Security`: full-history gitleaks, `pnpm audit` and `pip-audit` (high and critical),
  OSV scan of both lockfiles, Bandit, Semgrep project rules and a CycloneDX SBOM.
- `Inecek Var restore drill`: an encrypted backup restored into a fresh PostGIS 16 with MinIO and age.

## Documentation

- Product and technical specification: [`05-inecekvar-ionic-angular.md`](05-inecekvar-ionic-angular.md)
- Architecture decisions: [`docs/adr/`](docs/adr/); phase gates in ADR-0036, ADR-0042, ADR-0050 and ADR-0058
- Reports: [final report](docs/handoffs/final-report.md) and the [phase reports](docs/handoffs/)
- API: [`docs/api/openapi.json`](docs/api/openapi.json)
- Security: [verification matrix](docs/security/verification-matrix.md), [threat model](docs/security/threat-model.md), [authorization matrix](docs/security/authorization-matrix.md), [attack report](docs/security/attack-report.md), [pentest report](docs/security/pentest-report.md), [XSS sweep](docs/security/xss-sweep.md), [scan reports](docs/security/scan-reports/), [dependency audit](docs/security/dependency-audit.md), [history-purge runbook](docs/security/history-purge-runbook.md)
- Operations: [environment](docs/ops/env.md), [background jobs](docs/ops/background-jobs.md), [backup and restore](docs/ops/backup-restore.md), [cost alerts](docs/ops/cost-alerts.md), [logging](docs/ops/logging.md)
- Release: [release checklist](docs/release/release-checklist.md), [store listing](docs/release/store-listing.en.md), [privacy labels](docs/release/privacy-labels.md), [signing](docs/release/signing.md), [PMTiles recipe](docs/release/pmtiles-recipe.md)
- SEO and GEO: [checklist](docs/seo/checklist.md), [ASO](docs/seo/aso.md)

## License

This project is licensed under the MIT License. See [LICENSE](../LICENSE).
