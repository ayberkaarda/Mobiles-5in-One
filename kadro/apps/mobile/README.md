# @kadro/mobile

Kadro iOS and Android app: Expo SDK 57, Expo Router, React Native 0.86.

## Commands

Run from `kadro/apps/mobile` (or with `pnpm --filter @kadro/mobile <script>` from `kadro/`).

| Command          | What it does                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `pnpm start`     | Metro dev server (needs the public environment below)                        |
| `pnpm typecheck` | `tsc --noEmit`                                                               |
| `pnpm lint`      | ESLint, zero warnings                                                        |
| `pnpm test`      | Vitest, including the build configuration test                               |
| `pnpm build`     | `expo export` for Android and iOS (bundle check; local-only values if unset) |

`@kadro/config` must be built first (`pnpm --filter @kadro/config build`); turbo does this for
`build`, `typecheck`, `lint` and `test`.

## Public environment

`app.config.ts` validates the public mobile environment with `loadMobilePublicEnv` from
`@kadro/config/mobile` and fails fast, naming only the offending key, when a value is missing or
invalid.

| Variable              | Rule                                                             |
| --------------------- | ---------------------------------------------------------------- |
| `EXPO_PUBLIC_APP_ENV` | `local`, `preview` or `production`                               |
| `EXPO_PUBLIC_API_URL` | absolute URL; `https://` is required unless `APP_ENV` is `local` |

`EXPO_PUBLIC_*` values are compiled into the binary, so they must never hold secrets.

## EAS Build profiles

`eas.json` defines `development`, `preview` and `production`. Each profile sets only
`EXPO_PUBLIC_APP_ENV` and selects the matching EAS environment (`development`, `preview`,
`production`). The other values are not stored in the repository: create them as EAS environment
variables (or EAS secrets) per environment, for example:

```sh
eas env:create --environment production --name EXPO_PUBLIC_API_URL --visibility plaintext
```

A build whose environment is incomplete or invalid (such as a plain-HTTP API URL for `preview` or
`production`) stops while the config is evaluated.

## Native configuration

- HTTPS only: release builds set `cleartextTrafficPermitted="false"`
  (`plugins/android-network-security.js`, `expo-build-properties`); the development source sets
  allow plain HTTP to loopback hosts only. iOS keeps the App Transport Security defaults.
- Deep links: scheme `kadro://` and, once the web origin is part of the validated environment,
  universal links (`applinks:` on iOS, verified https intent filters on Android) derived from it.
- Updates: code signing configuration is prepared (`updatesConfig` in `app.config.ts`) and is only
  emitted when a certificate path is supplied; no certificate or key is committed.
