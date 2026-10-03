# Running and testing the mobile app

Run everything from `kadro/apps/mobile` (or use `pnpm --filter @kadro/mobile <script>` from
`kadro/`). Each command below is marked with whether it was run while this page was written.

## Prerequisites

- Node and pnpm as for the rest of the repository (`kadro/.nvmrc`), then `pnpm install` in `kadro/`.
- `@kadro/config` must be built first: `pnpm --filter @kadro/config build`. `app.config.ts` imports
  the built module (`packages/config/dist/mobile.js`, because Expo loads the config with `require`
  and the package only exposes an ESM entry). Turbo does this for `build`, `typecheck`, `lint` and
  `test` from the repository root, and the `eas-build-post-install` script does it on EAS Build.
- The public environment below. Android work additionally needs Android Studio and JDK 17; there is
  no iOS setup on Windows or Linux.

## Environment variables

Defined in `kadro/.env.example` (section "Mobile public values") and validated by
`loadMobilePublicEnv` from `@kadro/config/mobile` (`packages/config/src/mobile-schema.ts`). They
are compiled into the binary, so they must never hold secrets. The validator reads the process
environment: export the variables in the shell (or provide them through an Expo `.env` file in
`apps/mobile`); `kadro/.env.example` is a reference and is not read by Expo.

| Variable                                 | Rule                                                                                                                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_APP_ENV`                    | `local`, `preview` or `production`. Required.                                                                                                                                          |
| `EXPO_PUBLIC_API_URL`                    | Absolute URL of the web / API app. `https://` is required outside `local`; no credentials, query string or fragment. Physical devices need the LAN address, not `localhost`. Required. |
| `EXPO_PUBLIC_WEB_ORIGIN`                 | Bare origin (`https://kadro.app`, no path or trailing slash). Optional for `local` (no https links are registered); required outside `local` as a non-loopback `https://` origin.      |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`     | Public SDK key `appl_...`. Optional everywhere; without it the paywall says Pro is unavailable.                                                                                        |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | Public SDK key `goog_...`. Same rule.                                                                                                                                                  |

A missing or invalid value stops the build while the config is evaluated and names only the key.
Observed: with `EXPO_PUBLIC_APP_ENV=production` and `EXPO_PUBLIC_API_URL=http://x.test`, `pnpm export`
fails with `EXPO_PUBLIC_WEB_ORIGIN: is required`; with neither variable set it fails with
`EXPO_PUBLIC_APP_ENV: is required`.

## Commands

| Command                       | What it does                                                                                                                                                                       | Run here                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm start`                  | `expo start`: Metro dev server.                                                                                                                                                    | Not run (long-running).                                             |
| `pnpm android` / `pnpm ios`   | `expo start --android` / `--ios`: starts Metro and opens an installed development build.                                                                                           | Not run (needs an emulator, simulator and a build).                 |
| `pnpm exec expo run:android`  | Writes `android/` (ignored by git), builds the debug variant, installs it on the running emulator.                                                                                 | Not run (needs Android SDK and an emulator).                        |
| `pnpm typecheck`              | `tsc --noEmit`.                                                                                                                                                                    | Run: exit 0, no diagnostics.                                        |
| `pnpm lint`                   | ESLint with `--max-warnings 0`.                                                                                                                                                    | Run: exit 0, no diagnostics.                                        |
| `pnpm test`                   | Vitest (`vitest run`), including the build configuration tests.                                                                                                                    | Run: 41 test files, 692 tests passed.                               |
| `pnpm build`                  | `scripts/export.mjs --bundle-check`: `expo export` for android and ios into `dist/` (ignored), with local-only defaults for unset `EXPO_PUBLIC_APP_ENV` and `EXPO_PUBLIC_API_URL`. | Run: `Exported: dist`, both an `ios` and an `android` bundle exist. |
| `pnpm export`                 | Strict `expo export`: no defaults, a missing or invalid public environment fails.                                                                                                  | Run with invalid values (failure shown above).                      |
| `maestro check-syntax <flow>` | Validates a flow file without a device.                                                                                                                                            | Not run (Maestro is not installed on this machine).                 |

For a local run against the stack from `kadro/docker-compose.yml`, use
`EXPO_PUBLIC_APP_ENV=local` and `EXPO_PUBLIC_API_URL=http://localhost:3000` (the `.env.example`
values). On an Android emulator `adb reverse tcp:3000 tcp:3000` makes that address reach the host.

## Unit and screen tests (Vitest)

- Config: `vitest.config.mts`. Environment `node`, tests in `tests/**/*.test.{ts,tsx}`, setup in
  `tests/setup.ts`. Native modules (`react-native`, `expo-router`, `expo-secure-store`,
  `expo-notifications`, `react-native-purchases`, AsyncStorage, FlashList, and others) are aliased to
  doubles in `tests/support/`; the application code under test is the real source.
- Screen tests render with `@testing-library/react-native` and serve the API with `msw`; unit tests
  cover the pure modules (API client and refresh races, session, query persistence, link parsing,
  notification routing, forms, billing port and flow, i18n catalogs).
- One file or pattern: `pnpm exec vitest run tests/deep-links.test.ts`.
- What the unit tests do not cover: native modules (the Apple and Google sheets, the real
  notification service, the RevenueCat SDK, the image picker), rendering on a device, and real
  network behaviour.

## End-to-end flows (Maestro, Android)

The flows in `.maestro/` drive a debug build on an Android emulator against a local stack (web and
API, worker, PostgreSQL); decisions in ADR-0076. Setup, seeding and the flow list are in
[`apps/mobile/e2e/README.md`](../../apps/mobile/e2e/README.md). Summary: start the stack with
Docker Compose (`docker-compose.yml` plus `apps/mobile/e2e/compose.e2e.yml`), run `node e2e/seed.mjs`
before every full run, install the debug build with `expo run:android`, then
`node e2e/run-flows.mjs` (all flows, in the order of `.maestro/config.yaml`) or
`node e2e/run-flows.mjs .maestro/flows/<flow>.yaml`. The `kadro-mobile-e2e` GitHub workflow runs the
same steps on manual dispatch only; it is not a required check. None of these were run for this
page.

Covered: sign-up, sign-in and sign-out, team creation, match creation, RSVP, invite link, open
call application, venue search, profile edit, deep links, account deletion. Not covered: Apple and
Google sign-in, push delivery, photo upload, verified https links, billing, iOS.

## Builds with EAS

`eas.json` defines three build profiles; none was run here (no EAS project or account is
configured in this repository).

| Profile       | Distribution | Output                                                        | `EXPO_PUBLIC_APP_ENV` | Channel      |
| ------------- | ------------ | ------------------------------------------------------------- | --------------------- | ------------ |
| `development` | internal     | Android APK (`:app:assembleDebug`), iOS simulator Debug build | `local`               | none         |
| `preview`     | internal     | Android APK                                                   | `preview`             | `preview`    |
| `production`  | store        | Android app bundle; version auto-incremented                  | `production`          | `production` |

Each profile sets only `EXPO_PUBLIC_APP_ENV` and selects the matching EAS environment. The other
values are not stored in the repository: create them per environment, for example
`eas env:create --environment production --name EXPO_PUBLIC_API_URL --visibility plaintext`
(`EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_ORIGIN` are required for `preview` and `production`).
`appVersionSource` is `remote`. The `submit.production` block is empty.

Native configuration worth knowing (`app.config.ts`, `plugins/android-network-security.js`):

- Release builds refuse cleartext traffic; the debug variant allows plain HTTP to loopback hosts
  only. iOS keeps the App Transport Security defaults.
- Bundle identifier and Android package are `app.kadro.mobile`; `usesAppleSignIn` is on; the app is
  portrait only and not tablet-optimized on iOS.
- Updates: the `expo-updates` code signing block exists (`updatesConfig`) but is emitted only when a
  certificate path is supplied; `createConfig` currently passes none, and no certificate or key is
  committed.
- The deep link scheme and the https associations are described in `deep-links-and-push.md`.

## Known limits

- A development build is needed for anything native: the app is not set up for Expo Go. Push
  tokens need an EAS project id, Apple sign-in needs the `usesAppleSignIn` entitlement and
  `react-native-purchases` needs native code. `eas.json` `development` builds a Debug binary that
  loads JavaScript from Metro (no `expo-dev-client` package is used).
- `expo-location` is registered as a config plugin in `app.config.ts` (with a Turkish
  when-in-use permission text) but no source file imports it: the location is never read. The
  open call and venue filters send a district id, and the venue form takes the coordinates as typed
  text. `react-native-maps` is a dependency, but no source file imports it (the venue directory is
  a list, ADR-0053).
- No image picker module is installed (`avatarPicker` is `null` in `src/profile/instance.ts`), so
  "change photo" is hidden on the profile edit screen; the upload flow after the picker exists.
- No connectivity detection: the `offline` error copy has no producer, an unreachable server shows
  the network error (see `architecture.md`).
- Store billing, push delivery, Apple and Google sign-in and verified https links were never run
  against real accounts or domains (`billing.md`, `deep-links-and-push.md`).
- iOS has been bundled (`pnpm build`) but never run on a simulator or device in this repository.
