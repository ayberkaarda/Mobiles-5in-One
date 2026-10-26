English | [Türkçe](README.tr.md)

# Patika

Tagline (tr): "Mahallenin patilerini birlikte koruyalım."

<img src="docs/design/screenshots/web-home-1440.png" alt="Patika web home page: the hero with the illustrated Moda morning-round map, the four-stop round timeline, adoption cards, the dark urgent-help section with nearby care places and the weekly impact line, local build, sample data" width="100%">

<img src="docs/design/screenshots/android-harita.png" alt="Patika Android app: map tab with the Moda, Kadıköy chip, the Hepsi, Kedi, Köpek, Su and Mama bitti filters, station pins and the station sheet with the Beslendi button, sample data, emulator" width="24%"> <img src="docs/design/screenshots/android-sahiplen.png" alt="Patika Android app: Yuva arayanlar adoption list with tag cards for Pamuk and Karabaş and the moderation note, sample data, emulator" width="24%"> <img src="docs/design/screenshots/android-acil.png" alt="Patika Android app: dark urgent-help screen with the Acil yardım çağrısı aç button, three steps and nearby care places, sample data, emulator" width="24%"> <img src="docs/design/screenshots/android-profil.png" alt="Patika Android app: volunteer profile with 128 feedings, 4 stations, badges and the Hesabımı sil entry, sample data, emulator" width="24%">

Web home page from a local build and Android screens from the `Pixel_8` emulator, both against the local stack with `[ÖRNEK]` sample data. More screens are in the [gallery](#gallery).

Live demo: a [static snapshot of the public web](https://ayberkaarda.github.io/Mobiles-5in-One/patika/) runs on GitHub Pages. It is a local build with `[ÖRNEK]` sample data, not a live service: sign-in, the admin console, the district filter and the app do not work there.

## Product summary

Patika is a community platform for street animals that connects neighbourhood volunteers. It offers a feeding-station map, "Beslendi" (fed) check-ins, animal profiles, adoption listings, urgent-help posts and a directory of nearby vets and shelters. The name means "footpath" and contains "pati" (paw). The tone is warm and communal, dignified and never guilt-tripping. Volunteer privacy is a product feature: photos lose their location metadata before upload and again on the server, and volunteer positions are never stored.

## Features

- Email and password sign-in with 6-digit email codes, Google sign-in (code path; needs an OAuth client to run), anonymous browsing of the map and listings.
- Map of feeding stations with clustering and filters (cat or dog, food or water, "mama bitti"); station detail with recent check-ins and a "Beslendi" button; an offline cache of the last area and an outbox for check-ins.
- Animal profiles with health flags, follows and sightings; adoption listings with moderation, requests and replies, closed after 60 days or when adopted.
- Acil Yardım: urgent posts with a geofenced push to opted-in volunteers within 2 km, capped per post (500 devices), per author and per day.
- Vet and shelter directory with a CSV import for admins.
- Volunteer profile with feeding count and badges, no leaderboards.
- Patika Destekçi subscription (simulated Google Play Billing): supporter badge and a larger photo quota.
- Account deletion in the app and on the web, with a 7-day grace period and a full purge.
- Website: public adoption, station, district and care-place pages, five guides, legal drafts, an impact page with real counts, `llms.txt`, sitemaps and JSON-LD; an admin console with password plus TOTP, step-up for destructive actions and an audit log.

Out of scope: donations, chat, vet booking, live tracking, leaderboards, ads, iOS.

## Gallery

| | |
| --- | --- |
| <img src="docs/design/screenshots/web-hero-390.png" alt="Patika web hero at phone width with the illustrated morning-round map, sample data" width="100%"> | <img src="docs/design/screenshots/admin-kuyruk-1440.png" alt="Patika admin moderation queue: an adoption post whose script tag text renders as plain text, with approve and reject, local build, sample data" width="100%"> |
| Web hero at 390 px | Admin moderation queue: a stored `<script>` payload shows as text |
| <img src="docs/design/screenshots/admin-giris-totp-1440.png" alt="Patika admin sign-in step 2 of 2: the 6-digit authenticator code with the recovery-code option" width="100%"> | <img src="docs/design/screenshots/admin-kullanicilar-stepup-1440.png" alt="Patika admin users page with a masked email, a role change and the re-verification form asking for a reason and a code" width="100%"> |
| Admin sign-in, second factor | Users page with step-up (reason plus code) |
| <img src="docs/design/screenshots/admin-csv-1440.png" alt="Patika admin care-place CSV import preview: 2 rows ready and 2 rejected, one for a bad phone number and one for a formula cell" width="100%"> | <img src="docs/design/screenshots/destekci-paywall.png" alt="Patika Android Destekçi paywall with the benefits, sample monthly and yearly prices and the test-payment note, emulator" width="40%"> <img src="docs/design/screenshots/destekci-profile.png" alt="Patika Android profile after a simulated test purchase with the Patika Destekçi card and badge, emulator" width="40%"> |
| Care-place CSV import with rejected rows | Destekçi paywall and the profile after a simulated purchase |

Play Store listing assets (six 1080x1920 screens and the feature graphic) are in [`docs/release/play-assets`](docs/release/play-assets/).

## Technology stack

| Layer | Technology |
| --- | --- |
| Mobile app | .NET 10 MAUI (C#), Android only (`net10.0-android`) |
| Backend API | ASP.NET Core minimal APIs (C#), EF Core with Npgsql and NetTopologySuite |
| Web and admin | ASP.NET Core Razor Pages, server-rendered, no client JavaScript; the admin console is a BFF over the API |
| Background jobs | .NET Worker (fan-out, purge, reconciliation, cost guard, backup check) |
| Database | PostgreSQL 17 with PostGIS 3.5 |
| Object storage | S3-compatible (MinIO locally, Cloudflare R2 planned); images re-encoded with SkiaSharp |
| Push, email, billing | FCM HTTP v1, Resend, Google Play Billing: code paths with local fakes (see below) |

## Architecture

```
app/Patika.App           MAUI Android app: map, stations, animals, adoption, urgent, profile, Destekçi
src/Patika.Domain        entities, permission matrix, rules (no infrastructure references)
src/Patika.Contracts     request and response DTOs shared by the API, the Web and the app
src/Patika.Infrastructure EF Core model and migrations, storage, logging masks, billing transport
src/Patika.Api           /v1 vertical slices, auth (Argon2id, ES256 JWT, refresh families, TOTP), rate limits
src/Patika.Web           public SEO pages on a read-only database role, admin console calling the API
src/Patika.Worker        scheduled and queued jobs
tests/                   Api, Security (attack suite), Web, Worker, App and Domain tests
ops/                     backup, restore and drill scripts, CI helpers (package audit, ZAP baseline)
```

The app talks only to the API. The Web reads public data with a read-only role and sends every admin action through the API, holding the API tokens encrypted in a path-scoped cookie. Entitlements are decided server-side from verified store data. ADRs 0001 to 0010 in [`docs/adr`](docs/adr/) record the decisions.

## Real vs simulated

Patika is a portfolio project: there is no hosted service, no store account and no company behind it.

| Area | State |
| --- | --- |
| API, Web, admin, Worker, database, migrations, authorization, quotas, audit | Real code, run locally in Docker and in tests |
| Android app | Real app, run on the `Pixel_8` emulator; never published |
| Google Play Billing | Simulated: the app uses `FakeBillingClient`, the server a fake Play Developer API; prices are samples and nothing is charged ([ADR-0010](docs/adr/0010-play-billing-simulated.md), [demo](docs/demo/destekci.md)) |
| Play RTDN webhook | Real verification code (Pub/Sub OIDC JWT), exercised with local RSA test keys only |
| Push (FCM), email (Resend), Google sign-in | Code paths exist; without credentials they fall back to logging or "not configured" senders |
| Hosting, domain, TLS, R2, backups to a bucket | Not deployed; backups and the restore drill run against local Docker |
| Legal texts | Drafts marked "Taslak", not reviewed |
| Sample content | `[ÖRNEK]` rows, shown only when `Web:ShowSamples` is on |

## Running locally

Requirements: .NET SDK 10.0.402 (`global.json`), Docker, and for the app the MAUI Android workload, JDK 21 and an Android emulator.

```sh
cp .env.example .env              # Development by default; no secrets needed locally
docker compose up --build -d      # PostGIS, MinIO, API :5000, Web :5001, Worker
```

The API applies migrations on startup in compose only. Host port 5432 must be free (or override the port). Sign-up codes are written to the API's development mail folder. Then run the app on an emulator:

```sh
dotnet build app/Patika.App/Patika.App.csproj -f net10.0-android -t:Run
```

Tests need Docker (Testcontainers):

```sh
dotnet test Patika.slnx
dotnet format Patika.slnx --verify-no-changes
dotnet build app/Patika.App/Patika.App.csproj -f net10.0-android -c Release
bash ops/ci/zap/zap-baseline.sh   # ZAP baseline against a throwaway compose stack
```

Configuration keys are listed in [`docs/ops/env.md`](docs/ops/env.md).

## Security

All 23 checklist items are mapped in the [verification matrix](docs/security/verification-matrix.md): 19 done, 4 partial (HTTPS, the Play webhook, backups and the attacker-style testing item, each because part of the proof needs a real domain, a Play account or cloud storage). Further reading: [pentest report](docs/security/pentest-report.md), [threat model](docs/security/threat-model.md), [authorization matrix](docs/security/authorization-matrix.md), [hardening notes](docs/security/hardening.md), [ZAP](docs/security/scans/zap.md) and [MobSF](docs/security/scans/mobsf.md) results, [history-purge runbook](docs/security/history-purge-runbook.md). Operations: [backup and restore](docs/ops/backup-restore.md), [cost alerts](docs/ops/cost-alerts.md), [logging](docs/ops/logging.md). Release documents: [Play listing](docs/release/play-listing.md), [Data Safety](docs/release/data-safety.md), [signing](docs/release/signing.md).

## Status

Phases 0 to 5 are merged; phase 6 (hardening, scans and release readiness) is the last one. The final report is [`docs/handoffs/phase-6-report.md`](docs/handoffs/phase-6-report.md).

## License

Apache License 2.0. See [LICENSE](../LICENSE).
