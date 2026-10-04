# ADR-0019: Anonymous attestation and device tokens

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Recipients have no account (specification section 0 item 6). To limit abuse without identifying
anyone, the server issues a token only to a device that passed a platform attestation, and stores
nothing about the device beyond an identifier, a verdict and counters (rules AN-3, AN-6).

## Decision

### Attestation

- `POST anon/attest` (guest, limiter `anon-attest`: 3 per day per hash of device nonce and address)
  takes `platform` (`android|ios`), `token` (at most 8192 characters) and `device_nonce`
  (`^[A-Za-z0-9_-]{16,128}$`).
- Verification goes through the `AttestationVerifier` interface. Adapters:
  `PlayIntegrityVerifier` (service-account assertion, decoded verdict, package name, nonce compared
  with `hash_equals`, timestamp within 600 s, recognised app and device integrity required) and
  `DeviceCheckVerifier` (ES256 JWT, development or production endpoint; DeviceCheck carries no
  nonce). Endpoints are HTTPS only with a 5 s timeout; keys come only from configuration.
- `FakeAttestationVerifier` is bound only when `ATTESTATION_DRIVER=fake`, which the application
  refuses outside `local` and `testing` (ADR-0021). Outcomes: rejected verdict is 401
  `auth.token_invalid`, provider unavailable or not configured is 503 `service_unavailable`, a banned
  device is 403 `forbidden` and is refused before the provider is called.

### Identity and storage

- `anon_id` is a UUIDv7. The mapping from the keyed hash of platform and nonce to
  `{anon_id, verdict, attested_at}` lives in the cache for 30 days; neither the nonce nor its hash is
  written to the database. The same install keeps its `anon_id`, so caps and bans stick across
  re-attestation.
- `anon_devices` and `anon_daily_counters` hold no personal column (checked by an exact-column test).
  The response of `anon/attest` does not contain the `anon_id`.

### Token

A Sanctum token whose tokenable is the `AnonDevice`, name `anon-device`, ability `anon`, expiry 30
days, one active token per device (issuing deletes older ones). Sanctum's own validity flag is false
for these tokens because the guard's provider is `users`, so `AnonTokenRule` re-checks expiry and
accepts a device token only when the device is not banned, its abilities equal exactly `['anon']`
and the route admits `anon` through `ability:` (any-of) or `abilities:` (all-of, anon alone)
middleware. Every other route answers 401 `auth.unauthenticated`. The device principal has a null
identifier, so access logs never attribute a request to a device.

### Deletion and retention

`DELETE anon/me` runs in one transaction: it releases the device's `RESERVED` units to `AVAILABLE`,
deletes its tokens, counters and device row (redeemed units lose the link by foreign key), then
forgets the cache mapping. The response is 204. A reinstall gets a new `anon_id`; the residual risk
is that resetting data also resets that day's caps, bounded by the attest limiter. Job
`anon.purge-old` (daily 03:15 Europe/Istanbul) deletes counters older than 30 days and clears
`anon_id` from redeemed and expired units older than 30 days. Device rows are not purged yet.

## Consequences

- Farming with many real devices is not stopped by these controls (threat model 4.3).
- Evidence: unit and feature tests over `Http::fake` fixtures with keys made at run time. Not
  exercised: Play Integrity and DeviceCheck against real provider accounts (no account, ADR-0006).
  iOS attestation was never compiled or run here (no macOS).
