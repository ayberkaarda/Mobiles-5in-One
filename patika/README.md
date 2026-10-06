English | [Türkçe](README.tr.md)

# Patika

Tagline (tr): "Mahallenin patilerini birlikte koruyalım."

## Product summary

Patika is a community platform for street animals that connects neighbourhood volunteers. It offers a feeding-station map, "Beslendi" (fed) check-ins, animal profiles, adoption listings, urgent-help posts and a directory of nearby vets and shelters. The name means "footpath" and contains "pati" (paw). The tone is warm and communal, dignified and never guilt-tripping. Volunteer privacy is a product feature: photos are stripped of location metadata on the device and volunteer positions are never stored.

## MVP features

- Sign in with Apple and email with password; anonymous browsing of the map and listings.
- Map of feeding stations with clustering and filters (cat or dog, food or water, "mama bitti"); station detail with photos, recent check-ins and a "Beslendi" button.
- Add and edit stations by pin drop or current position.
- Animal profiles with species, health flags (sterilized, vaccinated, ear-tagged), status, photos, follow and a sighting log.
- Adoption listings with a moderation queue, request form, replies, and auto-close after 60 days or when adopted.
- Acil Yardım (urgent help): posts for injured or sick animals with geofenced push to opted-in volunteers within 2 km, with per-post and per-user caps, plus a vet and shelter directory with a 24-hour flag.
- Volunteer profile with feeding count and badges; no shaming leaderboards.
- Push notifications for nearby urgent posts, adoption replies and followed-animal updates.
- Offline cache of the last viewed region and an outbox for check-ins.
- Patika Destekçi subscription: supporter badge, no upsell banners, larger photo quota.
- In-app and web account deletion.
- Website: marketing, public adoption listings, station and district pages, care-place directory, guides, legal pages, an impact page with real numbers and a moderation/admin area.

## Out of scope

- Donations to individuals or any money flow other than the Destekçi subscription
- Live chat
- Android (planned for v2)
- Vet appointment booking
- Real-time animal tracking devices
- Leaderboards
- Ads

## Planned technology stack

| Layer              | Technology                                        |
| ------------------ | ------------------------------------------------- |
| Mobile app         | .NET MAUI (C#), Android first; iOS not built here |
| Backend API        | ASP.NET Core Minimal APIs (C#), EF Core           |
| Web and admin      | ASP.NET Core Razor Pages, server-side rendered    |
| Background jobs    | .NET Worker with Quartz.NET                       |
| Database           | PostgreSQL with PostGIS                           |
| Object storage     | S3-compatible (Cloudflare R2)                     |
| Push notifications | APNs (token-based)                                |
| Email              | Resend                                            |

## Planned architecture

A repository with a .NET MAUI app project (C#, Android first; iOS is not built or exercised here) and a .NET solution under `src/` split into Domain, Infrastructure, Api, Web, Worker and Contracts projects, with tests under `tests/`. The API is organised as vertical slices with versioned JSON endpoints under `/v1`; the Razor web app renders public SEO pages and the admin area; the worker handles push fan-out, deletions, subscription reconciliation and backup checks. Subscription entitlement is decided server-side from verified store transactions and notifications.

## Status

This folder currently contains only a design/spec document; no source code has been written yet.

## Getting started

There is no code to install or run yet. The product and technical specification lives in this folder as `03-patika-swift-ios.md`. This README will be updated once development starts.
