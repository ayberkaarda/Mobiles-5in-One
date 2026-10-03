# @kadro/mobile

Kadro iOS and Android app: Expo SDK 57, Expo Router, React Native 0.86.

## Commands

Run from `kadro/apps/mobile` (or with `pnpm --filter @kadro/mobile <script>` from `kadro/`).

| Command          | What it does                                                                           |
| ---------------- | -------------------------------------------------------------------------------------- |
| `pnpm start`     | Metro dev server (needs the public environment below)                                  |
| `pnpm typecheck` | `tsc --noEmit`                                                                         |
| `pnpm lint`      | ESLint, zero warnings                                                                  |
| `pnpm test`      | Vitest, including the build configuration test                                         |
| `pnpm build`     | `expo export` bundle check (`--bundle-check`: local-only defaults for unset variables) |
| `pnpm export`    | strict `expo export`: missing or invalid public environment fails                      |

`@kadro/config` must be built first (`pnpm --filter @kadro/config build`); turbo does this for
`build`, `typecheck`, `lint` and `test`, and the `eas-build-post-install` script does it on EAS Build
(`dist/` is not committed, and `app.config.ts` imports the built module).

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

`eas.json` defines `development` (a Debug build that loads Metro; no dev client package is used),
`preview` and `production`. Each profile sets only
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

## Documentation

Guides for this app are in [`docs/mobile`](../../docs/mobile):

- [`architecture.md`](../../docs/mobile/architecture.md): routing, state, API client, refresh
  single flight, i18n and error copy, offline behaviour.
- [`screens.md`](../../docs/mobile/screens.md): every screen with its data, states and test ids.
- [`deep-links-and-push.md`](../../docs/mobile/deep-links-and-push.md): link schemes and paths, held
  invite links, push registration and notification taps.
- [`billing.md`](../../docs/mobile/billing.md): the RevenueCat port and what is not verified.
- [`running-and-testing.md`](../../docs/mobile/running-and-testing.md): environment, commands,
  Vitest, Maestro, EAS and known limits.

End-to-end flows: [`e2e/README.md`](e2e/README.md) (Maestro, Android).
