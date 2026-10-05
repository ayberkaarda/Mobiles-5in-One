# ADR-0052: App linking files and Smart App Banner

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Shop pages should open in the app when it is installed. iOS and Android verify two files on the
domain, and both need accounts and keys that do not exist for this portfolio build.

## Decision

- `/.well-known/apple-app-site-association`: `application/json`, no file extension. `appID` and
  `appIDs` are `<APPLE_TEAM_ID>.app.askida.mobile`; while `APPLE_TEAM_ID` is empty the bare
  `app.askida.mobile` is rendered, and a test documents the empty branch. Paths and components cover
  `/dukkan/*` and `/d/*`. The team id is read from `services.apple.team_id`.
- `/.well-known/assetlinks.json`: package `app.askida.mobile`, `sha256_cert_fingerprints` from
  `WEB_ANDROID_CERT_SHA256` (comma list; empty gives an empty list).
- `<meta name="apple-itunes-app">` is emitted only when `WEB_IOS_APP_ID` is a numeric id. Store links
  (`WEB_STORE_URL_ANDROID`, `WEB_STORE_URL_IOS`) appear on pages and in the `MobileApplication`
  block only when set. The shop page's primary action is the deep link `askida://shop/{slug}`.
- Both files are served by Laravel through the page cache (300 s). All keys are documented in
  `docs/ops/env.md`; none is a secret.

## Consequences

- Tests cover both branches (set and empty) for each key.
- not exercised: Apple and Google verification of the two files: no Apple team, no store accounts,
  no signing certificate, no domain.
- not exercised: the Smart App Banner with a real App Store id: no store listing.
- not exercised: install and open flow from a link on a device.
