# Cost alerts

Spec section 6 item 22. This page lists every running cost of a Çetele deployment, the threshold at
which someone must act, who is told and how, and whether the check is automated in the server or
is a documented manual check. Hosting follows [ADR-0002](../adr/0002-hosting.md) (one VPS, Docker
Compose, self-hosted PostgreSQL, Cloudflare R2); the SMS provider is Netgsm
([ADR-0003](../adr/0003-sms-provider.md), [ADR-0016](../adr/0016-sms-reminders-and-netgsm-client.md)).

Evidence limit ([ADR-0004](../adr/0004-portfolio-delivery-scope.md) G4, G5): there is no hosting,
R2, Netgsm, Resend or Play account. The automated SMS balance check is exercised against fakes and
recorded HTTP fixtures only; every provider price and quota below is taken from the provider's
public documentation and is `not exercised: no provider account`. Thresholds are the values the
owner starts with; change them here and in the environment together.

## Who is notified

| Channel         | Recipient                                                                 | Used by                                     |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| Alert mail      | the addresses in `CETELE_ALERT_EMAIL_TO` (the owner; at most 50 addresses) | `SmsBalanceMonitor`                         |
| Server log      | `WARN SMS balance alert rule=...`, `ERROR ... alert mail outcome=failed`  | `SmsBalanceMonitor`, read with the host log |
| Provider mail   | the account email of the provider console                                  | the manual checks below, where available    |
| Monthly review  | the owner, first working day of the month, with this page as checklist    | every manual check                          |

Alert mail goes out through the `AlertMailer` port: `resend` (Resend `POST /emails`, key in
`CETELE_RESEND_API_KEY`, never logged) in a deployment, `fake` (kept in memory) in `local` and
`test`. A deployment without `CETELE_ALERT_MAILER` does not start. Mail and log carry counts and
thresholds only: no phone number, no name, no recipient address.

## Summary

| Cost                    | Threshold                                                                     | Check                                            | Automated |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| SMS provider balance    | credit below 500 messages, or below 20 % of the last top-up, or unreadable   | `SmsBalanceMonitor`, daily 09:00 Europe/Istanbul | yes       |
| SMS spend per shop      | FREE 30, PRO 500 reminder SMS per Istanbul month                              | hard cap at queueing (`429 sms.quota_exceeded`)  | yes (cap) |
| SMS spend, all shops    | 1000 reminder SMS per Istanbul day (`CETELE_SMS_DAILY_CAP`)                   | hard cap at queueing (`429 sms.daily_cap_reached`) | yes (cap) |
| Photo uploads per shop  | FREE 200, PRO 2000 presigned uploads per Istanbul month, 1.2 MB each          | hard cap at presign (`409 plan.photo_limit`)     | yes (cap) |
| Hosting budget          | 40 EUR per month in total; act at 32 EUR (80 %)                               | invoices of VPS, R2, mail and SMS                | no        |
| Database size           | 5 GB database, or the VPS disk above 70 % (act) and 85 % (urgent)             | SQL and `df` on the host, weekly                 | no        |
| Object storage size     | 8 GB in the media bucket (80 % of the 10 GB R2 free tier)                     | R2 dashboard, monthly                            | no        |
| Object storage requests | 800,000 Class A or 8,000,000 Class B operations in a month (80 % of free tier) | R2 dashboard, monthly                            | no        |
| Play Integrity quota    | 7,000 requests per day (70 % of the 10,000 default)                           | Google Cloud console quota page, weekly          | no        |
| Alert mail quota        | more than 50 alert mails in a day (Resend free tier 100 per day)              | Resend dashboard, monthly                        | no        |

## SMS provider balance (automated)

`SmsBalanceMonitor` (`server/.../monitoring/`) runs at 09:00 Europe/Istanbul every day, under the
database job lock `sms-balance-monitor` and behind `CETELE_JOBS_ENABLED`, like the other sweepers.
It reads the credit through the `SmsBalanceProvider` port: the Netgsm adapter when
`CETELE_SMS_PROVIDER=netgsm` (`POST /balance`, `stip=1`, the sum of the `Adet SMS` packages; the
request shape follows the Netgsm documentation and is not verified against the live API), the fake
otherwise (local and test only).

Rules, each raised at most once per Istanbul day and again on the next day while it holds:

| Rule                 | Condition                                                                     | Key                                                                 |
| -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `below_minimum`      | credit < `CETELE_SMS_BALANCE_MIN_CREDIT` (default 500; 0 turns it off)        | `cetele.monitoring.sms-balance.min-credit`                          |
| `below_top_up_share` | credit < `CETELE_SMS_BALANCE_TOP_UP_PERCENT` (default 20) % of the last top-up | `cetele.monitoring.sms-balance.top-up-percent`, `.last-top-up`      |
| `unknown`            | the provider answer could not be read (HTTP error, timeout, error code, malformed amount, no SMS package) | none: always on                         |

The last top-up is the credit the monitor read right after it saw the credit rise; until it has
seen a rise (and after every restart) it is `CETELE_SMS_BALANCE_LAST_TOP_UP`, which the owner sets
after each purchase (0 means not known yet, so the share rule waits for a rise). The read fails
closed: one malformed `Adet SMS` amount makes the whole reading unknown, never zero and never a
partial sum.

Each alert writes one `WARN` log line and sends one mail. When the mail fails, an `ERROR` line is
written and the rule is not marked as sent, so the next run mails it again. The state (which rules
were mailed today, the observed top-up) is held in the process; ADR-0002 runs one server instance,
and a restart can repeat at most one mail per rule on that day.

Meters (Micrometer, in the application's meter registry):

| Meter                      | Prometheus name                  | Type    | Value                                    |
| -------------------------- | -------------------------------- | ------- | ---------------------------------------- |
| `cetele.sms.balance`       | `cetele_sms_balance`             | gauge   | last credit read; `NaN` while unknown    |
| `cetele.sms.balance.alert` | `cetele_sms_balance_alert_total` | counter | alerts raised, tag `rule`                |

The actuator exposes only `health` and there is no Prometheus registry on the classpath, so the
meters are not scraped yet; the log line and the mail are the alert path.

What to do: top up the Netgsm account, then set `CETELE_SMS_BALANCE_LAST_TOP_UP` to the bought
amount. For `unknown`: check the Netgsm credentials and the provider status page; the reminder
sends report their own provider errors.

## Hard caps (automated)

Each cap is enforced in the request path, not by the monitor:

- Per-shop monthly SMS quota: `SmsQuotaService.reserve` under the shop lock; FREE 30, PRO 500.
  Tests: `SmsQuotaServiceTest` (`the thirty first FREE reservation is rate limited until the next
  Istanbul month`, the PRO case, `sixteen threads reserve thirty distinct slots including
  concurrent first creation`), `DowngradeTest`.
- Global daily SMS cap: `SmsQuotaService.reserveDailyCap` under a global lock, counting queued,
  sent and unknown-outcome reminder SMS of the Istanbul day; `CETELE_SMS_DAILY_CAP`, default 1000,
  zero or negative fails startup. Tests: `DailyCapTest`, `ReminderFlowTest`,
  `MonitoringConfigurationTest` (`the global daily SMS cap binds from its property and cannot be
  zero or negative`).
- Presign quota: `MediaService.presign` under the shop media lock counts `PENDING` and `READY`
  uploads of the Istanbul month; FREE 200, PRO 2000, at most 1.2 MB per upload. Tests:
  `MediaPresignTest` (`pending and ready slots count toward the monthly quota`), `HardCapsTest`
  (`concurrent presigns at the monthly photo quota reserve only the free slots`).

Residual risk: OTP SMS are outside the daily cap (a user must always be able to sign in); they are
bounded by the rate limits of [ADR-0009](../adr/0009-rate-limiting-and-client-ip.md) (3 per phone
and 10 per address in 10 minutes) and show up in the balance monitor.

## Hosting budget (manual)

Budget: 40 EUR per month for VPS, R2 above the free tier and mail; SMS credit is bought separately
and watched by the monitor. Act at 32 EUR. Check: the invoices of the VPS provider, Cloudflare and
Resend on the first working day of the month; where the provider offers a billing or usage alert
mail, set it to 32 EUR to the owner's account address. Prices are not verified (ADR-0002).

## Database size (manual)

Check weekly on the host:

```sql
SELECT pg_size_pretty(pg_database_size('cetele'));
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

and `df -h` for the Docker volume. Thresholds: 5 GB database, disk 70 % (plan a larger disk or
clean up), 85 % (urgent: WAL archiving and backups need room). The retention jobs keep the growth
bounded: `RetentionSweeper`, `AuditRetentionJob` (365 days), the billing sweep for webhook rows.

## Object storage size and egress (manual)

Cloudflare R2 media bucket (`CETELE_S3_BUCKET_MEDIA`). Published R2 terms (not verified): 10 GB
storage, 1,000,000 Class A and 10,000,000 Class B operations per month free, no egress fee. Check
the bucket metrics in the R2 dashboard monthly. Thresholds: 8 GB stored, 800,000 Class A or
8,000,000 Class B operations in the month. Bounds from the server side: the presign quota above
limits uploads (a PRO shop at most 2000 × 1.2 MB per month); downloads use presigned URLs valid for
10 minutes; `MediaSweeper` removes expired and replayed uploads hourly. The backup bucket is
covered by the backup runbook (spec item 20).

## Play Integrity quota (manual)

Each `POST /v1/auth/otp/request` in `CETELE_INTEGRITY_MODE=play` decodes one token through the Play
Integrity API. Google documents a default of 10,000 requests per day per app (not verified, no Play
account). Check the quota page of the Play Integrity API in the Google Cloud console weekly, or
create a Cloud Monitoring alert policy on its quota usage at 70 % (7,000 per day) mailed to the
owner. When it is reached, the verifier answers as unavailable and OTP requests are refused, so
sign-in stops: request a quota increase from Google before that point. The OTP rate limits above
bound one address and one phone, not the total.

## Alert mail quota (manual)

The monitor sends at most three mails a day (one per rule). Published Resend free tier (not
verified): 100 mails per day, 3,000 per month. Check the Resend dashboard monthly; more than 50
alert mails in a day means a loop and is investigated from the server log.

## Evidence

- `SmsBalanceMonitorTest`, `NetgsmSmsBalanceProviderTest`, `ResendAlertMailerTest`,
  `MonitoringConfigurationTest`, `HardCapsTest` in `server/src/test/kotlin/app/cetele/server/monitoring/`,
  run by `cd cetele/server && ./gradlew --offline check openApiContractCheck`. The Netgsm and Resend
  fixtures are shaped after the provider documentation and are not verified against the live APIs.
- Not exercised: a real Netgsm balance read, a real Resend mail, every manual check above
  (`not exercised: no provider account`).
