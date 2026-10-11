English | [Türkçe](README.tr.md)

# Çetele

Tagline (tr): "Veresiyeyi unutma, Çetele'ye yaz."

## Product summary

Çetele is an offline-first digital "veresiye defteri" (credit ledger) for small shop owners such as grocers, greengrocers, butchers, barbers and coffeehouses. It tracks customers, debts, payments and reminders, works without an internet connection, and syncs across devices (owner and staff). The name comes from the traditional tally stick used to record debts by notches. The tone is respectful (formal "siz"), plain Turkish, without fintech jargon.

## MVP features

- Login with phone number and SMS one-time code; app PIN or biometric lock.
- Shops with `OWNER` and `STAFF` roles; staff invited by phone number.
- Customers with name, phone, note and tag; live balances and per-customer statements.
- Ledger entries of type debt or payment, with amount, date, note and optional photo; entries are immutable and corrections are reversing entries.
- Dashboard: today's debts and payments, total receivable, top debtors, debts due today.
- Reminders via WhatsApp share (with a signed statement link) and SMS (only for customers with recorded consent, with monthly quotas).
- Export: PDF statement per customer and CSV of all entries.
- Offline-first operation with an outbox that syncs when online; multi-device consistency.
- Çetele Pro, a Google Play subscription: unlimited customers (Free is limited to 100), larger SMS quota, more photos per month, priority sync.
- In-app and web account and shop deletion.
- Website: marketing site, guides, legal pages and an admin console for platform admins.

## Out of scope

- Payment processing
- POS integration
- e-Fatura / GİB integration
- Inventory
- iOS app (a Kotlin Multiplatform version is a v2 candidate)
- Accountant portal
- Multi-currency
- Advertising

## Planned technology stack

| Layer | Technology |
|---|---|
| Android app | Kotlin, Jetpack Compose (Material 3), Hilt |
| Local storage | Room with SQLCipher, Proto DataStore |
| Background work | WorkManager (sync, reminders, photo upload) |
| Networking | Ktor client, Kotlinx Serialization |
| Backend API | Spring Boot 3 (Kotlin), Spring Security, Spring Data JPA |
| Database | PostgreSQL with Flyway migrations |
| Object storage | S3-compatible (photos, presigned URLs) |
| Billing | Google Play Billing, Play Developer API |
| Web and admin | Thymeleaf, server-side rendered |

## Planned architecture

A single repository with two roots: `android/` (a multi-module Gradle project with domain, data, network, design system and feature modules) and `server/` (Spring Boot), plus `brand/` and `docs/`. The Android app keeps all data in an encrypted local database and works offline. Sync uses a local outbox of operations and a server change log: ledger entries are append-only so they do not conflict, customer profile fields use last-writer-wins, and deletions are tombstones. Money is stored as integer minor units (kuruş) in TRY. Every tenant table is scoped by shop, and the shop is always derived from the caller's membership rather than from request input.

## Status

Phases 0 to 4 of 7 are merged: the repository foundation, the Spring Boot server (authentication and security baseline, sync with a change log, ledger, reminders, media pipeline, account and shop deletion, Play billing with purchase linking and entitlements, Play RTDN and SMS delivery-report webhooks, the admin console with TOTP and an audit log) and the Android app (offline-first ledger, sync engine, PIN and biometric lock, reminders, PDF and CSV export, settings, Play Billing and the Pro plan screens). Progress is about 71%. The public web (SEO and GEO, Phase 5) and release hardening (Phase 6) are not merged yet.

Verification so far is JVM unit tests and CI only; Play Developer API, RTDN signing keys and Play Integrity ran against fake adapters and recorded fixtures, with no Play account. The Android app has not been run on a device or emulator and the server has not been exercised by a real client, so biometrics, camera capture, real PDF output, WhatsApp and live SMS are untested. Left open: the KVKK notice link (a product decision), a running-sync signal for the dashboard refresh indicator and an upgrade button on the sync issues screen.

## Getting started

The product and technical specification is `02-cetele-kotlin-android.md`; architecture decisions are in `docs/adr`, the API in `docs/api/openapi.json` and the Android-to-server contract in `docs/handoffs`.

Android (JDK 21, Android SDK), from `android/`:

```
./gradlew ktlintCheck detekt lintDebug testDebugUnitTest assembleDebug
```

Server (JDK 21; the integration tests start containers, so Docker must be running), from `server/`:

```
./gradlew check
```
