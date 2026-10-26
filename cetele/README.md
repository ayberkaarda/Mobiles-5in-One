English | [Türkçe](README.tr.md)

# Çetele

[![Cetele CI](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-ci.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-ci.yml)
[![Cetele Security](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-security.yml/badge.svg)](https://github.com/ayberkaarda/Mobiles-5in-One/actions/workflows/cetele-security.yml)

"Veresiyeyi unutma, Çetele'ye yaz."

Çetele is an offline-first digital "veresiye defteri" (credit ledger) for small shop owners such as
grocers, greengrocers, butchers, barbers and coffeehouses. It tracks customers, debts, payments and
reminders, works without an internet connection, and syncs across the devices of the owner and the
staff. The name comes from the traditional tally stick used to record debts by notches. The tone is
respectful (formal "siz"), plain Turkish, without fintech jargon. It consists of a Kotlin Android
app and a Spring Boot server that also renders the public site and the admin console. A static
[web demo](https://ayberkaarda.github.io/Mobiles-5in-One/cetele/) of the public pages runs on
GitHub Pages; sign-in and forms do not work there.

| Customers | Customer ledger | Dashboard |
| --- | --- | --- |
| <img src="docs/release/screenshots/01-customers.png" width="220" alt="Cetele Android app: customer list with balances, sample customers, emulator"> | <img src="docs/release/screenshots/02-customer-ledger.png" width="220" alt="Cetele Android app: one customer's ledger with debts, a payment and a reversed entry struck through, sample data, emulator"> | <img src="docs/release/screenshots/03-dashboard.png" width="220" alt="Cetele Android app: dashboard with the total owed and the top debtors, sample data, emulator"> |

Debug build on the `Pixel_8` emulator against a locally started server with `[ÖRNEK]` sample data;
the capture method is in [`docs/release/screenshots/README.md`](docs/release/screenshots/README.md).

## Status

Portfolio project. All seven planned phases (0 to 6) are merged to `main`: foundation; the server
core with authentication and the security baseline; sync with a change log, the ledger, reminders
and the media pipeline; the Android app; Play billing, webhooks and the admin console; the public
web with SEO and GEO; hardening and release readiness. A hardening batch, a design refresh of the
app and the web, and a second security batch (reauthentication scope, device sessions, shop and SMS
caps) followed.

| Area                                             | State                                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Server, API, sync, admin console, public site    | Real code; the integration tests run against containers started by Testcontainers                                                     |
| Android app                                      | Real app, verified with JVM and Robolectric tests; the debug build was run on an emulator for the screenshots, no end-to-end flow run |
| Google Play Billing, RTDN, Play Integrity        | Real verification code, run against fake adapters and recorded fixtures; no Play account                                              |
| SMS (Netgsm) and delivery reports                | Client and webhook code tested with fakes; no SMS was sent                                                                            |
| Biometrics, camera capture, PDF output, WhatsApp | Code exists; not exercised on a device                                                                                                |
| Backups                                          | The `Cetele restore drill` workflow (PostgreSQL 16, MinIO, age) is scheduled monthly and has not run on GitHub Actions yet            |
| Hosting, domain, TLS, legal review               | Not set up; legal texts are samples                                                                                                   |

The verification matrix ([`docs/security/verification-matrix.md`](docs/security/verification-matrix.md))
has 12 rows done, 11 partial and 0 not started; the partial rows depend on external gates (a Play
account, a physical device, a domain, a legal review).

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

Out of scope: payment processing, POS integration, e-Fatura / GİB integration, inventory, an iOS
app (a Kotlin Multiplatform version is a v2 candidate), an accountant portal, multi-currency, ads.

## Technology stack

| Layer           | Technology                                                                          |
| --------------- | ----------------------------------------------------------------------------------- |
| Android app     | Kotlin 2.4.20, Jetpack Compose (BOM 2026.09.00, Material 3), Hilt 2.60.1, AGP 9.3.3 |
| Local storage   | Room 2.8.5 with SQLCipher 4.19.1, DataStore 1.2.1                                   |
| Background work | WorkManager 2.12.0 (sync, reminders, photo upload)                                  |
| Networking      | Ktor client 3.6.0, Kotlinx Serialization, OkHttp with certificate pinning           |
| Billing         | Google Play Billing 8.3.0, Play Integrity 1.6.0; Play Developer API on the server   |
| Backend API     | Spring Boot 4.1.1 (Kotlin, JDK 21), Spring Security, Spring Data JPA                |
| Database        | PostgreSQL 16 with Flyway migrations                                                |
| Object storage  | S3-compatible (AWS SDK v2; MinIO locally)                                           |
| Web and admin   | Thymeleaf, server-side rendered                                                     |

Resolved versions and the reasoning are in [`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md).

## Architecture

Two roots: `android/` (a multi-module Gradle project: `app`, the `core/` domain, data, network and
design system modules, and `feature/` modules for auth, shop, customers, ledger, reminders,
export, billing and settings) and `server/` (Spring Boot), plus `brand/` and `docs/`. The Android
app keeps all data in an encrypted local database and works offline. Sync uses a local outbox of
operations and a server change log: ledger entries are append-only so they do not conflict,
customer profile fields use last-writer-wins, and deletions are tombstones. Money is stored as
integer minor units (kuruş) in TRY. Every tenant table is scoped by shop, and the shop is always
derived from the caller's membership rather than from request input.

## Getting started

Android (JDK 21, Android SDK), from `android/`, the same command as CI:

```sh
./gradlew ktlintCheck detekt lintDebug testDebugUnitTest :core:domain:test :app:assembleDebug
```

Server (JDK 21; the integration tests start containers, so Docker must be running), from `server/`:

```sh
./gradlew check openApiContractCheck
```

Full local stack (PostgreSQL, MinIO, Mailpit and the server): build the server image from
`server/`, then start compose from this folder. Compose does not build the image itself:

```sh
./gradlew jibDockerBuild
docker compose up -d --wait
```

The server listens on http://127.0.0.1:60080 (the Android emulator reaches it at
`http://10.0.2.2:60080`) with the `local` profile and its stand-ins (fake SMS, fake integrity, fake
billing). Every environment key is in [`docs/ops/env.md`](docs/ops/env.md). Contributor rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## CI

- `Cetele CI`: Android (ktlint, detekt, Android lint, unit tests, debug APK), server (`check` and
  the OpenAPI contract check), brand assets, and a placeholder grep with full-history gitleaks.
- `Cetele Security`: OWASP Dependency-Check for both Gradle roots, a CycloneDX SBOM, and
  informational dependency-update and OWASP ZAP jobs.
- `Cetele restore drill`: a monthly backup and restore with PostgreSQL 16, MinIO and age.

## Documentation

- Product and technical specification: [`02-cetele-kotlin-android.md`](02-cetele-kotlin-android.md)
- Architecture decisions: [`docs/adr/`](docs/adr/README.md)
- API: [`docs/api/openapi.json`](docs/api/openapi.json) and [`docs/api/README.md`](docs/api/README.md); Android-to-server contracts in [`docs/handoffs/`](docs/handoffs/README.md)
- Security: [verification matrix](docs/security/verification-matrix.md), [threat model](docs/security/threat-model.md), [authorization matrix](docs/security/authorization-matrix.md), [pentest report](docs/security/pentest-report.md), [scan reports](docs/security/scan-reports/) (dependencies, MobSF, ZAP), [history-purge runbook](docs/security/history-purge-runbook.md)
- Operations: [environment](docs/ops/env.md), [backup and restore](docs/ops/backup-restore.md), [cost alerts](docs/ops/cost-alerts.md), [export format](docs/ops/export-format.md)
- Release: [release checklist](docs/release/release-checklist.md), [Data Safety](docs/release/data-safety.md), [Play listing](docs/seo/play-listing.md), [ASO](docs/seo/aso.md)

## License

This project is licensed under the MIT License. See [LICENSE](../LICENSE).
