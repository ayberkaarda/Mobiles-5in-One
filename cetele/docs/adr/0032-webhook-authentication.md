# ADR-0032: Webhook authentication

- Status: Accepted (provider behaviour not verified, see "Not verified")
- Date: 2026-10-11
- Deciders: Ayberk (owner)

## Context

Spec item 17 names two inbound webhooks: `POST /v1/webhooks/play-rtdn` (Google Play Real-time
Developer Notifications through a Pub/Sub push subscription) and `POST /v1/webhooks/sms-dlr` (SMS
delivery reports). Neither caller holds a `/v1` access token. A forged RTDN could try to grant Pro
([threat model](../security/threat-model.md) 4.9); a forged delivery report could falsify reminder
history. Both must answer fast and process later. The
[authorization matrix](../security/authorization-matrix.md) section 3 reserved a 401 code for a bad
webhook credential "appended in Phase 4".

Neither Google nor an SMS provider can call this project ([ADR-0004](0004-portfolio-delivery-scope.md)
G2, G4), so both checks are proven with locally made keys and secrets.

## Decision

### Shared rules

- Each webhook has its **own** `SecurityFilterChain` with a `securityMatcher` on its exact path,
  declared in the owning package: `@Order(20)` for `/v1/webhooks/play-rtdn` (package
  `app.cetele.server.billing.webhook`) and `@Order(21)` for `/v1/webhooks/sms-dlr` (package
  `app.cetele.server.reminders.delivery`). The existing API chain has no order and no matcher and
  stays last; `SecurityConfig.kt` is not edited. Each webhook chain is stateless, permits its path,
  has CSRF, form login, HTTP Basic, logout and the request cache off, applies
  `SecurityHeadersConfig.apply(http)` and the `CspNonceFilter`, and keeps the HTTPS rule of
  [ADR-0010](0010-security-headers-csp-and-https.md). It does not run `JwtAuthenticationFilter`.
- The controller takes `HttpServletRequest` only (no `@RequestBody`, no `@RequestHeader`), reads the
  raw body itself with a hard cap (64 KiB for RTDN, 8 KiB for DLR; above it `413 payload_too_large`
  before any check), verifies the credential on the raw bytes, and only then parses JSON. It returns
  `ResponseEntity<Void>`.
- A failed credential of any kind is `401 webhook.unauthenticated` with the generic body of
  [ADR-0008](0008-problem-details-and-error-codes.md): no `detail`, no hint about which check
  failed. The reason goes to the masked log as `outcome=<reason>`.
- Accepted, duplicate and ignored deliveries all answer `200` with an empty body. Processing happens
  after the response from a stored row ([ADR-0031](0031-billing-purchase-linking-and-entitlements.md)
  for RTDN, below for DLR).
- Client addresses come from `ClientIp.of(request)` after the trusted proxy rewrite
  ([ADR-0009](0009-rate-limiting-and-client-ip.md)).

New `ProblemCode` entry: `webhook.unauthenticated`, 401, title `Webhook authentication failed`.

New `RateLimit` entries: `WEBHOOK_RTDN_IP("webhook.rtdn.ip", 600, 1 minute)` and
`WEBHOOK_DLR_IP("webhook.dlr.ip", 300, 1 minute)`, charged before the credential check so a flood of
bad signatures is bounded too.

### `POST /v1/webhooks/play-rtdn`

Request (Pub/Sub push, JSON):

```
Authorization: Bearer <Google-signed OIDC JWT>
Content-Type: application/json

{"message":{"data":"<base64 DeveloperNotification>","messageId":"136969346945","publishTime":"2026-10-11T09:30:00.000Z","attributes":{}},"subscription":"projects/<project>/subscriptions/<name>"}
```

Order of checks:

1. Rate bucket, size cap.
2. `Authorization` present, scheme `Bearer`, token at most 4096 characters.
3. JWT verified with Nimbus against an injectable `RtdnKeySource` (a Nimbus
   `JWKSource<SecurityContext>`):
   - header `alg` exactly `RS256` (`none`, `HS*`, `ES*` and anything else refused), `kid` required
     and present in the key set;
   - `iss` is `https://accounts.google.com` or `accounts.google.com`;
   - `aud` equals the expected audience exactly (a list must contain exactly that one value);
   - `email` equals the expected service-account email exactly and `email_verified` is `true`;
   - `exp` later than now minus 30 seconds, `iat` not later than now plus 30 seconds.
4. JSON parse of the envelope. `message.messageId` (or `message.message_id`) 1 to 128 characters.
   An envelope that verifies but cannot be parsed is answered `200` and logged
   `outcome=malformed`, because a non-2xx answer would make Pub/Sub redeliver it for days.
5. Decode `message.data`; keep `packageName`, `eventTimeMillis`, the notification kind, its
   `notificationType` and `purchaseToken`. The token is hashed and encrypted at once
   (ADR-0031); the clear text is not kept after the insert.
6. Insert `webhook_events` (`provider = PLAY_RTDN`, `event_id = messageId`, `status = RECEIVED`).
   A unique violation on `(provider, event_id)` is a duplicate: `200`, nothing else happens.
7. `200`; processing starts after commit.

The notification body is never trusted for state: processing always re-reads the purchase through
the Play Developer API (ADR-0031). A replayed old message is stopped by `exp` and by the
`messageId` row, and even a new message cannot do more than make the server ask Play again.

Key sources:

- `play` mode: `RemoteRtdnKeySource` on `CETELE_PLAY_RTDN_JWKS_URL` (default
  `https://www.googleapis.com/oauth2/v3/certs`), cached for one hour, refreshed on an unknown `kid`
  at most once per minute, 5-second fetch timeout. No key available: `503 billing.unavailable`, so
  Pub/Sub retries.
- `fake` mode: `LocalRtdnSigner` (stand-in `fake-rtdn-signer`), an RSA 2048 key pair made at start,
  `kid = local-rtdn-1`, that tests and a developer use to sign push tokens. It is refused outside
  `local` and `test` by `LocalOnlyAdapterGuard`.

Expected values:

| Key                                      | Property                                 | Default                                                                  |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `CETELE_PLAY_RTDN_AUDIENCE`              | `cetele.play.rtdn.audience`              | empty: `<CETELE_PUBLIC_BASE_URL>/v1/webhooks/play-rtdn`                  |
| `CETELE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` | `cetele.play.rtdn.service-account-email` | empty: refused in `play` mode; `rtdn-push@cetele.invalid` in `fake` mode |
| `CETELE_PLAY_RTDN_JWKS_URL`              | `cetele.play.rtdn.jwks-url`              | `https://www.googleapis.com/oauth2/v3/certs`                             |

### `POST /v1/webhooks/sms-dlr`

Netgsm's own delivery-report callback carries no signature that this project could check, so the
endpoint accepts a **signed envelope of our own**: a provider that can sign (or a small relay next
to the provider) sends it. One report per request.

```
Content-Type: application/json
X-Cetele-Timestamp: 1791711000
X-Cetele-Signature: v1=b536397b04034ffcedb4bcd6837bea033bdc952b28ec2358a8c824c83d799d3f

{"providerMessageId":"fake-17","status":"DELIVERED","occurredAt":"2026-10-11T09:30:00Z"}
```

- `X-Cetele-Timestamp`: Unix seconds, 1 to 12 ASCII digits.
- `X-Cetele-Signature`: `v1=` followed by 64 lowercase hex characters of
  `HMAC-SHA256(secret, ASCII(timestamp) || "." || rawBody)`. Signing the timestamp with the body
  stops a replayer from refreshing it. The comparison is constant time.
- The line above is the **test vector**: secret `local-dlr-secret-not-for-production` (UTF-8),
  timestamp `1791711000` (2026-10-11T09:30:00Z), and the body exactly as shown (88 bytes, no
  trailing newline). It is a documented local dummy, never a deployment value.
- Body fields: `providerMessageId` 1 to 64 characters `^[A-Za-z0-9_.:-]+$` (the value stored in
  `reminders.provider_msg_id`); `status` `DELIVERED` or `UNDELIVERED`; `occurredAt` an ISO-8601
  instant not more than five minutes in the future; optional `errorCode` 1 to 32 characters
  `^[A-Za-z0-9_.-]+$`. Unknown properties are refused.

Order of checks:

1. IP allowlist when `CETELE_SMS_DLR_ALLOWED_IPS` is set (comma-separated addresses or CIDR
   blocks, IPv4 and IPv6): another address is `401`. Empty means no address check (defence in
   depth only; the signature is the control).
2. Rate bucket, size cap (8 KiB).
3. Both headers present and well-formed; `|now - timestamp| <= 300` seconds.
4. HMAC with `CETELE_SMS_DLR_SECRET`, then with `CETELE_SMS_DLR_PREVIOUS_SECRET` when set (for
   rotation). An empty current secret means the endpoint is not configured: every request is `401`
   with `outcome=not_configured`. A secret shorter than 32 bytes fails startup.
5. Parse and validate; a signed but invalid body is `422 validation.failed` (the sender is
   authenticated, so the field codes may be returned).
6. Replay cache: a Caffeine cache of `providerMessageId` values, 10 minutes, 100 000 entries. A hit
   is `200` with no work. The durable replay guard is the unique `provider_msg_id` of
   `sms_delivery_reports`; a unique violation is also `200` with no work.
7. Insert `sms_delivery_reports` (`processing = RECEIVED`), `200`.

`sms_delivery_reports` (`V7__sms_delivery_reports.sql`):

```sql
CREATE TABLE sms_delivery_reports (
    id UUID PRIMARY KEY,
    provider_msg_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processing TEXT NOT NULL DEFAULT 'RECEIVED',
    outcome TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    processed_at TIMESTAMPTZ,
    CONSTRAINT sms_delivery_reports_provider_msg_id_key UNIQUE (provider_msg_id),
    CONSTRAINT sms_delivery_reports_provider_msg_id_format CHECK (provider_msg_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
    CONSTRAINT sms_delivery_reports_status_check CHECK (status IN ('DELIVERED', 'UNDELIVERED')),
    CONSTRAINT sms_delivery_reports_error_code_format CHECK (error_code IS NULL OR error_code ~ '^[A-Za-z0-9_.-]{1,32}$'),
    CONSTRAINT sms_delivery_reports_processing_check CHECK (processing IN ('RECEIVED', 'APPLIED', 'IGNORED', 'FAILED')),
    CONSTRAINT sms_delivery_reports_outcome_length CHECK (outcome IS NULL OR char_length(outcome) <= 64),
    CONSTRAINT sms_delivery_reports_attempts_nonnegative CHECK (attempts >= 0)
);
CREATE INDEX sms_delivery_reports_pending_idx ON sms_delivery_reports (received_at) WHERE processing = 'RECEIVED';
```

The table has no `shop_id`, no phone and no text, so shop and account deletion leave it alone;
retention deletes rows older than 90 days. The spec's generic `webhook_events` table is used by RTDN
only: a delivery report has a different idempotency key and retention, and a separate table lets
the two webhooks be built and migrated independently.

Processing (`DeliveryReportProcessor`, after commit and every 30 seconds under `JobLocks` lock
`sms.dlr`, behind `CETELE_JOBS_ENABLED`):

- The reminder is found through a `ReminderDeliveryIndex` (JPQL on the `EntityManager`, the
  `StatementLinkIndex` pattern) that returns `(shopId, reminderId)` for the `provider_msg_id`; the
  update then goes through a tenant repository method that takes `shopId`.
- A row `SENT`, or `FAILED` with `failure_code = outcome_unknown` (the provider did send after
  all), becomes `DELIVERED` with `delivered_at = occurredAt`, or `UNDELIVERED` with
  `failure_code = "dlr." + errorCode` (or `dlr.undelivered` without a code). `APPLIED`.
- An unknown id, a row already `DELIVERED` or `UNDELIVERED`, or any other state: `IGNORED` with an
  outcome (`unknown_message`, `already_final`, `not_sent`).
- Quota and the daily cap are not touched: a report changes history, not spend.
- `SmsGateway` keeps its Phase 2 interface; the `parseDeliveryReport` member mentioned in
  [ADR-0016](0016-sms-reminders-and-netgsm-client.md) is not added, because the envelope is ours.

Configuration:

| Key                              | Property                         | Default |
| -------------------------------- | -------------------------------- | ------- |
| `CETELE_SMS_DLR_SECRET`          | `cetele.sms.dlr.secret`          | empty   |
| `CETELE_SMS_DLR_PREVIOUS_SECRET` | `cetele.sms.dlr.previous-secret` | empty   |
| `CETELE_SMS_DLR_ALLOWED_IPS`     | `cetele.sms.dlr.allowed-ips`     | empty   |

## Not verified

- Google's push token claims, issuers, JWKS location and Pub/Sub retry behaviour were written from
  Google's public documentation; no Google-signed token was ever checked
  (`not exercised: no Google Cloud project`, ADR-0004 G2).
- Whether Netgsm (or another provider) can send the signed envelope directly or needs a relay is
  open; no real delivery report was received (`not exercised: no SMS provider account`, G4).

## Consequences

- Required tests: `PlayRtdnWebhookTest` (`missing bearer is 401`, `alg none and hs256 are 401`,
  `unknown kid is 401`, `wrong issuer audience or email is 401`, `unverified email is 401`,
  `expired token is 401`, `valid push is stored and answered 200`, `replayed message id is 200 and
stored once`, `malformed envelope after a valid token is 200 and not stored`, `oversize body is
413`, `failure bodies are identical`); `SmsDlrWebhookTest` (`test vector of the adr verifies`,
  `bad hmac is 401`, `stale and future timestamps are 401`, `missing headers are 401`,
  `previous secret verifies during rotation`, `address outside the allowlist is 401`,
  `replayed provider message id is 200 and applied once`, `invalid signed body is 422`,
  `empty secret answers 401`); `DeliveryReportProcessorTest`; `V7SmsDeliverySchemaTest`;
  `WebhookChainTest` (security headers present, no session cookie, the API chain still answers
  401 for other paths).
- A secret leak at the SMS side lets an attacker mark reminders delivered, nothing more; rotation
  uses the previous-secret slot without downtime.
- One process keeps the replay cache; a restart empties it and the unique index closes the gap.
