English | [Türkçe](README.tr.md)

# İnecek Var

Tagline (tr): "Dolmuş nereden geçer? Mahalle bilir."

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

Phases 0 to 2 are merged into `main`: the foundation, then the API with the data model, authentication, moderation, traces, planner, city packs, export and account deletion (506 API tests passed in the Phase 2 gate, see `docs/adr/0029-phase-2-gate.md`). The app UI (Phase 3), web SEO, webhooks and hardening are not merged yet. The folder holds the Nx workspace with `apps/mobile` (Ionic 9 on Capacitor, Android project committed), `apps/web` (Angular SSR) and the `libs/` ui, domain and data-access libraries; the FastAPI project in `api/`; the local Docker Compose stack (PostGIS, Redis, MinIO, Mailpit, Caddy); the brand tokens and logo set; the ADRs, the env reference and the security drafts in `docs/`; and the `inecekvar-ci.yml` workflow. Resolved versions and the Phase 0 evidence are in `docs/adr/0001-stack-and-versions.md`.

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
uv run uvicorn app.main:app --host 127.0.0.1 --port 57800
```

Compose runs only the data and proxy services; the API and the dev servers run on the host. Ports and environment keys are listed in `docs/ops/env.md`.
