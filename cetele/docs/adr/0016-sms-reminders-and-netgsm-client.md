# ADR-0016: SMS reminders and the Netgsm client

- Status: Accepted (provider behaviour not verified, see "Not verified")
- Date: 2026-10-06
- Deciders: Ayberk (owner)
- Supersedes the value-type paragraph and the `parseDeliveryReport` member of
  [ADR-0003](0003-sms-provider.md); the provider choice of ADR-0003 stands.

## Context

Reminders are the one feature that costs money per use and can annoy a customer. They need recorded
consent, a per-shop monthly quota, a global daily cap, and a text that carries a statement link. OTP
codes use the same gateway. ADR-0003 left the value types open for this phase and listed
`parseDeliveryReport` on the interface.

## Decision

### Gateway interface

`app.cetele.server.reminders.sms` holds the interface and its value types:

```kotlin
enum class SmsKind { OTP, REMINDER }
data class SmsMessage(val phoneE164: String, val text: String, val kind: SmsKind)
sealed interface SmsSendResult { Accepted(providerMessageId: String?); Rejected(reason: String); Failed(reason: String) }
data class SmsBalance(val credit: Long?, val currency: String?)
interface SmsGateway { fun send(message: SmsMessage): SmsSendResult; fun balance(): SmsBalance }
```

`parseDeliveryReport` and `DeliveryReport` are not built: `POST webhooks/sms-dlr` stays in Phase 4
(spec item 17) and the interface gains the member then. `reminders.provider_msg_id` is stored now
and has a partial unique index. OTP delivery sends `SmsKind.OTP`; a result that is not `Accepted`
is logged (`outcome=send_failed`) and `otp/request` still answers 202, so the response stays
uniform ([ADR-0005](0005-session-model.md)).

`FakeSmsGateway` stays local and test only: the last 100 messages, `Accepted("fake-<n>")`,
`failNextSend(reason)` for tests and a balance of 1000 credits. `SmsConfiguration` selects it for
`fake` and builds the Netgsm client for `netgsm`. `netgsm` without username, password and sender
name fails startup with `CETELE_SMS_PROVIDER=netgsm needs CETELE_NETGSM_USERNAME, _PASSWORD and _MSGHEADER`;
`fake` under `staging` fails startup too.

- `SmsConfigurationTest`: `netgsm requires every credential with the contract startup message`
- `SmsConfigurationTest`: `fake is refused in staging`
- `SmsConfigurationTest`: `netgsm credentials build the real adapter without contacting the provider`
- `SmsConfigurationTest`: `blank base URL uses the documented host and timeout defaults`

### Netgsm client

- `NetgsmSmsGateway` uses Spring's `RestClient` on the MVC stack. The spec text says `WebClient`;
  that wording is superseded, because pulling in the reactive stack for one blocking call adds a
  second HTTP stack and nothing else.
- Timeouts: 5 seconds to connect, 10 seconds to read (`NetgsmProperties`, bound from
  `cetele.sms.netgsm.*`). The base URL defaults to `https://api.netgsm.com.tr` when
  `CETELE_NETGSM_BASE_URL` is empty.
- There is no retry on send: a duplicated SMS costs money and a provider timeout does not say
  whether the message left. A transport error or a 5xx is `Failed`, a provider rejection code is
  `Rejected(code)`, an accepted message is `Accepted(jobid)`.
  - `NetgsmSmsGatewayTest`: `provider rejection codes are preserved and descriptions cannot leak`
  - `NetgsmSmsGatewayTest`: `HTTP 500 fails without retry`
  - `NetgsmSmsGatewayTest`: `timeout fails without retry`
  - `NetgsmSmsGatewayTest`: `HTTP rejection and malformed provider replies have bounded reasons`
- Credentials are never logged. A send logs the outcome, the provider code and the masked phone
  only (`SmsLogSampleTest`: `provider failures log only outcomes codes and masked phones`).
- `balance()` returns an unknown credit rather than zero when the query fails
  (`NetgsmSmsGatewayTest`: `balance failure stays unknown instead of reporting zero credit`). The
  monitor and the alerts are Phase 6.

### Reminder flow

`POST /v1/shops/{shopId}/reminders` (`REMINDER_SEND`, body
`{customerId, channel: "SMS", template: "BALANCE"}`; `WHATSAPP` and `DUE_TODAY` are 422
`out_of_range`, the `DUE_TODAY` column value is reserved). In order: rate bucket `reminder.user` (30
per 10 minutes), channel and template check, then transaction 1 under the shop row lock: customer
lookup (deleted or foreign is 404), no phone is `409 sms.phone_missing`, no consent is
`409 sms.consent_missing`, balance at or below zero is `409 reminder.no_balance`, the daily cap
reservation, one quota slot reserved, a statement link issued
([ADR-0015](0015-statement-links-and-public-page.md)) and the `reminders` row inserted as `QUEUED`.
The send happens after that commit, outside any transaction. Transaction 2 marks the row `SENT` with
`sent_at` and `provider_msg_id` when the provider accepted it. A definitive provider refusal
(`SmsSendResult.Rejected`) marks the row `FAILED` with `failure_code = sms.provider_failed`, refunds
the monthly quota slot and answers `502 sms.provider_failed`. Any other failure (a timeout, a
transport error, a 5xx, an exception) leaves the outcome unknown, because the provider may have sent
the message: the row is `FAILED` with `failure_code = outcome_unknown`, the monthly slot is **not**
refunded, the row keeps counting toward the daily cap, and the answer is the same 502. The response
on success is 201 `{reminderId, status, sentAt, providerMessageId?, quota: {month, used, limit}}`.
A row left `QUEUED` by a crash between the two transactions stays counted in the daily cap and in
the monthly quota (accepted, see the consequences).

- `ReminderFlowTest`: `accepted reminder stores delivery metadata and sends a usable statement link`
- `ReminderFlowTest`: `eligibility failures have exact codes and no side effects`
- `ReminderFlowTest`: `unknown outcome commits failure, keeps quota used and answers bad gateway`
- `ReminderFlowTest`: `definitive provider rejection refunds quota and stays out of the daily count`
- `ReminderFlowTest`: `link limit rolls back reservation and does not send`

### Quota, daily cap, template

- Only `REMINDER` sends count. FREE has 30 reminders a month and PRO 500
  ([ADR-0014](0014-ledger-model.md) `PlanLimits`). `SmsQuotaService.reserve` runs under the shop's
  advisory lock, loads the month row with `PESSIMISTIC_WRITE` and creates it when absent; at the
  limit it answers `429 sms.quota_exceeded` with `Retry-After` set to the seconds until the next
  month start in `Europe/Istanbul`. Months and days follow Istanbul time, not UTC.
  - `SmsQuotaServiceTest`: `the thirty first FREE reservation is rate limited until the next Istanbul month`
  - `SmsQuotaServiceTest`: `month rollover follows Istanbul midnight rather than UTC`
  - `SmsQuotaServiceTest`: `sixteen threads reserve thirty distinct slots including concurrent first creation`
  - `SmsQuotaServiceTest`: `refund never drops below zero and cannot touch another shop or month`
- The global daily cap (`CETELE_SMS_DAILY_CAP`, default 1000) is an **atomic reservation**. The
  request takes a platform-wide advisory lock (`ShopLocks.smsDailyCap`) inside transaction 1, counts
  the day, and inserts its `QUEUED` row before the lock is released at commit, so concurrent
  requests cannot all pass at cap minus one. The count is by `requested_at` inside the Istanbul day
  and covers `QUEUED`, `SENT`, `DELIVERED`, `UNDELIVERED` and `FAILED` rows with
  `failure_code = outcome_unknown`; a definitively rejected row is not counted. The cap lock is one
  lock for the whole platform, which serialises only the short queueing transaction.
  - `DailyCapTest`: `daily count is global and includes queued, sent and unknown-outcome SMS requested inside the Istanbul day`
  - `DailyCapTest`: `daily cap resets exactly at Istanbul midnight with fractional retry rounding`
  - `ReminderFlowTest`: `concurrent requests at cap minus one produce exactly one send`
  - `ReminderFlowTest`: `unknown outcome keeps counting toward the daily cap`
  - `ReminderFlowTest`: `lowered global daily cap blocks sends across shops`
- The text is `Sayın {customerName}, {shopName} defterinizdeki güncel borcunuz {amount}. Hesap dökümü: {url}`.
  Names are trimmed, stripped of control characters and clipped to 40 characters without splitting
  a surrogate pair (`ReminderTemplatesTest`).

### Consent

The server records and checks consent (`sms_consent`, date, source), it does not judge it: the check
constraint in `V4__ledger.sql` demands evidence next to the flag. The consent wording shown to the
customer is a legal text owned by the shop and the owner of the project
([ADR-0003](0003-sms-provider.md), open points).

## Not verified

- The Netgsm request shape in `NetgsmSmsGateway` (`POST {base}/sms/rest/v2/send` with Basic
  authentication, a JSON body with `msgheader`, `encoding=TR`, `iysfilter=0` and a `messages` list
  of `{msg, no}`; success code `00` with a `jobid`; balance as `POST {base}/balance` with `stip=1`
  summing the SMS package counts) was written from the provider's public developer pages and is
  **not verified against the live API or its current documentation**. Fixtures in
  `NetgsmSmsGatewayTest` are labelled "shape per provider documentation, not verified against the
  live API".
- The error-code table beyond the codes in the tests, the sender-name approval and the prices (as
  in ADR-0003).
- İleti Merkezi: the re-check ADR-0003 asked for in this phase was skipped
  (`skipped: no network use in the implementation pass`); Netgsm stays primary.
- Real delivery: no SMS was sent and no provider API was called
  (`not exercised: no SMS provider account`, [ADR-0004](0004-portfolio-delivery-scope.md) G4).
  Delivery reports: Phase 4.

## Consequences

- A definitive provider refusal costs the user a clear 502 and no quota. An unknown outcome (a
  timeout where the provider may have sent) also answers 502 but keeps the quota slot and the daily
  count: that is the price of no retry, and it errs on the side of not under-counting spend.
- A reminder row left `QUEUED` by a crash between the two transactions stays counted in the monthly
  quota and the daily cap until retention removes it; there is no reconciler. Accepted
  ([threat model](../security/threat-model.md) 4.10).
- Switching provider changes one adapter and its configuration keys, as ADR-0003 intended.
- Evidence: `NetgsmSmsGatewayTest`, `SmsConfigurationTest`, `SmsQuotaServiceTest`, `DailyCapTest`,
  `ReminderTemplatesTest`, `ReminderFlowTest`, `ReminderPermissionTest`, `ReminderLogSampleTest`,
  `SmsLogSampleTest`, `V5ServicesSchemaTest`.
