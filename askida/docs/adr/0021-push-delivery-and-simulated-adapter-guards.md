# ADR-0021: Push delivery and simulated adapter guards

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

ADR-0004 fixed the policy: a `PushTransport` interface, a real adapter and a local simulated one that
configuration rejects elsewhere. Phase 2 implements the delivery path and the first two
notifications. No push provider account exists (ADR-0006).

## Decision

### Tokens

`PUT me/push-token` (donor or merchant token) takes `platform` (`android|ios`) and `token` (1..4096
printable characters, no spaces); the answer is an empty 204. The token value is globally unique,
so a token registered by a second account moves to that account. At most 10 per user; the least
recently registered is dropped. Anonymous devices register no push token. Request bodies are never
logged and context keys named `token` are masked (ADR-0012).

### Delivery

- Jobs run on the queue named by `askida.push.queue` (`push`). Horizon's default supervisor consumes
  `default`, `push` and `payments`; a test asserts the push queue is consumed.
- `SendPush(userId, PushMessage)` reads the user's tokens at send time; tokens are never in a job
  payload. A global cap `PUSH_HOURLY_FANOUT_CAP` (rate limiter) drops deliveries above it with a
  warning.
- `HookRedeemed` (ids only, after commit) triggers a queued listener that sends the donor
  "Askın alındı" with data `item` and `shop` only: no code, hook id, time, staff name or anon data.
  Nothing is sent for anonymised donations.
- `HooksIssued` triggers "Yeni askı" to the shop's owner and staff with data `item` and `count`.
- `LogPushTransport` writes platform, title, body and data to the masked log and never the token.
  There is no FCM or APNs transport yet: any other `PUSH_DRIVER` fails when resolved.

### Guards

Outside `local` and `testing` the provider boot throws on an empty or short `HOOK_CODE_PEPPER`,
`ATTESTATION_DRIVER` other than `real`, or `PUSH_DRIVER=log`. The same pattern applies to the
payment provider `fake` (ADR-0002).

Deviation from the first plan: `local` is tolerated, not only `testing`, because `.env.example`
carries a usable pepper and the container start script runs `artisan` on a fresh `.env`; a boot
failure there would break every fresh checkout. An empty pepper in `local` makes the hasher throw on
first use (fail closed). The example pepper is a plain-word dummy that is at least 32 characters
long, so the length guard would accept it if copied to production; refusing that exact value outside
local is a suggestion, not built.

## Consequences

- A production boot with simulated adapters is impossible by configuration, but real push delivery
  cannot run until an FCM or APNs transport is written.
- Not exercised: delivery to a real device or provider (no account, ADR-0006). The recorded
  transport in tests proves payload shape and counts only.
