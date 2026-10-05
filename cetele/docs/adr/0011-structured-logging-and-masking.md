# ADR-0011: Structured logging and masking

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec section 6 item 14: logs must never contain a phone number, a verification code or a token,
and error reports are scrubbed. Masking at the log call site depends on every author remembering;
masking in the pipeline does not.

## Decision

### Output

- Profile `local`: one plain line per event (`logback-spring.xml`), the whole rendered line,
  including the stack trace, passes through the `%mask(...)` converter. The `traceId` from the log
  context is in every line.
- Every other profile: Elastic Common Schema JSON through Spring Boot structured logging
  (`logging.structured.format.console=ecs`). `MaskingJsonMembersCustomizer`, registered as
  `logging.structured.json.customizer`, masks every string member: message, log context, key-value
  pairs and stack trace.

### Masking rules (`Masking.mask`)

| Input                                                             | Output                                |
| ----------------------------------------------------------------- | ------------------------------------- |
| Turkish phone (`+90...`, `90...`, `05...`) and other E.164        | `+90*******12` (last two digits kept) |
| 4 to 8 digits after a word containing `code` or `otp`             | `******`                              |
| `Authorization`, `Cookie`, `Set-Cookie` values                    | `***`                                 |
| JWT                                                               | `***`                                 |
| base64url runs of 32 or more characters mixing letters and digits | `***`                                 |

UUIDs and plain identifiers are kept so logs stay useful. The Turkish word "kod" is not a trigger,
which keeps the local-echo line readable in `local`
([ADR-0006](0006-integrity-verifier-and-local-adapters.md)).

### What is logged

- Request and response bodies are never logged.
- The auth endpoints log only outcomes: `traceId`, masked phone, outcome and a small reason or
  count (attempts, limit name, rejection reason). Never the code, a token or the full phone. A
  sample from `AuthLogSampleTest`: `OTP request phone=+90*******40 outcome=sent`,
  `OTP check outcome=mismatch attempts=1`, `Refresh outcome=reuse_detected family_revoked=true`.
- Unhandled exceptions are logged once with their stack, masked, and answered with the generic
  `server_error` body ([ADR-0008](0008-problem-details-and-error-codes.md)).

## Consequences

- Masking is pattern based. A secret in a shape the rules do not know (a short token, a password
  in free text) would pass. The rules are tested; the guarantee is as strong as the tests.
- Evidence: `LoggingTest` (each rule, the plain converter, the structured output over message,
  context, key-value pairs and stack trace, trace id on request logs), `AuthLogSampleTest` (the
  full OTP flow including refresh reuse and logout under output capture: no phone in three forms,
  no code, no wrong code, no access token, no refresh token of either generation).
- Not exercised: Sentry scrubbing (`not exercised: no Sentry project`,
  [ADR-0004](0004-portfolio-delivery-scope.md) G9) and the Android side of item 14 (Phase 3).
  The `CETELE_OTP_LOCAL_ECHO` output itself was not run end to end.
