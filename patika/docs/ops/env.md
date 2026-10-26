# Configuration reference

Every configuration key the code reads, collected from `appsettings*.json`, the options classes and the direct `IConfiguration` reads in `src/` and `app/` (2026-10-26). Keys use the `Section:Key` form; as environment variables they are `Section__Key` (array items `Section__Key__0`). Secrets come only from the environment or a secret store, never from a committed file (security checklist item 1).

Columns: **Prod** = must be set in Production (the app refuses to start, or the feature does not work, without it). **Secret** = treat as a credential.

## Host

| Key | Used by | Purpose | Prod | Secret | Example |
| --- | --- | --- | --- | --- | --- |
| `ASPNETCORE_ENVIRONMENT` / `DOTNET_ENVIRONMENT` | API, Web / Worker | `Development` enables the ephemeral JWT key, the folder email sender, `/dev/billing/purchases` and test purchases by default; anything else is treated like Production by the billing checks | yes (`Production`) | no | `Production` |
| `ASPNETCORE_HTTP_PORTS` | API, Web | Listen port inside the container | no | no | `8080` |
| `PATIKA_DB` | `dotnet ef` only (`PatikaDbContextFactory`) | Connection string for design-time migrations and the restore drill | no (migration step) | yes | `Host=db;Database=patika;Username=patika_migrator;Password=...` |

## API (`src/Patika.Api`)

| Key | Purpose | Prod | Secret | Example / default |
| --- | --- | --- | --- | --- |
| `ConnectionStrings:Patika` | Read-write PostgreSQL + PostGIS connection | yes | yes | `Host=db;Port=5432;Database=patika;Username=patika_api;Password=...` |
| `Database:MigrateOnStartup` | Apply EF migrations at start-up (compose only; Production runs them as a separate step) | no (keep `false`) | no | `false` |
| `Jwt:SigningKey` | ES256 (P-256) private key, PKCS#8 PEM or single-line base64. Without it the API starts only in Development, with an ephemeral key. Email-code and billing-account keys are derived from it unless set separately | yes | yes | `MIGHAgEAMBMGByqGSM49...` |
| `Jwt:Issuer` | Access token `iss` | no | no | `patika` |
| `Jwt:Audience` | Access token `aud` | no | no | `patika-api` |
| `Jwt:AccessTokenMinutes` | Access token lifetime | no | no | `15` |
| `Jwt:RefreshTokenDays` | Refresh token lifetime | no | no | `30` |
| `Auth:EmailCodes:Key` | Dedicated HMAC key for email codes (base64, at least 32 bytes); empty means HKDF from the JWT key | no | yes | `base64:32 bytes` |
| `Google:ClientIds` (array) | Android OAuth client ids accepted as Google ID token `aud` (ADR-0005, ADR-0008) | only for Google sign-in | no | `Google__ClientIds__0=1234-abc.apps.googleusercontent.com` |
| `Network:TrustedProxies` (array) | Reverse proxy IPs or CIDRs whose `X-Forwarded-For` / `X-Forwarded-Proto` is processed (one hop); empty processes none. Replaces the old `Network:KnownProxies` / `KnownNetworks`, which are no longer read | yes behind a proxy | no | `Network__TrustedProxies__0=10.0.0.2`, `Network__TrustedProxies__1=10.0.0.0/24` |
| `Network:BffAddress` | Socket address of the Web admin console; only that peer may send `X-Patika-Client-Ip` (docs/security/hardening.md). Must be a literal IPv4 (dotted quad) or IPv6 address and set together with the key, or the API refuses to start; IPv4 and IPv4-mapped IPv6 peers compare equal. A valid key from another peer logs a warning with that peer | with the admin console | no | `172.30.57.10` |
| `Network:BffSharedKey` | Shared key the Web sends in `X-Patika-Bff-Key`; compared as SHA-256 digests in fixed time. Same value in the Web. At least 32 characters, or the API and the Web refuse to start | with the admin console | yes | 32+ random bytes, base64 |
| `CostGuard:MaxEmailsPerDay` | Daily cap for non-critical email kinds (local day, UTC+3); at the cap they are skipped with a warning and the Worker alerts. Security mail never counts against it | no | no | `5000` |
| `CostGuard:MaxCriticalEmailsPerDay` | Separate emergency budget for security mail (verification and reset codes, registration-attempt notice, deletion confirmation); at the cap those endpoints answer 503 `email_unavailable` with `Retry-After` (docs/ops/cost-alerts.md) | no | no | `20000` |
| `Cors:Enabled` | CORS is off by default (no browser client) | no | no | `false` |
| `Cors:AllowedOrigins` (array) | Allowlist when CORS is enabled | no | no | `https://patika.app` |
| `Email:DevelopmentOutbox` | Folder for the Development email sender | no (Development only) | no | `/tmp/patika-dev-mail` |
| `Resend:ApiKey` | Resend API key; empty outside Development means the unconfigured sender drops mail with a warning | yes | yes | `re_...` |
| `Resend:From` | Sender | no | no | `Patika <bildirim@patika.app>` |
| `Resend:ReplyTo` | Reply-To | no | no | `destek@patika.app` |
| `Resend:BaseAddress` | API base URL | no | no | `https://api.resend.com/` |
| `Storage:Endpoint` | S3 endpoint the API talks to (presigning) | yes | no | `https://<account>.r2.cloudflarestorage.com` |
| `Storage:PublicEndpoint` | Host the phone uploads to and loads photos from; presigned URLs are signed for it. Defaults to `Endpoint` | if different from `Endpoint` | no | `https://media-upload.patika.app` |
| `Storage:Bucket` | Photo bucket | yes | no | `patika-media` |
| `Storage:AccessKey` | S3 access key id | yes | yes | `...` |
| `Storage:SecretKey` | S3 secret | yes | yes | `...` |
| `Storage:PublicBaseUrl` | CDN base for processed `media/` only; when set, photo URLs are `{base}/media/...` instead of presigned GETs | no | no | `https://cdn.patika.app` |
| `Storage:Region` | `auto` for R2, `us-east-1` for MinIO | yes for R2 | no | `auto` |
| `Media:DailyQuota` | Uploads per user per local day | no | no | `30` |
| `Media:SupporterDailyQuota` | Same, with Destekçi | no | no | `100` |
| `Media:PresignMinutes` | Presigned PUT lifetime | no | no | `5` |
| `Media:PhotoUrlMinutes` | Presigned GET lifetime when no `PublicBaseUrl` | no | no | `15` |
| `DataProtection:KeysPath` | Persistent key ring that encrypts TOTP secrets and purchase tokens; must be the same directory for the API and the Worker. Production refuses to start without it | yes | yes (the files) | `/keys` |
| `Billing:Provider` | `Fake` (default) or `Google`; anything else fails start-up | yes | no | `Google` |
| `Billing:AllowFake` | Required `true` to run `Fake` outside Development | only with `Fake` | no | `false` |
| `Billing:AllowTestPurchases` | Whether Play test purchases grant entitlement; defaults to `true` only in Development | no | no | `false` |
| `Billing:PackageName` | Must be `app.patika.android` with the Google provider | with `Google` | no | `app.patika.android` |
| `Billing:Google:AccessToken` | Bearer for the Play Developer API (from the Play service account) | with `Google` | yes | `ya29....` |
| `Billing:Rtdn:Audience` | Expected `aud` of Pub/Sub push OIDC tokens on `/webhooks/play` | with `Google` | no | `https://api.patika.app/webhooks/play` |
| `Billing:Rtdn:Email` | Expected push service-account email | with `Google` | no | `rtdn-push@project.iam.gserviceaccount.com` |
| `Billing:Rtdn:JwksUrl` | Google OIDC JWKS (required to be set with `Google`) | with `Google` | no | `https://www.googleapis.com/oauth2/v3/certs` |
| `Billing:AccountKey` | HMAC key for the obfuscated Play account id (base64, at least 32 bytes); empty means HKDF from the JWT key | no | yes | `base64:32 bytes` |
| `OpenApi:Enabled` | Serve `/openapi.json` outside Development (for a ZAP API scan run only); Development always serves it | no (keep unset) | no | `true` |
| `Logging:LogLevel:*` | Present in `appsettings.json` but not used by the API, the Worker or the Web: Serilog levels are set in code (`PatikaLogging.cs`) | no | no | n/a |

Sources: [`PatikaApiServices.cs`](../../src/Patika.Api/PatikaApiServices.cs), [`JwtSettings.cs`](../../src/Patika.Api/Security/Tokens/JwtSettings.cs), [`HttpHardening.cs`](../../src/Patika.Api/Security/HttpHardening.cs), [`EmailCodes.cs`](../../src/Patika.Api/Features/Auth/EmailCodes.cs), [`ExternalIdentity.cs`](../../src/Patika.Api/Features/Auth/ExternalIdentity.cs), [`EmailSender.cs`](../../src/Patika.Api/Email/EmailSender.cs), [`ResendEmailSender.cs`](../../src/Patika.Api/Email/ResendEmailSender.cs), [`MediaSettings.cs`](../../src/Patika.Infrastructure/Media/MediaSettings.cs), [`PlayDeveloperApi.cs`](../../src/Patika.Infrastructure/Billing/PlayDeveloperApi.cs), [`PlayPushVerifier.cs`](../../src/Patika.Api/Features/Subscriptions/PlayPushVerifier.cs), [`BillingAccountKey.cs`](../../src/Patika.Api/Features/Subscriptions/BillingAccountKey.cs), [`Program.cs`](../../src/Patika.Api/Program.cs).

## Worker (`src/Patika.Worker`)

| Key | Purpose | Prod | Secret | Example / default |
| --- | --- | --- | --- | --- |
| `ConnectionStrings:Patika` | Read-write database | yes | yes | as API |
| `Storage:Endpoint`, `Storage:Bucket`, `Storage:AccessKey`, `Storage:SecretKey`, `Storage:Region` | Media processing and photo removal ([`ObjectStore.cs`](../../src/Patika.Worker/Jobs/Media/ObjectStore.cs)) | yes | keys yes | as API |
| `Push:Fcm:ProjectId` | Firebase project for FCM HTTP v1; empty means the logging sender (no pushes) | yes for push | no | `patika-prod` |
| `Push:Fcm:ServiceAccountJson` | FCM service-account JSON, single line | yes for push | yes | `{"type":"service_account",...}` |
| `CostGuard:MaxPushesPerDay` | Soft daily push cap; non-critical sends pause. Overrides `Push:CostGuard:DailyCap` when set | no | no | `5000` |
| `CostGuard:MaxEmailsPerDay` | The API's non-critical email cap, read here for the `cost.guard` alerts; keep it equal to the API value | no | no | `5000` |
| `CostGuard:MaxCriticalEmailsPerDay` | The API's security email budget, read here for the `cost.guard` alerts; keep it equal to the API value | no | no | `20000` |
| `Push:CostGuard:DailyCap` | Same soft cap under the push section (older key) | no | no | `5000` |
| `Push:CostGuard:CriticalDailyCap` | Daily urgent push budget, its own counter (`push_urgent`); past it the rest of a fan-out is deferred to the next local day | no | no | `20000` |
| `Push:MaxDevicesPerAuthorPerDay` | Urgent devices one author's posts may reach per local day; the rest is deferred | no | no | `1000` |
| `Push:DeferredFanoutHours` | A deferred fan-out is retried while the post is open and younger than this | no | no | `24` |
| `Push:MaxDevicesPerPost` | Urgent fan-out per post (clamped to 500 in code) | no | no | `500` |
| `Push:MaxRadiusMeters` | Fan-out radius ceiling | no | no | `2000` |
| `Push:StaleDeviceDays` | Skip registrations older than this | no | no | `60` |
| `Push:FanoutWindowMinutes` | Skip posts older than this when first seen | no | no | `60` |
| `Push:SendParallelism` | Concurrent FCM sends | no | no | `8` |
| `DataProtection:KeysPath` | Same ring as the API (reconcile decrypts purchase tokens). Production refuses to start without it | yes | yes | `/keys` |
| `Billing:*` | Same keys and checks as the API (`AddPlayBilling`); `Billing:Google:AccessToken` is used by the daily reconcile | as API | as API | as API |
| `Ops:AlertEmail` | Operator mailbox for `cost.guard` and `backup.verify` alerts; empty means the warning log line is the only alert | recommended | no | `ops@patika.app` |
| `Resend:ApiKey`, `Resend:From`, `Resend:ReplyTo`, `Resend:BaseAddress` | Transport for the ops alert mail (same keys as the API); unset outside Development drops the mail with a warning | with `Ops:AlertEmail` | key yes | as API |
| `Email:DevelopmentOutbox` | Development folder for the ops alert mail | no | no | `/tmp/patika-dev-mail` |
| `Backup:Directory` | `backup.verify`: folder with `patika-*.dump.age` (the backup host's `PATIKA_BACKUP_DIR`, mounted read-only) | one of the two | no | `/backups` |
| `Backup:S3Endpoint`, `Backup:S3Bucket`, `Backup:S3Prefix`, `Backup:S3Region` | `backup.verify` against the backup bucket instead of a folder | one of the two | no | `https://<account>.r2.cloudflarestorage.com`, `patika-backups`, `db`, `auto` |
| `Backup:S3AccessKey`, `Backup:S3SecretKey` | A list-only key for that bucket | with `S3Bucket` | yes | `...` |
| `Backup:MaxAgeHours` | Alert when the newest backup is older than this | no | no | `26` |

Sources: [`PushSender.cs`](../../src/Patika.Worker/Jobs/Push/PushSender.cs), [`PushJobs.cs`](../../src/Patika.Worker/Jobs/Push/PushJobs.cs), [`OpsAlerts.cs`](../../src/Patika.Worker/Jobs/Ops/OpsAlerts.cs), [`BackupVerify.cs`](../../src/Patika.Worker/Jobs/Ops/BackupVerify.cs), [`MediaJobs.cs`](../../src/Patika.Worker/Jobs/Media/MediaJobs.cs), [`PatikaWorkerHost.cs`](../../src/Patika.Worker/PatikaWorkerHost.cs).

## Web (`src/Patika.Web`)

| Key | Purpose | Prod | Secret | Example / default |
| --- | --- | --- | --- | --- |
| `ConnectionStrings:PatikaRead` | Read-only connection for public pages; outside Development the Web refuses to start without it (Development falls back to `ConnectionStrings:Patika`) | yes | yes | `Host=db;Database=patika;Username=patika_web_ro;Password=...` |
| `Admin:ApiBaseUrl` | API base the admin console calls | yes | no | `http://api:8080` (default `https://localhost:7001`) |
| `Web:PublicBaseUrl` | Public origin for canonical, Open Graph, sitemap and robots URLs | yes | no | `https://patika.app` |
| `Web:ShowSamples` | Show `[ÖRNEK]` sample rows (`appsettings.Development.json` sets `true`) | no (keep `false`) | no | `false` |
| `Storage:PublicBaseUrl`, `Storage:PublicEndpoint`, `Storage:Endpoint` | Photo URLs and the CSP `img-src` origin (first one set wins) | yes | no | `https://cdn.patika.app` |
| `Storage:AccessKey`, `Storage:SecretKey`, `Storage:Bucket`, `Storage:Region` | Presigned photo GETs when no `PublicBaseUrl` | when no CDN | keys yes | as API |
| `Media:PhotoUrlMinutes` | Presigned GET lifetime | no | no | `15` |
| `DataProtection:KeysPath` | The Web's own persistent key ring (admin cookie with the encrypted API tokens, antiforgery). A different directory from the API/Worker ring. Production refuses to start without it | yes | yes (the files) | `/keys` (compose volume `web-keys`) |
| `Network:TrustedProxies` (array) | As in the API: the reverse proxy in front of the Web, so the admin console sees and forwards the real browser address | yes behind a proxy | no | `10.0.0.2` |
| `Network:BffSharedKey` | Sent to the API with the browser address on every console request and cookie refresh; must equal the API value (32+ characters). Empty means the console forwards nothing and all admins share the Web host's per-IP limits. At startup the Web asks `GET /v1/health/bff` whether the API accepts its claims and logs `bff.check` (warning when not); `GET /healthz/bff` repeats the check from the host or in Development | with the admin console | yes | as API |

Sources: [`Program.cs`](../../src/Patika.Web/Program.cs), [`SiteUrls.cs`](../../src/Patika.Web/Seo/SiteUrls.cs), [`AdminSession.cs`](../../src/Patika.Web/Services/Admin/AdminSession.cs), [`CarePlaceQueries.cs`](../../src/Patika.Web/Services/PublicQueries/CarePlaceQueries.cs). Since phase 6 the Web persists its own Data Protection ring (`DataProtection:KeysPath`), so admin sessions survive a restart.

## Android app (`app/Patika.App`)

No secrets ship in the APK. Settings are embedded resources read by [`AppSettings.cs`](../../app/Patika.App/Services/AppSettings.cs) and `MapRegistration.cs`; `appsettings.Development.json` overrides only in Debug builds.

| Key / file | Purpose | Prod | Secret | Example |
| --- | --- | --- | --- | --- |
| `Api:BaseUrl` (`appsettings.json`) | API base URL | yes | no | `https://api.patika.app/` (Debug: `http://10.0.2.2:5000/`) |
| `Storage:Origins` (array) | Origins photos may be loaded from and uploaded to (must match `Storage:PublicEndpoint` / `PublicBaseUrl`) | yes | no | `https://media.patika.app` |
| `google-services.json` (file, build machine only, gitignored) | Firebase project for FCM; absent means push off | yes for push | not a secret, but kept out of git (ADR-0008) | n/a |
| Android OAuth client id | Google sign-in; not wired yet (`NotConfiguredGoogleSignIn`) | for Google sign-in | no | n/a |
| Google Maps API key | Street layer; not wired (ADR-0007, the app draws its own map) | no | restricted key | n/a |
| `ApplicationDisplayVersion`, `ApplicationVersion` (`Patika.App.csproj`) | versionName and versionCode, see [signing](../release/signing.md) | yes | no | `0.1`, `1` |
| Upload keystore and passwords | Release signing, see [signing](../release/signing.md) | yes | yes | n/a |

## Backup tooling (`ops/backup`)

`PATIKA_BACKUP_AGE_RECIPIENT`, `PATIKA_BACKUP_DIR`, `PATIKA_BACKUP_S3_URI`, `PATIKA_BACKUP_S3_ENDPOINT`, `PATIKA_BACKUP_RETENTION_DAYS`, `PATIKA_BACKUP_DATABASE_URL`, `PATIKA_BACKUP_AGE_IDENTITY` (secret, offline), `PATIKA_RESTORE_DB`, `PATIKA_RESTORE_EXPECT`, plus the libpq `PG*` variables and `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (secret). See [backup-restore.md](backup-restore.md).

## Compose and `.env.example`

Matched to the keys above in phase 6: `.env.example` lists only keys the code reads (the unused `API_BASE_URL`, `WEB_BASE_URL`, `Email__ResendApiKey`, `Push__FcmProjectId`, `Push__FcmCredentialsJson`, `Redis__ConnectionString` and the duplicate `Jwt__SigningKey` are gone). `docker-compose.yml` gives the Web `Admin__ApiBaseUrl: http://api:8080`, its own `web-keys` key ring volume, the fixed address `172.30.57.10` on the compose network and the shared `Network__BffSharedKey`, which the API accepts from that address (`Network__BffAddress`).
