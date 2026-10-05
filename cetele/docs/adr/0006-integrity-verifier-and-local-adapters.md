# ADR-0006: Integrity verifier and local-only adapters

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec section 6 item 5 requires a Play Integrity token on `POST /v1/auth/otp/request`, so scripts
cannot pump SMS. The real verdict needs a Play Console project, a service account and a signed
build, none of which exist in this portfolio project ([ADR-0004](0004-portfolio-delivery-scope.md)
G3). The environment table of the earlier phase bound the Play settings to Phase 4. Phase 1 still
has to deliver the request path, so the verifier is an interface with a fake in Phase 1 and the
Google client in Phase 4.

## Decision

### Interface and policy

- `IntegrityVerifier` returns an `IntegrityVerdict`; `IntegrityPolicy` decides. The policy accepts
  a request only when the package name equals `CETELE_PLAY_PACKAGE_NAME` (default
  `app.cetele.android`), the app is recognised by Play, the device meets
  `MEETS_DEVICE_INTEGRITY`, and the request hash equals the nonce of the call.
- The nonce is `base64url_nopad(SHA-256(UTF-8(phone + deviceId)))`, with the device id in its
  canonical lowercase UUID text. The Android app (Phase 3) must send exactly this value as the
  request hash. The comparison is constant time.
- Responses: no token or a blank token is `403 auth.integrity_required`. An undecodable token, a
  token longer than 16 KiB, a refused verdict or a nonce mismatch is `403 auth.integrity_invalid`.
  Neither response says which check failed; the outcome and a short reason go to the masked log
  only.

### Fake verifier

`FakeIntegrityVerifier` understands exactly four tokens:

| Token                      | Verdict                       |
| -------------------------- | ----------------------------- |
| `fake.ok`                  | accepted                      |
| `fake.unrecognized-app`    | refused: app not recognised   |
| `fake.no-device-integrity` | refused: no device integrity  |
| `fake.package-mismatch`    | refused: package name differs |

Anything else (`fake.OK`, a trailing space, a real-looking token) is invalid. The same grammar is
used by the Phase 3 debug app.

### `CETELE_INTEGRITY_MODE`

`fake` or `play`. An empty value means `fake` in `local` and `test` and a startup error elsewhere.
`play` fails at startup with a message that the client is not part of this build; the Google client
(`PlayIntegrityVerifier`, service account, `decodeIntegrityToken`) and
`CETELE_PLAY_SERVICE_ACCOUNT_JSON` arrive in Phase 4.

### Local-only guard

One object, `LocalOnlyAdapterGuard` in the `config` package, gates every stand-in:

| Adapter name              | What it is                                         |
| ------------------------- | -------------------------------------------------- |
| `fake-integrity-verifier` | `CETELE_INTEGRITY_MODE=fake`                       |
| `fake-sms-gateway`        | `CETELE_SMS_PROVIDER=fake`                         |
| `random-otp-pepper`       | empty `CETELE_OTP_PEPPER`, random pepper per start |
| `otp-local-echo`          | `CETELE_OTP_LOCAL_ECHO=true`                       |
| `ephemeral-jwt-keys`      | empty JWT key pair, ephemeral P-256 pair per start |

A stand-in is allowed only when the active profiles contain `local` or `test`. Otherwise the
context fails with `fake adapter <name> is not allowed in profiles [...]`. Two kinds of test are
required and exist: a pure-function test of `LocalOnlyAdapterGuard.check` and an
`ApplicationContextRunner` test that starts the integrity configuration with mode `fake` in profile
`staging` and asserts `context.hasFailed()` with that message (`IntegrityGuardTest`).

### SMS and OTP echo

- OTP delivery goes through `SmsGateway`, the contract of [ADR-0003](0003-sms-provider.md).
  `CETELE_SMS_PROVIDER=fake` is bound in Phase 1: `FakeSmsGateway` sends nothing, keeps the last
  100 messages in memory for tests and logs the masked number. `netgsm` fails at startup in this
  build and is written in Phase 2.
- `CETELE_OTP_LOCAL_ECHO=true` writes the message text once to the logger `LOCAL_ECHO` so a
  developer can read the code. Default off, guarded as above. The Turkish word "kod" is not a
  masking trigger ([ADR-0011](0011-structured-logging-and-masking.md)), so the line stays readable
  in the local log; this is intended and local only. Only the guard of the echo is tested; its
  output end to end is `not exercised`.

## Consequences

- Until Phase 2 adds the real SMS adapter, a profile other than `local` or `test` cannot start:
  the fake SMS gateway is refused there and `netgsm` is not built. This is stated rather than
  hidden; the compose stack runs profile `local`.
- Everything the verifier proves is consistency with our own policy and the fake grammar. No Play
  Integrity verdict was ever requested from Google (`not exercised: no Play Console account`).
  Items 5 and 12 of the [verification matrix](../security/verification-matrix.md) are `partial`
  for that reason.
- Evidence: `IntegrityGuardTest` (guard function, `staging` context failure, explicit mode outside
  local and test, the fake starting in `local` and `test`, the other stand-ins, the policy) and
  `OtpRequestTest`.
