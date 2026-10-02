English | [Türkçe](README.tr.md)

# Askıda

Tagline (tr): "İyilik askıda kalmasın."

## Product summary

Askıda is a pay-it-forward network built on the Turkish "askıda ekmek" (bread on the hook) tradition. Donors prepay everyday items such as bread, soup, meals or stationery at verified local shops. Recipients collect them anonymously with a one-time code, without creating an account. One mobile app serves three modes: donor, merchant (esnaf) and recipient. The tone is warm, dignified and plain, never pitying.

## MVP features

- Donor and merchant sign-up with email and password, Sign in with Apple and Google, password reset.
- Merchant onboarding: shop details, map pin, verification documents, state `Pending → Verified | Rejected`; only verified shops are visible.
- Merchant catalog: items with category, price and a daily redeem cap.
- Donor flow: browse shops by distance, choose item and quantity, pay through a card checkout, receive a receipt and see donation history, with per-transaction and per-day caps.
- Recipient flow: no account, anonymous device identity, nearby shops with available items, one-time 8-character code (text and QR) valid for 10 minutes, daily fairness caps.
- Redemption: the merchant scans the QR or types the code; the server validates it; the donor receives an anonymous "Askın alındı" push.
- Payout ledger: donations, redeemed counts, settlement status and transparent platform commission.
- Impact: public district-level counters and an in-app donor impact card.
- Push notifications for merchants ("Yeni askı") and donors ("Askın alındı").
- In-app and web account deletion; an anonymous "reset my data" option for recipients.
- Website: marketing and how-it-works pages, verified-shop directory, impact page, guides, legal pages and an admin panel.

## Out of scope

- Cash donations to individuals
- Recipient accounts or profiles
- Chat
- Ratings of recipients
- Pharmacy or medical items
- Multi-currency
- Delivery
- Ads
- Corporate donor invoicing portal (planned for v2)

## Planned technology stack

| Layer | Technology |
|---|---|
| Mobile app | Flutter (iOS and Android), Riverpod, go_router, drift |
| Backend API | Laravel (PHP 8.3+), Sanctum |
| Admin panel | Filament 3 |
| Database | PostgreSQL with PostGIS |
| Queues and cache | Redis, Horizon |
| Object storage | S3-compatible (Cloudflare R2) |
| Payments | iyzico marketplace payments (Checkout Form and sub-merchants) |
| Web | Laravel Blade, server-side rendered |
| Device attestation | Play Integrity (Android) and DeviceCheck (iOS) via platform channels |

## Planned architecture

A monorepo with two main roots: `app/` for the Flutter client and `server/` for the Laravel backend, plus `brand/` and `docs/`. The Flutter app is a single codebase with donor, merchant and recipient modes. The backend exposes a versioned JSON API under `/api/v1`, serves the Blade website and hosts the Filament admin. Money is stored as integer minor units (kuruş) in TRY; the platform never holds funds, since payments flow from the donor through the payment provider to the merchant. Recipient anonymity is a core invariant: no accounts, no recipient identity shown to donors or merchants, and no precise recipient location stored.

## Status

This folder currently contains only a design/spec document; no source code has been written yet.

## Getting started

There is no code to install or run yet. The product and technical specification lives in this folder as `04-askida-flutter.md`. This README will be updated once development starts.
