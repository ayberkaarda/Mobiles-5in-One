# Handoff security → mobile 001

- From: security verification (Phase 1, checklist item 10)
- To: owner of `apps/mobile`
- Status: open

## What is done

- `apps/mobile/app.json`: `expo-build-properties` (`android.usesCleartextTraffic: false`) and the
  local plugin `apps/mobile/plugins/android-network-security.js`, which writes
  `network_security_config.xml` with `cleartextTrafficPermitted="false"` for release builds and a
  loopback-only exception (`localhost`, `127.0.0.1`, `10.0.2.2`) for the `debug` and
  `debugOptimized` source sets. iOS App Transport Security is untouched.
- `apps/mobile/tests/build-config.test.ts` applies the plugins through Expo's mod compiler and
  asserts the generated files.

## What is missing

1. **`EXPO_PUBLIC_API_URL` validation at build time.** `packages/config` has
   `mobilePublicEnvSchema` (https:// required outside `local`), but nothing in the mobile build
   evaluates it, so a preview or production build with an `http://` URL is not stopped.
   Acceptance: the Expo config (for example an `app.config.ts` that calls `loadMobilePublicEnv()`
   from `@kadro/config/mobile`) fails `expo export` / EAS build when the value is not https:// in
   a non-local environment; a test shows the failure for `EXPO_PUBLIC_APP_ENV=production` with an
   `http://` URL.
2. **Development over a physical device.** Debug builds allow plain HTTP to loopback hosts only.
   Metro on a physical Android device must use `adb reverse tcp:8081 tcp:8081` (and
   `tcp:3000 tcp:3000` for a local API) instead of the LAN address. Document this in the mobile
   README when the app screens arrive.
3. **Token storage (item 12).** Access and refresh tokens go to `expo-secure-store` only, never
   AsyncStorage, with a test.
