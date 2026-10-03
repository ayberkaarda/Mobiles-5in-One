# PATİKA — Product Specification

**Stack:** Swift (iOS, SwiftUI, MapKit, StoreKit 2) · ASP.NET Core (C#) · PostgreSQL + PostGIS · Razor Pages web
**Product:** Community platform for street animals — feeding-station map, "beslendi" check-ins, animal profiles, adoption listings, urgent-help posts, vet/shelter directory.
**Owner:** Ayberk (`ayberkaarda/patika`) · **Specification version:** 1.0 · **Language rule:** code, identifiers, commits, docs = English; all user-facing product copy = Turkish (tr-TR primary, en secondary).

---

## 0. Operating Contract

1. **Phase-gated delivery.** Work in the phases of §10; at the end of every phase stop, report with the §11 template and wait for Ayberk's explicit `devam`.
2. **No silent scope expansion.** Anything not in §3 is out of scope; propose it in the report.
3. **No git operations without explicit approval.** Never run `git add/commit/push/rebase/filter-repo/tag`; propose Conventional Commit messages (`feat(ios): ...`, `feat(api): ...`, `feat(web): ...`, `chore(ci): ...`).
4. **No placeholders.** No `TODO`, `FIXME`, `lorem`, `YOUR_KEY_HERE`, stubs, or fabricated real-world data. Vets/shelters (`care_places`) are seeded only as clearly labeled sample rows (`is_sample = true`, name prefixed `[ÖRNEK]`); real entries arrive via admin CSV import.
5. **Work areas have exclusive owners** (§9); cross-boundary needs go through `docs/handoffs/`.
6. **Privacy of volunteers is a product feature.** Photos are stripped of EXIF/GPS on device before upload; volunteer positions are never stored — only station/animal positions; logs round coordinates to 3 decimals.
7. **Decide, then record.** In-scope engineering choices are yours; log them in `docs/adr/`. Ask Ayberk only for scope, cost, or legal changes.
8. **Versions.** Latest stable Xcode/Swift/iOS SDK and .NET LTS (or current STS if LTS lacks a needed feature) at scaffold time; NuGet pinned with Central Package Management; resolved versions recorded in `docs/adr/0001-stack-and-versions.md`.

---

## 1. Mind Map

The sections below are the map: identity §2, scope §3, architecture §4, data and API §5, security §6, SEO/GEO §7, quality §8, work areas §9, delivery §10.

---

## 2. Corporate Identity (decided — do not re-brainstorm)

| Element         | Decision                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name            | **Patika** ("footpath"; contains _pati_ = paw)                                                                                                                                                                                                         |
| Tagline (tr)    | **Mahallenin patilerini birlikte koruyalım.**                                                                                                                                                                                                          |
| Positioning     | Sokak kedileri ve köpekleri için mahalle gönüllülerini buluşturan uygulama: mama istasyonları, besleme takibi, sahiplendirme, acil yardım, en yakın veteriner ve bakımevi.                                                                             |
| Audience        | Urban animal lovers 20–55 with iPhones in İstanbul, İzmir, Ankara; neighbourhood volunteer groups; municipalities as future partners                                                                                                                   |
| Legal name      | Patika Topluluk Teknolojileri                                                                                                                                                                                                                          |
| Domain          | `patika.app`                                                                                                                                                                                                                                           |
| Bundle id       | `app.patika.ios`                                                                                                                                                                                                                                       |
| App Store title | **Patika: Sokak Hayvanları** · subtitle **Mama istasyonu, sahiplendirme, acil yardım**                                                                                                                                                                 |
| Palette         | Turuncu Tekir `#F28C28` (primary) · Kaldırım Taşı `#3D3A36` (dark surface/text) · Nane Yeşili `#7BC8A4` (secondary: water/health) · Kar Beyazı `#FBFAF8` (surface) · Boncuk Mavisi `#2F6FED` (links) · Acil `#D64545` (urgent) · Sis `#8C8781` (muted) |
| Typography      | Display: **Nunito** (700/800) bundled · Body: **SF Pro** (system, Dynamic Type) · numerals monospaced digits for counts                                                                                                                                |
| Logo concept    | A paw print whose four toe pads trail off into a dotted path that curves upward. App icon: Kar Beyazı paw-trail on Turuncu Tekir. Deliver SVG + icon set in `brand/`.                                                                                  |
| Tone of voice   | Warm, communal "biz", dignified, never guilt-tripping: "Bugün beslendi mi?", "Bir kap su bırak", "Acil yardım gerekiyor".                                                                                                                              |
| Design tokens   | `brand/tokens.json` → Swift `PatikaDesignSystem` package (Color/Font/Spacing) and Razor CSS variables                                                                                                                                                  |

---

## 3. Product Scope (MVP) and Non-Goals

### Personas

- **Ziyaretçi:** browses map and adoption listings without an account.
- **Gönüllü:** signed in; checks in feedings, adds stations/animals/photos, posts urgent help, applies for adoption.
- **Moderatör:** reviews adoption and urgent posts, handles reports, verifies care places.

### MVP user stories

1. Sign in with Apple (required) and email + password (Argon2id) with email verification; password reset by email; anonymous browsing of map and listings.
2. Map (MapKit): feeding stations as clustered annotations; filters (kedi/köpek, mama/su, "mama bitti"); station detail: photos, last 10 check-ins, "Beslendi" button (optional photo, optional note), "Mama bitti" flag with auto-clear on next feeding.
3. Add station (location by pin drop or current position, type, photo). Edits by creator or moderators.
4. Animal profiles: species, name, sex, sterilized/vaccinated/ear-tagged flags, status (`healthy|injured|missing|adopted|deceased`), photos, linked station or free position; "Takip et" to receive updates; sighting log ("Bugün gördüm").
5. Adoption listings: from an animal profile; description, requirements, district; moderation queue before publish; requester sends a message via a form; poster sees requests in "İstekler" and replies through their own channel (phone shared only if the poster typed it into the reply). Listing auto-closes after 60 days or on "Sahiplendirildi".
6. **Acil Yardım:** injured/sick animal post with location, photo, category; geofenced push to volunteers within 2 km who opted in (cap 500 devices/post, 3 posts/user/day); moderator can close/escalate; directory of nearest vets and shelters (`care_places`, admin-curated, "24 saat" flag, phone, hours, distance).
7. Volunteer profile: display name, district, feedings count, badges ("İlk besleme", "100 besleme"); no leaderboards that shame.
8. Push notifications (APNs, token-based): urgent posts nearby (opt-in radius), replies to adoption requests, followed-animal updates.
9. Offline: SwiftData cache of stations/animals for last viewed region; outbox for check-ins; sync on reconnect.
10. **Patika Destekçi** (StoreKit 2 auto-renewable, monthly/yearly): supporter badge, no upsell banners, larger photo quota; revenue funds servers. Entitlement decided server-side from verified transactions + App Store Server Notifications.
11. Account deletion in-app and on web (`/hesap-silme`).
12. Web (Razor Pages): marketing, public adoption listings, station/district pages, care-place directory, guides, legal pages, impact page with real numbers, admin/moderation area.

### Non-goals

- Donations to individuals or any money flow besides the Destekçi subscription; live chat; Android (v2); vet appointment booking; real-time animal tracking devices; leaderboards; ads.

---

## 4. Architecture

### Repository layout

```
patika/
  ios/
    Patika.xcodeproj  (targets: Patika, PatikaTests, PatikaUITests)
    Packages/PatikaCore        models, API client, auth, sync (Swift Package)
    Packages/PatikaDesignSystem colors, fonts, components
    Packages/PatikaMap         map annotations, clustering, region cache
    Config/{Debug,Release}.xcconfig  (public base URLs only)
  src/
    Patika.Domain          entities, value objects, permissions, domain events
    Patika.Infrastructure  EF Core (Npgsql + NetTopologySuite), repositories, R2 storage, APNs, email
    Patika.Api             Minimal APIs (vertical slices under Features/), auth, rate limiting, ProblemDetails
    Patika.Web             Razor Pages: marketing, SEO pages, admin area
    Patika.Worker          BackgroundService jobs (push fan-out, deletion, reconciliation, backup verify)
    Patika.Contracts       request/response DTOs shared by Api and Web
  tests/
    Patika.UnitTests  Patika.IntegrationTests (Testcontainers)  Patika.SecurityTests
  brand/  docs/adr docs/security docs/ops docs/handoffs docs/seo docs/api
  .github/workflows  docker-compose.yml  Directory.Packages.props  Directory.Build.props
```

### iOS

- iOS 17+, SwiftUI, MVVM with `@Observable`, actors for sync/outbox; Swift 6 language mode if the toolchain is stable at scaffold (ADR-0001). Swift Package Manager only; zero third-party runtime dependencies — Sentry is the single allowed exception if ADR-0004 approves it. SwiftLint strict + SwiftFormat.
- API client models are validated against `docs/api/openapi.json` by a CI contract test.
- MapKit `Map` with clustering; `MKMapView` bridge only if SwiftUI clustering proves insufficient (ADR-0003). Core Location when-in-use only.
- Image pipeline: resize ≤ 1600 px, JPEG 0.8, metadata stripped via `CGImageDestination` (no EXIF/GPS).
- SwiftData for the region cache and the check-in outbox, flushed by `BGAppRefreshTask`. Keychain items use `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (not iCloud-synced).
- `Localizable.xcstrings`: tr default + en.

### Backend (.NET)

- Minimal APIs as vertical slices under `Features/`; FluentValidation; `AddProblemDetails`; `Microsoft.AspNetCore.RateLimiting`; Serilog JSON with a masking enricher.
- Identity: ASP.NET Core Identity is **not** used — custom user store, Argon2id via `Konscious.Security.Cryptography.Argon2`; Sign in with Apple identity-token verification (Apple JWKS, nonce); ES256 access JWT (15 min) + opaque rotated refresh tokens (30 days, hashed).
- Data: EF Core + Npgsql + NetTopologySuite (`geography(Point,4326)`, GiST indexes, `ST_DWithin`).
- Integrations: Cloudflare R2 via `AWSSDK.S3` presigned PUT; APNs via `dotAPNS` (token-based `.p8` key from env); email via Resend; `Otp.NET` for TOTP; `NetEscapades.AspNetCore.SecurityHeaders` in Web; App Store Server API + Notifications V2 with `x5c` chains validated against the Apple Root CA G3 certificate pinned at `src/Patika.Infrastructure/Apple/AppleRootCA-G3.cer`.
- Worker: `BackgroundService` + Quartz.NET cron jobs `urgent.fanout`, `deletion.hard_delete`, `subscriptions.reconcile` (daily), `backup.verify` (daily), `adoption.autoclose`, `cost.guard`.
- Web: Razor Pages SSR, no SPA; `/admin` area with its own cookie scheme + TOTP step-up + audit log; public pages read `Patika.Contracts` read models through application services, never the DbContext.
- Deployment: multi-stage Docker behind Caddy/Cloudflare; `docker-compose.yml` for local (Postgres 16 + PostGIS, MinIO, api, web, worker). Hosting decided in ADR-0002.

---

## 5. Data Model and API Surface

### Tables (EF Core migrations; ids UUIDv7; `created_at/updated_at`)

`users` (email unique nullable-if-apple, email_verified_at, password_hash nullable, apple_sub unique nullable, display_name, district, role `User|Trusted|Moderator|Admin`, urgent_opt_in boolean, urgent_radius_m, totp_secret_enc nullable, deactivated_at) · `refresh_tokens` · `email_tokens` · `stations` (location geography, kind `Food|Water|Both`, species `Cat|Dog|Mixed`, photo_key, created_by, status `Active|NeedsRefill|Removed`, last_fed_at, feedings_count) · `feedings` (station_id, user_id nullable-after-deletion, at, photo_key nullable, note) · `animals` (station_id nullable, location geography, species, name, sex, sterilized, vaccinated, ear_tagged, status, created_by) · `animal_photos` (animal_id, key, created_by, moderation_state) · `sightings` (animal_id, user_id, at, note) · `follows` (user_id, animal_id unique) · `adoption_posts` (animal_id, description, requirements, district, state `Pending|Published|Rejected|Closed`, closes_at, created_by) · `adoption_requests` (post_id, requester_id, message, reply, state) · `urgent_posts` (location, category `Injured|Sick|Trapped|Other`, description, photo_key, state `Open|Handled|Closed`, created_by, notified_count) · `care_places` (name, kind `Vet|Shelter|MunicipalCare`, location, address, phone, hours_json, open_24h, verified, is_sample) · `device_tokens` (user_id, token unique, environment, last_seen_at) · `subscriptions` (user_id, original_transaction_id_hash, product_id, status, expires_at, environment, last_notification_uuid) · `app_store_notifications` (notification_uuid unique, type, subtype, received_at, processed_at) · `reports` (target_type, target_id, reporter_id, reason, state) · `audit_logs` · `deletion_requests` · `rate_limit_notes` (documentation only — limiter is in-memory per instance; multi-instance uses Redis if ADR-0002 selects horizontal scaling).

### API (`/v1`, JSON, RFC 9457)

`POST auth/register · POST auth/login · POST auth/apple · POST auth/refresh · POST auth/logout · POST auth/verify-email · POST auth/forgot · POST auth/reset · GET me · PATCH me · DELETE me · PUT me/device-token · PUT me/urgent-settings`
`GET stations?bbox=&kind=&species=&needsRefill= (max 500, paged) · POST stations · GET|PATCH stations/{id} · POST stations/{id}/feedings · POST stations/{id}/needs-refill`
`GET animals?bbox= · POST animals · GET|PATCH animals/{id} · POST animals/{id}/photos · POST animals/{id}/sightings · PUT animals/{id}/follow · DELETE animals/{id}/follow`
`GET adoptions?district=&species= · POST animals/{id}/adoption · GET adoptions/{id} · PATCH adoptions/{id} (owner close) · POST adoptions/{id}/requests · GET adoptions/{id}/requests (owner) · PATCH adoptions/{id}/requests/{rid}`
`GET urgent?near=lat,lng&radius= · POST urgent · PATCH urgent/{id}`
`GET care-places?near=&kind=&open24h=`
`POST uploads/presign (kind=station|animal|feeding|urgent)`
`POST reports`
`POST subscriptions/verify (signed transaction JWS from StoreKit 2)` · `POST webhooks/appstore`
`GET|POST|PATCH admin/** (Moderator|Admin + TOTP step-up)`
OpenAPI generated with Swashbuckle to `docs/api/openapi.json` (CI enforces up-to-date).

---

## 6. Security — the 23-item checklist, mapped to this stack

Each item names its evidence; the final matrix (`docs/security/verification-matrix.md`) cites it.

1. **Anahtarları çıkar.** iOS ships no secrets (assume the IPA is readable): `.xcconfig` holds only `API_BASE_URL`, no third-party keys. Backend secrets come from environment / `dotnet user-secrets` only; `appsettings*.json` contain none; `.env*`, `*.p8`, `*.p12`, `*.mobileprovision` gitignored; gitleaks pre-commit + CI. Verify: gitleaks clean; grep for `BEGIN PRIVATE KEY|AuthKey_` empty.
2. **.env'i geçmişten sil.** `docs/security/history-purge-runbook.md`: `git filter-repo` commands for `.env`, `*.p8`, `*.p12`, `appsettings.Production.json` plus the rotation list (DB password, JWT keys, R2 keys, APNs key, Resend key, App Store Server API key, TOTP encryption key). Not executed — requires Ayberk. Verify: runbook + CI history scan.
3. **İzin kurallarını yaz.** `src/Patika.Domain/Security/Permissions.cs` (static matrix) + `docs/security/authorization-matrix.md`: `Guest` read public · `User` create stations/animals/feedings/urgent, own edits, adoption requests · `Trusted` (after 25 verified feedings) edit any station · `Moderator` moderation queue, close posts, verify care places · `Admin` roles, care-place import, user actions. Resource-based handlers (`OwnerOrModeratorRequirement`). Verify: table-driven tests over every matrix cell.
4. **Yetkiyi sunucuda tut.** Resource-based authorization on the server for every mutation and query (ownership/moderation state); geofenced recipients computed server-side; iOS only hides controls. Verify: IDOR suite (`Patika.SecurityTests/IdorTests.cs`) — user A on user B's adoption post, requests, station edits → 403/404.
5. **Girişe sınır koy.** Sliding-window policies: `auth` 5/15 min per IP and per normalized email, `apple` 10/15 min per IP, `refresh` 30/min per user, global 300/min per IP; 429 + `Retry-After`; client IP from `ForwardedHeaders` with known proxies only. Verify: 6th login → 429; spoofed `X-Forwarded-For` does not bypass.
6. **Girdiyi doğrula.** Validators for every request DTO: coordinates valid and inside the Türkiye bounding box for creation, string lengths, enum membership, bbox area ≤ 400 km², radius ≤ 5 km; JSON body ≤ 1 MB; `UnmappedMemberHandling = Disallow`. Verify: negative tests per validator.
7. **Yüklemeyi sınırla.** Presigned R2 PUT with `Content-Length` 1..5 MB and `Content-Type image/jpeg|image/png|image/webp`; iOS converts HEIC → JPEG and strips metadata; worker re-encodes with ImageSharp (WebP, max 1600 px, thumbnails 320/800, metadata stripped), magic-byte check, quarantine on failure; quota 30 uploads/user/day (Destekçi 100). Verify: MIME spoof and oversize rejected; stored objects carry no EXIF.
8. **CORS'u kilitle.** No browser client in MVP → CORS off, no headers emitted; Web is same-origin SSR; a `https://patika.app` allowlist policy exists in config behind a feature flag. Verify: preflight from any origin returns no CORS headers.
9. **Güvenlik başlıkları.** Web: HSTS 2 years + includeSubDomains + preload; CSP with per-request nonce (`script-src 'self' 'nonce-…'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `img-src 'self' data: https://cdn.patika.app`); `X-Content-Type-Options`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: geolocation=(self), camera=(), microphone=()`. API: `Cache-Control: no-store`, `X-Content-Type-Options`. Verify: header assertions in integration tests.
10. **HTTPS zorunlu.** TLS terminated at Caddy/Cloudflare, redirect + HSTS behind known proxies; iOS ATS defaults (no `NSAllowsArbitraryLoads`); SPKI pinning (primary + backup pin, documented rotation date) feature-flagged, on in Release. Verify: `http://` request to the API redirects; ATS test.
11. **Şifreleri hash'le.** Argon2id m=65536 KiB, t=3, p=1, 16-byte salt; password ≥ 10 chars + HIBP k-anonymity at registration; Apple-only users have `password_hash = NULL` and no password login; refresh/email tokens stored as SHA-256; TOTP secrets AES-256-GCM with key from env. Verify: DB shows only `$argon2id$`; constant-time login.
12. **Çerezi güvenli yap.** Admin cookie `__Host-patika.admin` (HttpOnly, Secure, SameSite=Strict, Path=/, 30 min sliding) + antiforgery on all POSTs; iOS: refresh token in Keychain, access token in memory, refresh rotation with reuse detection; tokens wiped on sign-out/deletion. Verify: cookie attribute tests; refresh reuse revokes the family.
13. **Hata mesajını kıs.** Error bodies carry only a generic `title`, a machine `code` and `traceId` (API and Razor alike, no developer page outside Development); iOS maps `code` → Turkish strings. Verify: forced 500 returns only the generic body + `traceId`.
14. **Logları temizle.** Masking enricher: emails → `a***@d***`, coordinates rounded to 3 dp, no bodies for `/auth/*` and `/uploads/*`, `Authorization`/`Cookie` dropped, tokens never logged; request id in every line; retention 30 days documented; iOS `OSLog` with `%{private}` for user data; Sentry `beforeSend` scrub if enabled. Verify: log sample from register + feeding + urgent flows contains no email/token/precise coordinate.
15. **Sorguyu parametrele.** EF Core LINQ; `FromSqlInterpolated`/interpolated `FromSql` allowed, `FromSqlRaw`/`ExecuteSqlRaw` banned via `BannedSymbols.txt`; spatial predicates through NetTopologySuite. Verify: build fails on banned symbols.
16. **XSS'e karşı kaçır.** `Html.Raw` banned for user content (analyzer + review checklist); CSP nonce; control characters stripped server-side; iOS renders user text with `Text` only (no `WKWebView`, no attributed HTML). Verify: stored `<script>` in an adoption description renders as text on web and iOS.
17. **Webhook imzası.** `POST /v1/webhooks/appstore` (Notifications V2): verify the `signedPayload` JWS chain to the pinned Apple Root CA G3, ES256 signature, `bundleId = app.patika.ios`, `environment`, and the nested `signedTransactionInfo`/`signedRenewalInfo` the same way; idempotent by `notificationUUID` (unique index); respond 200 within 2 s, process in worker. `POST subscriptions/verify` verifies the StoreKit 2 transaction JWS identically and calls App Store Server API `Get Transaction Info` before granting entitlement; daily `subscriptions.reconcile`. Verify: tampered payload, wrong chain, wrong bundle id, replayed UUID, sandbox/production mismatch all rejected.
18. **Admin'e rol koy.** Roles `User|Trusted|Moderator|Admin`; `/admin`: password + TOTP login, step-up every 15 min for destructive actions; moderation queue (adoption/urgent/photos/reports), care-place import, role management (Admin only); every action → `audit_logs`; moderators cannot delete users or read emails. Verify: role matrix tests; audit assertions; admin e2e.
19. **Paketleri denetle.** CI: `dotnet list package --vulnerable --include-transitive` fails on High/Critical; Central Package Management; Dependabot (`nuget`, `github-actions`, `swift`); `dotnet-outdated` report; CycloneDX SBOM; iOS dependency count zero (or one, per ADR-0004). Verify: workflow + report artifact.
20. **Otomatik yedek.** `docs/ops/backup-restore.md`; `ops/backup/backup.sh` (`pg_dump -Fc` daily, `age`-encrypted, separate write-only R2 bucket, 30-day lifecycle); PITR via `pgBackRest` when self-hosted or managed PITR (ADR-0002); R2 versioning on the photo bucket; worker `backup.verify` alerts on a stale backup; weekly `restore-drill.yml` restores the latest dump into a Postgres+PostGIS container and runs spatial smoke queries. Verify: drill output.
21. **Hesabı gerçekten sil.** `Ayarlar → Hesabımı sil` (App Store Review Guideline 5.1.1(v)) and `patika.app/hesap-silme`: re-auth → immediate deactivation (tokens revoked, device tokens deleted, follows removed, open adoption posts closed) → 7-day grace (sign-in cancels) → worker `deletion.hard_delete` removes PII rows and the user's R2 photos; feedings/sightings anonymized (`user_id = NULL`) to keep station history; `original_transaction_id_hash` retained 90 days for refund/fraud handling, then purged; confirmation email; audit row without PII. Verify: e2e test asserts no residual PII rows.
22. **Harcama uyarısı kur.** `docs/ops/cost-alerts.md` (hosting budget, DB size, R2 storage/egress, Resend volume, Sentry quota; APNs is free); application caps: urgent fan-out ≤ 500 devices/post, 3 urgent posts/user/day, presign quota, bbox limits; worker `cost.guard` counts daily pushes/emails and pauses non-critical sends above caps with an alert email. Verify: doc + guard tests.
23. **Saldırgan gibi dene.** `docs/security/threat-model.md` (STRIDE: fake feeding spam, volunteer location leaks via photos/logs, IDOR on adoption requests, adoption scams, abusive content, subscription forgery, notification replay, token theft on jailbroken devices, moderation privilege escalation); `tests/Patika.SecurityTests` attack suite (IDOR matrix, rate-limit bypass via spoofed headers, JWT tampering, refresh reuse, oversized bodies, MIME spoof, EXIF leak, webhook forgery/replay, CSRF on admin POST, admin without TOTP); OWASP ZAP baseline (Web) + API scan (`openapi.json`) in CI; MobSF scan of the IPA + manual checks (ATS, Keychain accessibility, no debug logs); `docs/security/pentest-report.md` with fixes and retest. Verify: report present; findings closed or accepted with reason.

---

## 7. SEO and GEO (web = `src/Patika.Web` Razor Pages)

### Information architecture

`/` · `/sahiplendirme` · `/sahiplendirme/[il]` · `/sahiplendirme/[il]/[ilce]` · `/sahiplendirme/[slug]` (`noindex` once closed) · `/istasyonlar/[il]/[ilce]` (station lists with counts and last-fed times) · `/bakim-yerleri/[il]` and `/bakim-yeri/[slug]` (vets/shelters with `VeterinaryCare`/`AnimalShelter` JSON-LD) · `/rehber/[slug]` (guides: "Sokak kedisi nasıl beslenir", "Yaralı kedi veya köpek bulursam ne yapmalıyım", "Kısırlaştırma nerede yapılır", "Kışın sokak hayvanları için barınak", "Sahiplendirme öncesi kontrol listesi") · `/etki` (impact: real counts from DB — stations, feedings, adoptions) · `/hakkinda` · `/sss` · `/gizlilik` · `/kvkk-aydinlatma` · `/hesap-silme` · `/iletisim` · `/admin/**` (`noindex`, disallowed).

### Technical SEO

- Turkish title ≤ 60 / description ≤ 155 per page; `hreflang` `tr-TR` + `en` + `x-default`; sitemap index + chunked sitemaps (adoptions, districts, care places, guides) built from DB with honest `lastmod`.
- OG/Twitter image per adoption post rendered server-side with ImageSharp (animal photo + brand frame).
- JSON-LD: `Organization`, `MobileApplication` (iOS, `applicationCategory: SocialNetworkingApplication`), `VeterinaryCare`/`AnimalShelter` for care places, `BreadcrumbList`, `FAQPage` on `/sss`, `Article` on guides.
- `OutputCache` 5 min on public pages; Lighthouse CI budgets ≥ 90.
- App linking: `/.well-known/apple-app-site-association` with `applinks` paths `/sahiplendirme/*`, `/s/*`, `/a/*`, `/acil/*`; Smart App Banner meta with `app-argument`; iOS Associated Domains `applinks:patika.app`; universal link routing in the app scene.

### GEO

- `/llms.txt` + `/llms-full.txt`; answer-first 40–60 word definitional paragraph on every page ("Patika, sokak hayvanları için…"); `/sss` with 15 Turkish Q&A pairs mirrored in JSON-LD; consistent entity facts across `/hakkinda`, `llms.txt`, JSON-LD; `/etki` presents quotable, dated statistics with a methodology note; guides structured with H2 questions and short quotable answers; honest `dateModified`.

### ASO (`docs/seo/aso.md`)

Title "Patika: Sokak Hayvanları"; subtitle "Mama istasyonu, sahiplendirme, acil yardım"; keyword field (tr): sokak kedisi, sokak köpeği, mama istasyonu, sahiplendirme, kedi sahiplen, köpek sahiplen, hayvan gönüllü, yaralı hayvan; en secondary; 6 screenshots with Turkish captions. App Privacy labels must match the implementation exactly: Location — precise only at the moment of creating a station, urgent post or check-in and never stored as a user attribute, approximate for volunteer settings; Photos (user content); Contact info (email).

---

## 8. Quality, Testing, CI, Observability

- iOS: unit tests for models, API client (URLProtocol stubs), image pipeline (EXIF-stripped assertion), outbox/sync actor; XCUITest smoke flows (browse map, sign in, feeding check-in, adoption request, delete account); `performAccessibilityAudit`; localization completeness test (tr/en keys).
- .NET: xUnit + FluentAssertions; integration tests on Testcontainers (Postgres + PostGIS, MinIO); architecture tests (NetArchTest: Domain has no infra deps, Web never references DbContext); OpenAPI contract test against the committed `docs/api/openapi.json`.
- CI (`.github/workflows/ci.yml`): macOS job (`xcodebuild test` on simulator, SwiftLint), Ubuntu job (dotnet build/test, vulnerable-package check, gitleaks, ZAP on the compose stack, Lighthouse CI on Web). `testflight.yml` on manual dispatch (fastlane `pilot`) — a release action, still not a git action.
- Observability: Serilog JSON + request ids; Sentry .NET (scrubbed); iOS crash reporting per ADR-0004; `GET /health` (no details) and `/health/ready` internal.
- Accessibility: VoiceOver labels on all annotations/buttons, Dynamic Type up to XXL, contrast ≥ 4.5:1; Turkish first.

---

## 9. Work Ownership and Repository Conventions

| Owner      | Owns (exclusive write)                                                                                                                                               | Reads                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `lead`     | `docs/adr/**`, `docs/handoffs/**`, `docs/api/**`, `brand/**`, `src/Patika.Contracts/**`, `CONTRIBUTING.md`, root configs, `docker-compose.yml`, `Directory.*.props`  | everything                       |
| `api`      | `src/Patika.Api/**`, `src/Patika.Domain/**`, `src/Patika.Infrastructure/**`, `src/Patika.Worker/**`, `tests/Patika.IntegrationTests/**`, `tests/Patika.UnitTests/**` | contracts, ADRs                  |
| `ios`      | `ios/**`                                                                                                                                                             | `docs/api/openapi.json`, brand   |
| `web`      | `src/Patika.Web/**`, `docs/seo/**`                                                                                                                                   | contracts, brand                 |
| `security` | `docs/security/**`, `tests/Patika.SecurityTests/**`, `.github/workflows/security.yml`, `ops/backup/**`                                                               | everything (read-only elsewhere) |
| `qa`       | `ios/PatikaUITests/**`, `.github/workflows/ci.yml`, `.github/workflows/testflight.yml`                                                                               | everything                       |

Handoffs via `docs/handoffs/<from>-to-<to>-<NNN>.md`; contract changes flow through `lead`; git follows §0.3.

---

## 10. Delivery Phases and Gates

Each phase ends with stop → report (§11) → wait for `devam`.

**Phase 0 — Foundation.** Solution + projects, Xcode project + packages, `CONTRIBUTING.md` (§13), ADR-0001 (stack/versions), ADR-0002 (hosting/scaling), ADR-0003 (map clustering approach), ADR-0004 (iOS third-party policy), `brand/` tokens/logo/icons, `docker-compose.yml` (Postgres+PostGIS, MinIO, api, web, worker), CI skeleton, authorization matrix draft, threat-model outline, `.env.example`. Gate: `dotnet build` and `xcodebuild build` succeed.

**Phase 1 — API core + auth + security baseline (items 1, 3–6, 8–15).** EF model + migrations + spatial indexes, sample `[ÖRNEK]` seeds, auth (email, Apple, refresh rotation), rate limiting, validation, headers, ProblemDetails, masked logging, permissions + resource handlers with matrix tests, IDOR harness. Gate: tests green.

**Phase 2 — Domain API + media + push (items 7, 21 partial).** Stations, feedings, animals, photos, sightings, follows, adoption posts/requests, urgent posts with geofenced fan-out, care places + admin CSV import, presign + post-processing, reports, device tokens, deletion request flow, OpenAPI export. Gate: integration tests; worker jobs demonstrated.

**Phase 3 — iOS app.** Design system, map with clustering and filters, station/animal/adoption/urgent flows, image pipeline with metadata stripping, offline cache + outbox, auth, profile, notifications, settings + deletion, universal links, localization. Gate: XCUITest smoke green on simulator; SwiftLint clean.

**Phase 4 — Web SEO/GEO + admin (§7, item 18).** Public pages, programmatic district/care-place pages, guides (5 Turkish articles ≥ 600 words), legal pages, impact page, sitemap/robots/JSON-LD/hreflang/OG generation, AASA, `llms.txt`, admin/moderation area with TOTP and audit, Lighthouse CI. Gate: Lighthouse ≥ 90 on 5 pages; JSON-LD validates; admin e2e.

**Phase 5 — Destekçi subscription + App Store notifications (item 17).** StoreKit 2 products, paywall (tr copy), transaction verification endpoint, notifications webhook with JWS chain validation, reconciliation job, entitlement gating (quota, badge). Gate: webhook and entitlement tests green; sandbox flow documented.

**Phase 6 — Hardening and release readiness (items 2, 16, 19, 20, 22, 23 + matrix).** Attack suite, including the item-16 stored-XSS payload sweep over every rendering surface (item 16 `Verify`; the lint, template and CSP bans from the security baseline stay in place), ZAP, MobSF/IPA checks, vulnerable-package gate, backups + restore drill, cost alerts + `cost.guard`, history-purge runbook, ASO doc + App Store copy (tr/en), privacy labels mapping, final 23-item verification matrix. Gate: final report.

---

## 11. Report Template (use verbatim at every gate)

```
# Patika — Phase <N> Report
## Summary (5 lines max)
## Files created / modified (grouped by owner, full paths)
## Decisions & ADRs added
## Security checklist status
| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
## SEO/GEO status (Phase 4+)
## Tests executed (command + result counts)
## Known gaps / risks
## Open questions / proposals (scope, cost, legal)
## Proposed Conventional Commits (not executed)
## Next phase preview (3 lines)
STOPPED — waiting for "devam".
```

---

## 12. Definition of Done (final)

- 23/23 items **done** with evidence; SEO/GEO checklist complete; every MVP story demonstrable (XCUITest + integration tests).
- No placeholders (CI grep `TODO|FIXME|lorem|YOUR_`); no `FromSqlRaw`; no third-party iOS runtime deps beyond ADR-0004.
- `dotnet test` green; vulnerable packages High/Critical = 0; `gitleaks` clean; SwiftLint clean; Lighthouse budgets met.
- Docs: ADRs, authorization matrix, threat model, pentest report, backup/restore runbook, cost alerts, ASO, App Store copy, KVKK texts (aydınlatma metni covering location and photo processing).
- Release: signing configuration documented (no certificates in repo), TestFlight workflow, Docker images, Caddy config.

---

## 13. `CONTRIBUTING.md` to create in Phase 0

Write it in full; it restates for contributors: the language rule (header), phase discipline and gates (§0.1, §10), the git rule (§0.3), the privacy rules (§0.6), the placeholder and `[ÖRNEK]` sample rule (§0.4), the ownership table and handoff path (§9), the 23-item checklist as a hard requirement with `docs/security/verification-matrix.md` maintained, parallel work only on disjoint ownership sets, the env rule (backend secrets via environment/user-secrets only; iOS via `Config/*.xcconfig` public values only; keys documented in `docs/ops/env.md`), and the commands: `dotnet build | dotnet test | dotnet run --project src/Patika.Api | docker compose up`; iOS: `xcodebuild -scheme Patika test -destination 'platform=iOS Simulator,name=iPhone 15'`; `swiftlint`.
