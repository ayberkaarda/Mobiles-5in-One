# Cost alerts and application caps

Security checklist item 22 (Harcama uyarısı kur). Patika is a portfolio project with no paid account behind it. The budget below is a planning sheet for a first production year at neighbourhood scale (a few thousand volunteers in one city). Prices are the providers' published list terms as understood at the time of writing; check them again at account setup. The application caps in the second half are implemented and cited from the code.

## Budget and alert thresholds

| Item | Provider (ADR-0002) | Planning budget | Alert at | Hard action at |
| --- | --- | --- | --- | --- |
| Hosting: API, Web, Worker containers + reverse proxy | One small VM or container host | 25 USD/month | 80% of the monthly budget (provider billing alert) | 100%: review instance sizes before scaling out |
| Managed PostgreSQL + PostGIS with PITR | Managed provider | 25 USD/month | DB size 70% of the plan's storage; connections 80% of the plan limit | 90% storage: grow the plan or prune (`idempotency_keys`, `email_tokens` are already pruned hourly) |
| Object storage (photos + backups) | Cloudflare R2 | 10 GB is in the free tier; 5 USD/month planned beyond it | 80% of 10 GB; Class A operations 80% of the free monthly allowance | Uploads are already capped per user per day (below) |
| Egress for photos | R2 (no egress fee) behind the CDN | 0 USD | CDN request volume 2x the 7-day average | Lower `Media:PhotoUrlMinutes` caching misses by setting `Storage:PublicBaseUrl` to the CDN |
| Transactional email | Resend | Free tier (3,000 emails/month, 100/day) | 70/day or 2,000/month | Application cap `CostGuard:MaxEmailsPerDay` (default 5,000; set it to the plan's daily limit, 100 on the free tier): further sends that day are skipped and `cost.guard` alerts; move to the paid plan |
| Push | Firebase Cloud Messaging | Free | Worker cost guard soft cap (5,000 sends/day) | Cost guard hard cap (20,000 sends/day) |
| Google Play | Play Console | 25 USD one-time registration; 15% service fee on Destekçi subscription revenue | n/a | n/a |
| Error reporting | None configured (no Sentry in the code) | 0 | n/a | n/a |

Alert routing: provider billing alerts go to the owner's email. The Worker's `cost.guard` and `backup.verify` jobs write a warning log line and mail the same count-only text to `Ops:AlertEmail` through the API's email transport (Resend; the Development folder sender locally). The alert mail bypasses the email cap on purpose, so an alert about the cap is never stopped by it; each alert fires at most once per local day and kind.

## Application caps implemented

| Cap | Value | Where |
| --- | --- | --- |
| Urgent posts per user per local day (UTC+3) | 3 | `UrgentRules.DailyPostCap`, [`src/Patika.Api/Features/Urgent/UrgentEndpoints.cs`](../../src/Patika.Api/Features/Urgent/UrgentEndpoints.cs) line 24, enforced in `TryCreateAsync` (line 154) |
| Urgent fan-out per post | 500 devices; the setting can lower it but `Math.Min(settings.MaxDevicesPerPost, 500)` stops it from going higher | `Push:MaxDevicesPerPost`, [`src/Patika.Worker/Jobs/Push/PushSender.cs`](../../src/Patika.Worker/Jobs/Push/PushSender.cs) line 51; clamp in [`UrgentFanout.cs`](../../src/Patika.Worker/Jobs/Push/UrgentFanout.cs) line 116; database check `ck_urgent_posts_notified_count` (0..500) |
| Urgent fan-out radius | 2,000 m ceiling (saved home area, rounded to 3 decimals) | `Push:MaxRadiusMeters` (`PushSender.cs`), `DeviceRules.MaxRadiusMeters` and `HomeAreaDecimals` in [`src/Patika.Api/Features/Devices/DeviceEndpoints.cs`](../../src/Patika.Api/Features/Devices/DeviceEndpoints.cs) lines 19-22; `ck_users_urgent_radius` 500..2000 |
| Stale devices skipped | not seen for 60 days | `Push:StaleDeviceDays`, `PushSender.cs` line 57 |
| Late fan-out skipped | posts older than 60 minutes when first seen (after an outage) | `Push:FanoutWindowMinutes`, `PushSender.cs` line 60 |
| `cost.guard` push budget | soft 5,000/day pauses non-critical sends; hard 20,000/day stops urgent sends too | `CostGuard:MaxPushesPerDay` (or `Push:CostGuard:DailyCap`) / `Push:CostGuard:CriticalDailyCap`, [`PushSender.cs`](../../src/Patika.Worker/Jobs/Push/PushSender.cs) `CostGuardSettings`; atomic counter in `push_daily_counters` channel `push` ([`PushCostGuard.cs`](../../src/Patika.Worker/Jobs/Push/PushCostGuard.cs)); `cost.guard` job every 5 minutes raises one alert per local day and kind ([`PushJobs.cs`](../../src/Patika.Worker/Jobs/Push/PushJobs.cs) `CostGuardJob`, `CostGuardAlertState`) |
| Email budget | 5,000/day across every email kind; each send reserves one unit first, a transport exception returns it; at the cap the send is skipped and a count-only warning is logged | `CostGuard:MaxEmailsPerDay` (API and Worker), [`BudgetedEmailSender.cs`](../../src/Patika.Api/Email/BudgetedEmailSender.cs) wrapping every transport; counter `push_daily_counters` channel `email` ([`DailySendBudget.cs`](../../src/Patika.Infrastructure/Security/DailySendBudget.cs)); the Worker's `cost.guard` alerts at the cap |
| Photo uploads per user per local day | 30; 100 with an active Destekçi entitlement | `Media:DailyQuota` / `SupporterDailyQuota`, [`src/Patika.Infrastructure/Media/MediaSettings.cs`](../../src/Patika.Infrastructure/Media/MediaSettings.cs) lines 34-37; advisory-locked ledger in [`UploadLedger.cs`](../../src/Patika.Api/Features/Media/UploadLedger.cs) |
| Upload size and type | 1 byte to 5 MB; JPEG, PNG, WebP; the presigned PUT signs `Content-Length` and `Content-Type` | `MediaKeys.MaxUploadBytes`, [`src/Patika.Contracts/Media/MediaKeys.cs`](../../src/Patika.Contracts/Media/MediaKeys.cs) line 15; validator in [`MediaEndpoints.cs`](../../src/Patika.Api/Features/Media/MediaEndpoints.cs) lines 24-25 |
| Presigned URL lifetime | PUT 5 minutes, photo GET 15 minutes | `Media:PresignMinutes`, `Media:PhotoUrlMinutes` (`MediaSettings.cs`) |
| Map bounding box | at most 400 km², inside the Türkiye box (lat 35.80..42.20, lng 25.60..44.90) | [`src/Patika.Api/Validation/GeoRules.cs`](../../src/Patika.Api/Validation/GeoRules.cs) lines 10-15 and 59-60 |
| Radius queries | at most 5,000 m; urgent list returns at most 100 posts | `GeoRules.MaxRadiusMeters` (line 15); `UrgentRules.MaxResults` (`UrgentEndpoints.cs` line 26) |
| JSON request body | 1 MB | `HttpHardening.MaxRequestBodyBytes`, [`src/Patika.Api/Security/HttpHardening.cs`](../../src/Patika.Api/Security/HttpHardening.cs) line 32 |
| Email volume per account | 10 codes per user and purpose per 24 h; resend 3 per 15 min per address | `EmailCodeHasher.MaxIssuedPerWindow`, [`src/Patika.Api/Features/Auth/EmailCodes.cs`](../../src/Patika.Api/Features/Auth/EmailCodes.cs) lines 35-37 and 95 |
| Request rate limits | global 300/min per IP; auth 5/15 min per IP and per email; verify 10/15 min; external sign-in 10/15 min; TOTP 100/15 min per IP and 20/15 min per user; refresh 30/min per user; subscriptions 20/15 min per IP | [`src/Patika.Api/Security/RateLimiting/RateLimitingSetup.cs`](../../src/Patika.Api/Security/RateLimiting/RateLimitingSetup.cs) lines 68-137 |
| Play verification calls | 10 s timeout per call, one lock per purchase token | `BillingRegistration.PlayTimeout`, [`src/Patika.Infrastructure/Billing/PlayDeveloperApi.cs`](../../src/Patika.Infrastructure/Billing/PlayDeveloperApi.cs) line 148 |

## What the cost guard does not cover

- The email cap pauses every kind, including verification and password reset codes: there are no non-critical emails today, so at the cap new sign-ups wait for the next local day. Set the cap to the provider's daily limit so Patika stops before the provider rejects mail.
- The alert lines are `cost.guard: {Sent} pushes on {Day} reached the daily cap {Cap}; non-critical sends are paused` and `cost.guard: {Count} emails on {Day} reached the daily cap {Cap}; email sends are paused` (`CostAlertNotifier`, `PushCostGuard.cs`); the API also logs `cost.guard: email daily cap {Cap} reached on {Day}; sends paused` for each skipped send. No recipient, subject or body is ever logged or mailed.
- The "alerted today" state is per Worker process (`CostGuardAlertState`), so a restart can alert twice on one day. With one Worker instance (ADR-0002) that is acceptable.
- Rate limits are in memory per API instance. Running more than one instance needs the shared store from ADR-0002.

## Verification

The guard and fan-out caps are covered by `CostGuardTests`, `OpsAlertTests` (one mail per day and kind to the ops address, counts only), `UrgentFanoutTests` and `FanoutPostgisTests` in `tests/Patika.Worker.Tests`, the email budget by `EmailBudgetTests` (fake transport stops at the cap, failed sends return their unit) and `EmailBudgetPersistenceTests` (concurrent reservations on PostgreSQL never pass the cap, a new local day has its own budget) in `tests/Patika.Api.Tests`, and the upload quota by `PresignTests`. Phase 6 gate run on 2026-10-26: Worker 59/59, API 491/491. Earlier run while writing this document: Run on 2026-10-26 while writing this document:

```text
dotnet test tests/Patika.Worker.Tests --filter "FullyQualifiedName~Push|FullyQualifiedName~Fanout|FullyQualifiedName~CostGuard"
Başarılı!  - Başarısız:     0, Başarılı:    10, Atlanan:     0, Toplam:    10, Süre: 9 s - Patika.Worker.Tests.dll (net10.0)
dotnet test tests/Patika.Api.Tests --filter "FullyQualifiedName~PresignTests"
Başarılı!  - Başarısız:     0, Başarılı:    22, Atlanan:     0, Toplam:    22, Süre: 1 s - Patika.Api.Tests.dll (net10.0)
```
