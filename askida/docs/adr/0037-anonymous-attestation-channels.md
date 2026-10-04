# ADR-0037: Anonymous attestation channels and nonce hashing

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

ADR-0019 defines how the server turns an attested device into an anonymous token. The app has to
produce the attestation on Android (Play Integrity) and iOS (DeviceCheck) and must work in the
development flavor without either service.

## Decision

- **Dart interface.** `AttestationService.attest(deviceNonce)` is implemented by
  `ChannelAttestationService` over a platform channel (`AttestChannel.requestToken({nonce})`).
- **Nonce.** `AnonRepository.attest()` builds `device_nonce` on the device as base64url of 32 random
  bytes without padding (43 characters), passes it unchanged to the channel and sends the same raw
  value as `device_nonce` in `POST anon/attest`. The contract text said "server-issued"; the server
  accepts the device-built value (ADR-0019).
- **Android (Kotlin, `AttestChannel.kt`).** Classic `IntegrityManager.requestIntegrityToken` with
  the Gradle dependency `com.google.android.play:integrity:1.4.0`; no cloud project number and no key
  ship in the app. The Play Integrity request nonce is base64url(SHA-256(UTF-8 bytes of
  `device_nonce`)) with URL-safe, no-wrap, no-padding encoding (43 characters). The server verifier
  must therefore compute the same hash from the received `device_nonce` and compare it with
  `requestDetails.nonce` of the decoded verdict.
- **Error mapping.** `API_NOT_AVAILABLE`, `PLAY_STORE_NOT_FOUND`, `PLAY_SERVICES_NOT_FOUND` and the
  `*_VERSION_OUTDATED` errors map to `unsupported`; network, quota, transient, `CANNOT_BIND`,
  `APP_NOT_INSTALLED`, `APP_UID_MISMATCH`, no Play account and invalid project number map to
  `unavailable`; anything else is `unknown`. Provider messages never cross the channel.
- **iOS (Swift, `AttestChannel.swift`).** `DCDevice.current.isSupported`, then `generateToken`, sent
  as base64. DeviceCheck tokens carry no nonce; the Swift side only requires that one is present, and
  the nonce is sent to the server in the request body.
- **Fallback policy.** Only the dev flavor sends the fixed development token
  (`ChannelAttestationService.devFallbackToken`) and only when the channel reports `unsupported` or
  `unavailable`. The server's fake verifier accepts it outside production (ADR-0021). The prod flavor
  throws `AttestationUnavailable` and the recipient start screen shows a blocking message; browsing
  stays open.
- **Entry.** `/recipient/start?from=<location>` is the anonymous entry that attests; `from` is
  accepted only for `/recipient...` paths other than the start path itself and without scheme or
  authority.

## Consequences

- The value sent to the server (raw `device_nonce`) and the value inside the Play Integrity verdict
  (its SHA-256 hash) differ. A verifier that compares the raw value with the verdict nonce would
  reject every real Android device.
- ADR-0019 says the verifier compares the verdict nonce with `hash_equals` but does not name the form
  of the expected value. The app side is fixed here; whether the server verifier hashes `device_nonce`
  the same way was not checked in Phase 4 and is an open point for the server.
- Real devices need a Play-distributed build and a server-side verifier before the Android path can be
  proven end to end.

## Not exercised / limits

- Real Play Integrity verdicts were not exercised (no Play-distributed build; the local server uses the
  fake verifier, which accepts any token). The emulator run sent whatever the channel answered.
- DeviceCheck was not compiled or run (no macOS); iOS is not verified.
- Evidence: `test/core/attest_channel_test.dart`, `test/core/attestation_service_test.dart`,
  `test/features/recipient/**`.
