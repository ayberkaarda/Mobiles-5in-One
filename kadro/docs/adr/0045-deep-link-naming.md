# ADR-0045: Deep-link naming: one path set for web, scheme and app links

- Status: Proposed
- Date: 2026-10-02
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §7 (information architecture, app linking); ADR-0027, ADR-0034,
  ADR-0040; `packages/contracts/src/deep-links.ts`, `packages/config/src/mobile-schema.ts`

## Context

The spec names the invite landing `/mac/[inviteCode]` and, in the same sentence, a deep link
`kadro://match/[code]`. The code in that link is a **team invite** code (ADR-0034: 128-bit
code, stored as a hash, `POST invites/:code/accept` joins a team as `player`); there is no
match-level invite in the product. A link named `match` would point readers, reviewers and the
app router at the wrong resource, and two spellings (`/mac/` on the web, `match/` in the app)
would need a translation table that can drift.

Phase 3 (deep links, push) and Phase 4 (invite landing, AASA, `assetlinks.json`) are built in
parallel, so the paths have to be fixed before either starts.

## Decision

1. **One path set for every surface.** The web page path is also the app path, behind the custom
   scheme and behind verified https links:

   | Target                | Path                         | Custom scheme                       |
   | --------------------- | ---------------------------- | ----------------------------------- |
   | Team invite           | `/mac/<code>`                | `kadro://mac/<code>`                |
   | Venue                 | `/saha/<slug>`               | `kadro://saha/<slug>`               |
   | Open calls (district) | `/eksik-var/<il>/<ilce>`     | `kadro://eksik-var/<il>/<ilce>`     |
   | Verify email          | `/e-posta-dogrula#token=<t>` | `kadro://e-posta-dogrula#token=<t>` |
   | Reset password        | `/sifre-sifirla#token=<t>`   | `kadro://sifre-sifirla#token=<t>`   |

   The spec's `kadro://match/[code]` is implemented as `kadro://mac/<code>`. `match` is not a
   recognized link; it opens the home screen like any unknown link.

2. **Scheme and identifiers.** Scheme `kadro`; iOS bundle id and Android package
   `app.kadro.mobile` (`APP_SCHEME`, `MOBILE_APP_IDS`).
3. **Verified links.** `apple-app-site-association` components and the Android intent filters
   cover `/mac/*`, `/saha/*`, `/eksik-var/*`, `/e-posta-dogrula` and `/sifre-sifirla`
   (`APP_LINK_PATH_PATTERNS`). The spec lists the first three; the email links are added so a
   verification or reset link opens the app when it is installed (ADR-0027 planned this for
   Phase 3). Without the app the same URL opens the web page (ADR-0040).
4. **Host.** The https host is the origin in `EXPO_PUBLIC_WEB_ORIGIN` (mobile) and `WEB_ORIGIN`
   (web). The mobile key is optional locally and required outside local as a non-loopback
   `https://` origin. The web serves AASA only with `APPLE_TEAM_ID` and `assetlinks.json` only
   with `ANDROID_CERT_SHA256_FINGERPRINTS`; without them the file is not served (404) rather
   than naming a wrong app. `APPLE_APP_STORE_ID` enables the `apple-itunes-app` banner.
5. **Tokens stay in the fragment.** Email-link tokens are read from `#token=`, never from a
   query string, so they are not sent to any server by a browser and not logged.
6. **Parsing.** `parseDeepLink` accepts the custom scheme, a bare path, or an https link on an
   explicitly allowed origin, validates the code, slug or token with the contract schemas, and
   returns `null` for anything else. It uses string operations only, because the React Native
   runtime implements only part of the WHATWG URL API.
7. **Links only navigate.** Opening a link never performs an action; joining a team, applying to
   a call or redeeming a token needs an explicit tap and the normal server authorization
   (threat model T-MOB-03).

## Consequences

- Web pages, push payload targets, QR codes and app routes share one builder
  (`deepLinkPath`, `appDeepLink`, `webDeepLink`), so a path changes in one place.
- The threat model row T-MOB-03 still quotes `kadro://match/[code]`; the Phase 3 docs work
  package updates it to `kadro://mac/<code>`.
- Store identifiers are not secrets but belong to the owner's accounts; until they are set, the
  verified-link files are absent and the custom scheme is the only way into the app. A real
  domain is needed before Apple's CDN validates the association file.
