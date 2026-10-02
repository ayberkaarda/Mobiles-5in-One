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
| Mobile and PWA | Ionic 8, Angular, Capacitor |
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

This folder currently contains only a design/spec document; no source code has been written yet.

## Getting started

There is no code to install or run yet. The product and technical specification lives in this folder as `05-inecekvar-ionic-angular.md`. This README will be updated once development starts.
