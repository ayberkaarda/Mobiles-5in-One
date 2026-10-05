# ADR-0040: Integration tests on the Android emulator

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Unit, widget and golden tests use fakes. The Phase 4 gate also asks for flows that run the real app
against the real API, database, mail catcher, links and WebView. There is no macOS here, so only
Android can run them.

## Decision

- Flows live in `askida/app/integration_test/` and run with `flutter test <file> --flavor dev -d
  emulator-5554` through `run_e2e.sh`. The device is the `Pixel_8` virtual device started headless
  (`-no-window -gpu swiftshader_indirect`); it reaches the host at `10.0.2.2`.
- The server is the local compose stack under a separate project name (`askida-e2e`) with its own
  ports, so it does not share a database volume with any other stack (ADR-0014, lessons). The server
  `.env` points `APP_URL` and the storage public endpoint (`AWS_PUBLIC_ENDPOINT`) at `10.0.2.2` so
  presigned uploads work from the emulator. Stopping the stack uses `stop`, never a volume removal.
- `e2e_flows_test.dart` runs four ordered tests: merchant registration, e-mail verification (the code
  is read from the mail catcher API), shop wizard with a map pin, a document through presign, upload and
  confirm, then waiting for `shops:verify` and a catalog item; donor registration, district list,
  donation of two units through the fake checkout page in the WebView, return link and a paid receipt;
  recipient attestation, district, shop, reservation and code; merchant manual redemption; donor account
  deletion with the old token refused afterwards. A background loop approves pending shops whose
  name matches a pattern through `docker exec ... php artisan shops:verify`.
- Seams overridden in the tests: the token store (in memory, several people on one device), the QR
  scanner (manual entry only) and the media picker (an in-memory image). Everything else is real,
  including HTTP, database, links, WebView and the attestation channel with the dev fallback.
- `app_launch_test.dart` is a one-test launch check. `capture_screenshots.sh` records the release
  screenshots from the same stack.
- **These tests do not run in CI.** The CI app job runs build_runner, the format check, analyze, the
  default `flutter test` and a debug APK build; it has no emulator and no server stack. Device runs are local.

## Consequences

- The flows found two bugs the fake-based suite had missed: the nested `shop` and `item` objects of a
  donation (the app read flat keys) and shop directory reads sent with the wrong token scope
  (ADR-0034). Both were fixed with tests.
- A regression in a flow is not caught until somebody runs the emulator suite by hand.
- The local stack needs a one-time setup and leaves sample shops behind in its own database.

## Not exercised / limits

- Final run on the branch head: all four flows and the launch test passed (`+4: All tests passed!`,
  exit 0 and `+1: All tests passed!`).
- Not exercised: iOS, real Play Integrity, real payments, real push, and the CI execution of these
  flows.
