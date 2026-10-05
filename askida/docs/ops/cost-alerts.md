# Cost alerts and application caps

Security checklist item 22: the application limits what one actor or one bad day can cost, and
the owner watches the providers' own spend alerts. This page lists both. Money figures marked
"sample" are planning values for a portfolio project, not quotes.

## 1. Where money goes

| Cost              | Driver                                                          | Sample monthly planning figure | Alert                                                                   |
| ----------------- | --------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Hosting (app, horizon, scheduler) | One small VM or container host for three roles      | sample: 15 to 30 USD           | Provider budget alert at 120 % of the planned figure                    |
| Database          | PostgreSQL with PostGIS, daily backups                          | sample: 15 to 25 USD           | Storage above 80 % of the plan; connections near the limit              |
| Redis             | Queues, rate limiters, send counters; small memory footprint    | sample: 5 to 10 USD            | Memory above 70 %; evictions above zero                                 |
| Object storage    | Private shop documents, backups (R2 or any S3-compatible store) | sample: under 5 USD            | Stored bytes and request count budget alerts                            |
| Mail              | Verification, reset, receipt and finance mail                   | sample: free tier to 20 USD    | Daily send budget below (application side) plus the provider's quota alert |
| Payment provider  | Per-transaction fee, charged to the platform commission         | sample: see section 2          | Reconciliation job and finance alert (security items 17 and 22)         |
| Push (FCM)        | Free                                                            | 0                              | The daily push budget below still protects the device-token flow       |

**Provider dashboard alerts: not exercised: no provider accounts exist in this portfolio project.**
The thresholds above are what the owner sets up when accounts are opened.

## 2. Payment fee model (sample)

The platform commission is `COMMISSION_BPS` (sample 500 basis points, 5 %). The provider fee is
modelled as a percentage plus a fixed amount per transaction; the figures below are a sample only.

| Item                                  | Sample value                       |
| ------------------------------------- | ---------------------------------- |
| Provider fee                          | 2.9 % + 0.25 TRY per charge        |
| Platform commission on a donation     | 5.0 % of the donation              |
| Margin on a 100 TRY donation          | 5.00 - (2.90 + 0.25) = 1.85 TRY    |
| Break-even donation (fixed fee only)  | about 12 TRY with these sample figures |

Small donations cost the platform more than they earn at a sample rate like this; the per-donation
minimum and the real rate are business decisions outside this project.

## 3. Daily send budget

Job `cost.guard` (`App\Domain\Cost\Jobs\GuardDailySends`) runs every 15 minutes. Sends are counted
in Redis day keys (`cost:sent:{channel}:{day}`, `INCR`, two day TTL; the day follows
`Europe/Istanbul`). Counters hold numbers only: no address, user or message content.

| Setting                | Default | Variable               |
| ---------------------- | ------- | ---------------------- |
| Daily e-mail cap       | 2 000   | `COST_DAILY_EMAIL_CAP` |
| Daily push cap         | 20 000  | `COST_DAILY_PUSH_CAP`  |

When a channel reaches its cap:

- Non-critical sends of that channel stop for the rest of the day: the "Yeni askı" push (shop
  members) and the "Askın alındı" push (donor). `SendPush` asks `SendBudget::allows()` before every
  device delivery and counts each delivery.
- Critical sends are never paused: verification and password-reset codes, donation receipts and
  refund notices, deletion confirmation, finance and fraud alerts. Every mailable is critical unless
  it implements `App\Domain\Cost\Contracts\NonCriticalMail` (none does today); a listener on
  `MessageSending` counts every mail and cancels only a non-critical one.
- Finance gets one alert mail per day and channel at `FINANCE_ALERT_EMAIL`; running the job again
  the same day does not send another.
- The next day starts with a clean counter.

Tested in `tests/Feature/Cost/SendBudgetTest.php` (cap reached, critical still sent, one alert per
day, reset on the next day, schedule every 15 minutes).

## 4. Application caps

| Cap                                         | Value                                           | Config or constant                                         | Tested in                                                            |
| ------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Donation per transaction                    | 2 000 TRY (200 000 minor units)                 | `payments.caps.transaction_minor`                          | `tests/Feature/Api/Donations/DonationsTest.php`                      |
| Donation per donor and day                  | 5 000 TRY (500 000 minor units), Istanbul day   | `payments.caps.donor_day_minor`                            | `tests/Feature/Api/Donations/DonationsTest.php`                      |
| Units per donation                          | 20                                              | `StoreDonationRequest::MAX_QTY`                            | `tests/Feature/Api/Donations/DonationsTest.php`                      |
| Item daily cap set by the shop              | 1 to 1 000 units                                | `ItemFieldsRequest::MAX_DAILY_CAP`                         | `tests/Feature/Api/Shops/ItemsTest.php`                                            |
| Item price                                  | up to 1 000 000 minor units                     | `ItemFieldsRequest::MAX_PRICE`                             | `tests/Feature/Api/Shops/ItemsTest.php`                                            |
| Anonymous reservations per day              | 2 in total, 1 per shop                          | `askida.hooks.anon_daily_cap`, `anon_shop_daily_cap`       | `tests/Feature/Api/Hooks/ReserveTest.php`                            |
| Reserve attempts per hour                   | 5 per anonymous device, 60 per address          | `askida.limits.hooks_reserve_per_hour_anon`, `_ip`         | `tests/Feature/Api/Hooks/ReserveTest.php`                            |
| Redemption code attempts                    | 5 per code                                      | `askida.hooks.code_attempts`                               | `tests/Feature/Api/Hooks/RedeemTest.php`                             |
| Redeems per minute and shop                 | 30                                              | `askida.limits.redeem_per_minute_shop`                     | `tests/Feature/Api/Hooks/RedeemTest.php`                             |
| Anonymous attestation per day               | 3 per device key                                | `askida.limits.anon_attest_per_day`                        | `tests/Feature/Api/Anon/AttestTest.php`                                             |
| Shop documents                              | 3 per shop, 5 MB each, 10 presigns per shop and day | `DocumentRules`                                        | `tests/Feature/Documents/DocumentUploadTest.php`                     |
| Push fan-out                                | 2 000 deliveries per hour across all users      | `askida.push.hourly_fanout_cap` (`PUSH_HOURLY_FANOUT_CAP`)  | `tests/Feature/Api/Hooks/PushTest.php`                               |
| Send budget                                 | 2 000 e-mails and 20 000 pushes per day         | `askida.cost.*` (`COST_DAILY_*_CAP`)                       | `tests/Feature/Cost/SendBudgetTest.php`                              |
| Fraud thresholds (payout hold)              | more than 30 redeems per shop and hour; staff self-redeem share above 0.5 once at least 5 redemptions exist; more than 3 suspicious self-redeems | `payments.fraud.*` | `tests/Feature/Fraud/FraudScanTest.php`                              |

The cap values above are the defaults in `server/config`; a deployment can override those that
have an environment variable (see `docs/ops/env.md`).
