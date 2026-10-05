# ADR-0003: SMS provider

- Status: Accepted (no provider account exists; provider behaviour not verified, see "Not verified")
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

The server sends two kinds of SMS to Turkish GSM numbers (E.164, `+90...`):

1. The login OTP (spec section 3 story 1, section 6 item 11).
2. Reminders to customers who have recorded consent (spec section 3 story 6), limited by a monthly
   quota (Free 30, Pro 500) and a global daily cap (spec section 6 item 22).

The server also needs the provider credit balance for the cost monitor (item 22) and delivery
reports for the `POST /v1/webhooks/sms-dlr` endpoint (item 17). The product spec allows Netgsm or
İleti Merkezi and asks for the choice here.

## Options considered

- Netgsm: Turkish operator-connected provider. Its public developer pages describe official SDKs
  with an OpenAPI description, a dedicated OTP SMS product, report and balance queries, and the
  `msgheader` concept (the registered sender name).
- İleti Merkezi: the same class of provider. Its developer documentation was unreachable on
  2026-10-05, so no comparison on API shape could be made.
- A global provider (not chosen): no direct Turkish operator routing for the sender-name rules and
  no reason to leave the two providers named by the spec.

## Decision

- Netgsm is the primary provider. İleti Merkezi is recorded as the fallback. Its documentation is
  re-checked in Phase 2 before any adapter work; nothing is built for it unless Netgsm becomes
  unavailable to the project.
- The server depends on one interface and never on a provider type:

  ```kotlin
  package app.cetele.server.reminders.sms

  interface SmsGateway {
      fun send(message: SmsMessage): SmsSendResult
      fun balance(): SmsBalance
      fun parseDeliveryReport(rawBody: ByteArray, headers: Map<String, String>): DeliveryReport
  }
  ```

  `SmsMessage`, `SmsSendResult`, `SmsBalance` and `DeliveryReport` are the value types named above.
  Their fields are fixed in Phase 2 and recorded in the OpenAPI document and the phase ADR. They are
  expected to carry the recipient, the text, the kind (OTP or reminder), a provider message id, an
  accepted or error outcome, a credit amount and a delivery status with a time.

- Implementations are selected by `CETELE_SMS_PROVIDER`:
  - `fake` (default): `FakeSmsGateway`, which delivers nothing, keeps messages in memory for tests
    and logs only masked numbers (`+90*******12`, spec section 6 item 14). It is selectable only in
    the `local` and test environments; startup validation that rejects it elsewhere is added with
    the first real adapter.
  - `netgsm`: `NetgsmSmsGateway`, written in Phase 2 against the real provider interface and
    configured with `CETELE_NETGSM_USERNAME`, `CETELE_NETGSM_PASSWORD` and
    `CETELE_NETGSM_MSGHEADER`.
- The delivery-report endpoint verifies an HMAC-SHA256 over the raw body with
  `CETELE_SMS_DLR_SECRET`, a timestamp window and a replay cache (spec section 6 item 17), then
  calls `parseDeliveryReport`. The provider-specific body format stays inside the adapter.
- No account is created and no key exists. The repository holds no real credential.

## Not verified

- Account opening requirements, the approval time and rules for a sender name, per-message prices
  and the daily send limits of either provider.
- The exact delivery-report format and whether the provider can sign it. If it cannot send our
  signature header, the report path changes to the report query of the provider, decided in Phase 4.
- Whether the OTP product is a separate API from the standard SMS API, and its consent rules.
- İleti Merkezi capabilities, on every point above.
- Evidence limit: no SMS was sent and no provider API was called
  (`not exercised: no SMS provider account`). See [ADR-0004](0004-portfolio-delivery-scope.md).

## Consequences

- Tests prove consistency with our own contract through `FakeSmsGateway` and recorded fixtures, not
  behaviour of the live provider.
- Switching provider changes one adapter, its fixtures and the configuration keys, not controllers,
  quota logic or the cost monitor.
- A sender name and an operator-approved OTP route are real-world steps that the repository only
  documents.

## Open points for the owner

- Cost: SMS prices and the initial credit are not known.
- Legal: the consent text and the sender-name registration are legal and operator matters; the
  repository stores `sms_consent`, its date and its source but gives no legal advice.
