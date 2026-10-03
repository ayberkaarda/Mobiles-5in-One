# ADR-0076: Mobile end-to-end flows with Maestro on Android

- Status: Accepted (the flows have not been run on a device yet)
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §8 (Maestro flows), §11 (Phase 3 gate); ADR-0015, ADR-0034, ADR-0045,
  ADR-0047, ADR-0049, ADR-0050, ADR-0051, ADR-0052, ADR-0053, ADR-0054, ADR-0075; threat model
  T-MOB-03

## Context

The Phase 3 records leave the device paths to Maestro: router guard plus links (ADR-0047,
ADR-0049, ADR-0075), the screens against the real API, and the native modules that the component
tests replace with doubles. The spec lists Maestro flows in `apps/mobile/.maestro/` (login, create
match, RSVP, open call apply, delete account) and a Phase 3 gate of flows passing on the iOS
simulator and the Android emulator. There is no Mac, the API has no test-only seed endpoints, and
registration never issues a session or reveals whether an address exists (ADR-0015).

## Decision

### Flows

- Eleven flows under `.maestro/flows/`: sign-up, sign-in (with restart and sign-out), create team,
  create match, RSVP, join through an invite link, open call application, venue search, profile
  edit, links (pending invite across the sign-in, venue link, unknown link) and account deletion.
  Shared steps live in `.maestro/subflows/`; `.maestro/config.yaml` fixes the order.
- Elements are found by `testID` only, never by copy, so the flows do not depend on the device
  language. Missing ids were added as plain props (inputs of the sign-in and sign-up forms, the
  tab buttons, the confirm and cancel buttons of `ConfirmAction`); no behaviour changed.
- Every flow starts from a cleared app and signs in itself, so a failed flow does not break the
  next one. Each flow uses its own seeded account where state would otherwise leak (a free account
  owns one team, a deleted account cannot sign in).
- A unit test checks the workspace statically: each flow is in the execution order under its own
  name, every `${E2E_*}` value is one the seed writes, and every targeted id exists in the source.

### Test data

- No seed or reset endpoint is added to the API. `e2e/seed.mjs` uses the public API with the
  mobile client header against a local stack started from `docker-compose.yml`, plus two
  statements through `psql` in the database container for what the API cannot do: marking the
  run's addresses verified (verification needs the emailed link) and reading one district id
  (there is no district list route yet). Both are limited to rows of the run; nothing is deleted.
- Each run registers fresh accounts (`e2e-<role>-<run>@example.com`) with one random password
  made at run time. Values for the flows go to `e2e/.env.e2e` (ignored by git) and reach
  Maestro as `-e` parameters through `e2e/run-flows.mjs`. Nothing credential-like is committed.
- `e2e/compose.e2e.yml` raises the auth rate limit of the local stack only, because the seed and
  the flows sign in many times from one address within minutes.

### Build and CI

- The flows run against the debug variant: it loads JavaScript from Metro and is the only variant
  allowed plain HTTP to loopback hosts (`plugins/android-network-security.js`). `adb reverse`
  connects the emulator's `localhost` to the API and Metro on the host. Release builds keep
  refusing cleartext.
- `.github/workflows/kadro-mobile-e2e.yml` repeats the local steps on `ubuntu-latest` with
  `reactivecircus/android-emulator-runner` (API 34, x86_64), on manual dispatch only. Actions are
  pinned to commit SHAs and the Maestro archive to its SHA-256. It is not a required check.

## Consequences

- The Phase 3 gate is met only by an actual run: on the owner's machine (Pixel 8 AVD, JDK 17,
  Maestro CLI) or by dispatching the workflow. Writing the flows proves neither; until a run's
  report exists, the flows count as written and syntax-checked, not as passing.
- iOS is not covered. A `macos-latest` job or EAS can run the same flows later (only `appId`
  and the build step differ); no iOS result is claimed without the owner's approval.
- `GET /api/v1/districts` is part of the contracts but not served by the API, so the district
  pickers and the `/eksik-var/<il>/<ilce>` link show their error states on a real stack. No flow
  depends on them; the route belongs to the API owner.
- Not covered by the flows: Apple and Google sign-in, push delivery and notification taps, photo
  upload, verified https links. They need store accounts, an EAS project, FCM or a public domain.
- A debug build may show React Native development overlays over the screen; a flaky run should be
  checked against the screenshots in the report before a flow is changed.

## Rejected alternatives

- **A test-only seed or reset endpoint in the API.** Extra attack surface in a production
  codebase and an `APP_ENV` switch to guard it; the public API covers everything but verification
  and the district lookup.
- **Detox.** Needs native test code in the native projects and a separate runner; Maestro
  drives the installed app as a user and is what the spec names.
- **A release build against an https stack.** Would need a locally trusted certificate on the
  emulator; the debug build exercises the same JavaScript and native modules.
