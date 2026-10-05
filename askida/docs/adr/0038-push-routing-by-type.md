# ADR-0038: Push routing by the server's `type`

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

ADR-0004 keeps Firebase optional and ADR-0021 defines the push payloads the server sends. An opened
notification must land on the right screen without the payload carrying anything about a recipient.

## Options considered

1. Route by the notification title or by guessing from data keys: works with any server, breaks when
   copy changes or when a title is translated.
2. Route by an explicit `type` and ids in the data map: needs the server to send them.

## Decision

- Option 2. `pushKindOf` (`lib/core/push/push_message.dart`) reads only `data.type`:
  - `hooks.issued` opens `/merchant/redemptions` (the redemptions list of the current shop).
  - `hook.redeemed` opens `/donor/donation/<donation_id>` when `donation_id` is a UUID, otherwise
    `/donor/donations`.
- Untyped payloads open nothing. Title and key heuristics were removed once the server sent `type`.
- Ids are validated as UUIDs before they reach a path, so values such as `../../admin` or a UUID with a
  suffix never become a location.
- The data map is flat; values such as `count` arrive as strings.
- `PushService {init(), token, onMessage}` is the seam. `NoopPushService` is the default because no
  Firebase configuration ships in the repository (ADR-0004). `AppBootstrap` starts the service,
  registers the token through `PushRepository` once per signed-in account when a token exists, and
  routes opened notifications with `openPush`.
- The payload holds no recipient data (checked by the routing tests).
- The `shop_id` of `hooks.issued` is not used yet: the merchant lands on the current shop (ADR-0041).

## Consequences

- Renaming or translating push copy cannot break routing.
- A new push type needs a server enum value and an app mapping together.

## Not exercised / limits

- FCM and APNs were not exercised (Noop service, fake service in tests). The `hooks.issued` push was
  not observable in the emulator run (the server pushed to the log driver and the device had no push
  token).
- Evidence: `test/core/push_and_seams_test.dart` and the push wiring tests, which use the OpenAPI
  example payloads.
