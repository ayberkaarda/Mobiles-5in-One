# Cost alerts and application caps

Security checklist item 22 (Harcama uyarısı kur). Patika is a portfolio project with no paid account behind it. The budget below is a planning sheet for a first production year at neighbourhood scale (a few thousand volunteers in one city). Prices are the providers' published list terms as understood at the time of writing; check them again at account setup. The application caps in the second half are implemented and cited from the code.

## Budget and alert thresholds

| Item | Provider (ADR-0002) | Planning budget | Alert at | Hard action at |
| --- | --- | --- | --- | --- |
| Hosting: API, Web, Worker containers + reverse proxy | One small VM or container host | 25 USD/month | 80% of the monthly budget (provider billing alert) | 100%: review instance sizes before scaling out |
| Managed PostgreSQL + PostGIS with PITR | Managed provider | 25 USD/month | DB size 70% of the plan's storage; connections 80% of the plan limit | 90% storage: grow the plan or prune (`idempotency_keys`, `email_tokens` are already pruned hourly) |
| Object storage (photos + backups) | Cloudflare R2 | 10 GB is in the free tier; 5 USD/month planned beyond it | 80% of 10 GB; Class A operations 80% of the free monthly allowance | Uploads are already capped per user per day (below) |
| Egress for photos | R2 (no egress fee) behind the CDN | 0 USD | CDN request volume 2x the 7-day average | Lower `Media:PhotoUrlMinutes` caching misses by setting `Storage:PublicBaseUrl` to the CDN |
| Transactional email | Resend | Free tier (3,000 emails/month, 100/day) | 70/day or 2,000/month | 100/day: registration codes queue behind the provider's limit; move to the paid plan |
| Push | Firebase Cloud Messaging | Free | Worker cost guard soft cap (5,000 sends/day) | Cost guard hard cap (20,000 sends/day) |
| Google Play | Play Console | 25 USD one-time registration; 15% service fee on Destekçi subscription revenue | n/a | n/a |
| Error reporting | None configured (no Sentry in the code) | 0 | n/a | n/a |

Alert routing: provider billing alerts go to the owner's email. The Worker's cost guard writes a warning log line (below), which the log pipeline must turn into a notification; there is no email from the Worker yet.

## Application caps implemented

| Cap | Value | Where |
| --- | --- | --- |
| Urgent posts per user per local day (UTC+3) | 3 | `UrgentRules.DailyPostCap`, [`src/Patika.Api/Features/Urgent/UrgentEndpoints.cs`](../../src/Patika.Api/Features/Urgent/UrgentEndpoints.cs) line 24, enforced in `TryCreateAsync` (line 154) |
| Urgent fan-out per post | 500 devices; the setting can lower it but `Math.Min(settings.MaxDevicesPerPost, 500)` stops it from going higher | `Push:MaxDevicesPerPost`, [`src/Patika.Worker/Jobs/Push/PushSender.cs`](../../src/Patika.Worker/Jobs/Push/PushSender.cs) line 51; clamp in [`UrgentFanout.cs`](../../src/Patika.Worker/Jobs/Push/UrgentFanout.cs) line 116; database check `ck_urgent_posts_notified_count` (0..500) |
| Urgent fan-out radius | 2,000 m ceiling (saved home area, rounded to 3 decimals) | `Push:MaxRadiusMeters` (`PushSender.cs`), `DeviceRules.MaxRadiusMeters` and `HomeAreaDecimals` in [`src/Patika.Api/Features/Devices/DeviceEndpoints.cs`](../../src/Patika.Api/Features/Devices/DeviceEndpoints.cs) lines 19-22; `ck_users_urgent_radius` 500..2000 |
| Stale devices skipped | not seen for 60 days | `Push:StaleDeviceDays`, `PushSender.cs` line 57 |
| Late fan-out skipped | posts older than 60 minutes when first seen (after an outage) | `Push:FanoutWindowMinutes`, `PushSender.cs` line 60 |
| `cost.guard` push budget | soft 5,000/day pauses non-critical sends; hard 20,000/day stops urgent sends too | `Push:CostGuard:DailyCap` / `CriticalDailyCap`, `PushSender.cs` lines 75-82; atomic counter in `push_daily_counters` ([`PushCostGuard.cs`](../../src/Patika.Worker/Jobs/Push/PushCostGuard.cs) lines 19-64); `cost.guard` job every 5 minutes raises one alert per day ([`PushJobs.cs`](../../src/Patika.Worker/Jobs/Push/PushJobs.cs) lines 15-30 and 95-101) |
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

- Email: the guard counts pushes only. Email volume is bounded per account (above) but has no global daily counter or pause.
- The alert is a log line, `cost.guard: {Sent} pushes on {Day} reached the daily cap {Cap}; non-critical sends are paused` (`LoggingCostAlertNotifier`, `PushCostGuard.cs` lines 109-117). `ICostAlertNotifier` is the seam for an email sender; none is wired.
- The "alerted today" state is per Worker process (`CostGuardAlertState`), so a restart can alert twice on one day. With one Worker instance (ADR-0002) that is acceptable.
- Rate limits are in memory per API instance. Running more than one instance needs the shared store from ADR-0002.

## Verification

The guard and fan-out caps are covered by `CostGuardTests`, `UrgentFanoutTests` and `FanoutPostgisTests` in `tests/Patika.Worker.Tests`, and the upload quota by `PresignTests` in `tests/Patika.Api.Tests`. Run on 2026-10-26 while writing this document:

```text
dotnet test tests/Patika.Worker.Tests --filter "FullyQualifiedName~Push|FullyQualifiedName~Fanout|FullyQualifiedName~CostGuard"
Başarılı!  - Başarısız:     0, Başarılı:    10, Atlanan:     0, Toplam:    10, Süre: 9 s - Patika.Worker.Tests.dll (net10.0)
dotnet test tests/Patika.Api.Tests --filter "FullyQualifiedName~PresignTests"
Başarılı!  - Başarısız:     0, Başarılı:    22, Atlanan:     0, Toplam:    22, Süre: 1 s - Patika.Api.Tests.dll (net10.0)
```
