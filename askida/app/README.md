# Askıda app

Flutter app for donors, merchants and anonymous recipients (flavors `dev` and `prod`; Turkish first, English second).

Setup: `bash tool/codegen.sh` (pub get + build_runner; freezed/json/drift sources are built locally, never committed), then copy `env/example.json` to `env/dev.json` (only key: `API_BASE_URL`).
Checks (after codegen): `flutter analyze` · `flutter test` · `dart format --set-exit-if-changed .`
Android build: `flutter build apk --debug --flavor dev --dart-define-from-file=env/example.json` (iOS needs macOS and is not built here).

## Structure

Feature-first: `lib/features/<feature>/{data,domain,presentation}`; shared code in `lib/core` (HTTP client, storage, push, attestation, errors, links), `lib/data` (models, repositories, providers, session), `lib/design` and `lib/routing`. State is hand-written Riverpod; navigation is go_router with prefix-based guards. Decisions: ADR-0033 to ADR-0042 in `docs/adr/` (architecture, API client and offline cache, token storage, map tiles and coarse location, attestation, push routing, mode shell, emulator tests, merchant shop discovery, WebView checkout).

## Device tests (Android emulator, local only)

`integration_test/` runs the register, shop, donation, reservation, redemption and deletion flows against the local compose stack (project `askida-e2e`, see ADR-0040): `bash integration_test/run_e2e.sh` with the `Pixel_8` emulator running and the stack up. `bash integration_test/capture_screenshots.sh` records the release screenshots in `../docs/release/screenshots/`. These tests do not run in CI. iOS is not built or verified here.

## Open questions

Not decided; none of these is worked around in code.

1. Shop directory and first visit: `GET shops` needs a token (donor, merchant or anonymous device), but a recipient attests only at the first reservation, so on a fresh device the nearby list is empty (it shows cached rows only, and there are none). Options: attest during onboarding before the list is requested, or open the directory to anonymous callers on the server. The emulator flow attests first through `/recipient/start`. The same holds for a signed-out donor without an anonymous token.
2. Several shops: a merchant who belongs to more than one shop always lands on the first owned shop (otherwise the first listed). There is no shop picker, and the `shop_id` of the `hooks.issued` push is not used to switch shops.
3. Staff join: the server has no staff-join endpoint and membership is created server-side only. How a staff member is added is not documented, so the "Yenile" (refresh) copy on the no-shop screen cannot point to a documented step.
4. Emulator flows are not run in CI: the CI app job has no emulator and no server stack, so a regression in the device flows is found only when someone runs them locally.
