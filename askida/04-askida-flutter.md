# ASKIDA — Product Specification

**Stack:** Flutter (iOS + Android) · Laravel (PHP) · PostgreSQL + PostGIS · Redis/Horizon · iyzico marketplace payments
**Product:** Pay-it-forward network built on the Turkish "askıda ekmek" tradition — donors prepay everyday items at verified local shops; recipients collect anonymously with a one-time code.
**Owner:** Ayberk (`ayberkaarda/askida`) · **Specification version:** 1.1 · **Language rule:** code, identifiers, commits, docs = English; all user-facing product copy = Turkish (tr-TR primary, en secondary).

---

## 0. Operating Contract

1. **Phase-gated delivery.** Work in the phases of §10; at the end of every phase stop, report with §11 and wait for Ayberk's explicit `devam`.
2. **No silent scope expansion.** Anything not in §3 is out of scope; propose it in the report.
3. **No git operations without explicit approval.** Propose Conventional Commit messages (`feat(app): ...`, `feat(api): ...`, `feat(web): ...`, `chore(ci): ...`) in the report instead.
4. **No placeholders** (`TODO`, `FIXME`, `lorem`, `YOUR_KEY_HERE`, stubs, fabricated shops). Shops exist only through merchant registration + admin verification; development seeds are `is_sample = true`, name-prefixed `[ÖRNEK]`.
5. **Work areas have exclusive owners** (§9); cross-boundary needs go through `docs/handoffs/`.
6. **Dignity and anonymity are product invariants.** Recipients never create accounts, are never shown to donors or merchants by identity, are never rated, and no precise recipient location is stored. Copy never uses "muhtaç"/"fakir"; it says "askıdan al".
7. **Money is integer minor units (kuruş) in `int`/`BIGINT`, currency `TRY`.** The platform never holds funds: payments flow donor → iyzico → merchant sub-merchant payout; the platform books only its commission.
8. **Decide, then record.** In-scope engineering choices are yours; log them in `docs/adr/`. Ask Ayberk only for scope, cost, or legal changes.
9. **Versions.** Latest stable at scaffold time, with floors: Flutter 3 / Dart 3, Laravel 11, PHP 8.3, Filament 3, PostgreSQL 16; pin via `pubspec.lock`/`composer.lock`; record resolved versions in `docs/adr/0001-stack-and-versions.md`.

---

## 1. Mind Map

The overview map is folded into the sections below: identity (§2), MVP (§3), architecture (§4), security (§6), SEO/GEO (§7), quality (§8), work areas (§9), delivery (§10).

---

## 2. Corporate Identity (decided — do not re-brainstorm)

| Element                    | Decision                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                       | **Askıda** ("on the hook", from _askıda ekmek_)                                                                                                                                                            |
| Tagline (tr)               | **İyilik askıda kalmasın.**                                                                                                                                                                                |
| Positioning                | Fırından lokantaya, kırtasiyeden manava; mahalle esnafında askıya bırakılan ekmeği, çorbayı, defteri ihtiyacı olanın soru sorulmadan aldığı iyilik ağı.                                                    |
| Audience                   | Donors 20–45 in cities; merchants (fırın, lokanta, kırtasiye, manav, kahvehane); recipients: anyone, anonymously                                                                                           |
| Legal name                 | Askıda İyilik Teknolojileri                                                                                                                                                                                |
| Domain                     | `askida.app`                                                                                                                                                                                               |
| Application id / bundle id | `app.askida.mobile`                                                                                                                                                                                        |
| Store title                | **Askıda: Askıda Ekmek & İyilik**                                                                                                                                                                          |
| Palette                    | Ekmek Kabuğu `#C8763A` (primary) · Zeytin `#4E6B3A` (secondary) · Un Beyazı `#FBF8F3` (surface) · Kömür `#2B2B2B` (text) · Gün Batımı `#E9A23B` (accent) · Deniz `#2C6E91` (info) · Nar `#B23A48` (danger) |
| Typography                 | Display: **Fraunces** (600/700, warm serif) · Body: **Nunito Sans** (400/600); both bundled as Flutter assets and self-hosted on web (no runtime font fetching)                                            |
| Logo concept               | A monoline bread loaf hanging from a hook; the hook's curve doubles as the tail of the letter "a". Icon: Un Beyazı loaf-and-hook on Ekmek Kabuğu. Deliver SVG + icon sets in `brand/`.                     |
| Tone of voice              | Warm, dignified, plain: "Askıya bırak", "Askıdan al", "Bugün 12 çorba askıda". Never pitying, never charity-poster sentimentality.                                                                         |
| Design tokens              | `brand/tokens.json` → Flutter `ThemeData` (`app/lib/design/theme.dart`) and Tailwind config for Blade                                                                                                      |

---

## 3. Product Scope (MVP) and Non-Goals

### Personas and app modes (one Flutter app, three modes)

- **Bağışçı (donor):** account; browses verified shops; prepays items; sees anonymous impact.
- **Esnaf (merchant):** account with shop; verification; item catalog; redeems codes; sees payouts.
- **Alan (recipient):** **no account**; anonymous device identity; picks a nearby shop with available items; gets a one-time code.

### MVP user stories

1. Donor/merchant auth: email + password (verification email), Sign in with Apple and Google (both, because iOS requires Apple when Google is offered); password reset.
2. Merchant onboarding: shop name, type, address + map pin, phone, tax number, up to 3 verification documents (vergi levhası, işletme belgesi), IBAN for iyzico sub-merchant; state `Pending → Verified | Rejected`; only verified shops are visible.
3. Merchant catalog: items with name, category (`ekmek|corba|yemek|kirtasiye|bebek|diger`), price (kuruş), daily redeem cap per item (fairness), active flag.
4. Donor flow: shop list/map sorted by distance; choose item + quantity (1–20); pay via iyzico Checkout Form inside an in-app WebView pointed at our backend page; on success, `hooks` units are created (`AVAILABLE`); receipt email; donation history; per-transaction cap ₺2 000, per-donor-day cap ₺5 000.
5. Recipient flow: anonymous mode from the first screen ("Askıdan al"); device attestation (Play Integrity on Android, DeviceCheck on iOS via platform channels) binds an `anon_id`; sees shops with available items (counts only) within 3 km by default, 5 km maximum; taps "Askıdan al" on an item → 8-character code, valid 10 minutes, shown as text + QR; daily cap 2 units per `anon_id`, 1 per shop per day; no history stored beyond 30 days of aggregate counters.
6. Redemption: merchant scans QR or types code → server validates (hash, expiry, shop match, unit still `RESERVED`) inside a transaction with row lock → `REDEEMED`; merchant sees only "1 ekmek verildi"; donor gets an anonymous push "Askın alındı".
7. Payout ledger: merchant sees donations, redeemed counts, and iyzico settlement status (read from provider data); platform commission shown transparently.
8. Impact: public district-level counters (donated, redeemed, shops) updated hourly; in-app donor impact card.
9. Push: merchant "Yeni askı", donor "Askın alındı" (FCM/APNs through `firebase_messaging` — Firebase config files are public by design but restricted in the Firebase console; decide alternatives in ADR-0004).
10. Account deletion in-app and on web (`/hesap-silme`); anonymous "Verilerimi sıfırla" wipes the `anon_id`.
11. Web (Blade SSR): marketing, how-it-works pages for each persona, verified-shop directory (with merchant consent), impact page, guides, legal pages, Filament admin.

### Non-goals

- Cash donations to individuals; recipient accounts or profiles; chat; ratings of recipients; pharmacy/medical items; multi-currency; delivery; ads; corporate donor invoicing portal (v2).

---

## 4. Architecture

### Repository layout

```
askida/
  app/                       Flutter
    lib/{core,design,features/{auth,donor,merchant,recipient,impact,settings},data,routing}
    android/ (Kotlin: Play Integrity channel)   ios/ (Swift: DeviceCheck channel)
    integration_test/  test/
  server/                    Laravel
    app/{Domain,Http/{Controllers/Api,Controllers/Web,Requests,Middleware,Resources},Policies,Jobs,Services,Filament,Support}
    database/{migrations,seeders,factories}  routes/{api.php,web.php}  resources/{views,css,js}
    tests/{Feature/Api,Feature/Web,Feature/Admin,Security,Unit}
  brand/  docs/adr docs/security docs/ops docs/handoffs docs/seo docs/api
  .github/workflows  docker-compose.yml
```

### Flutter app

- Packages: Riverpod (generator), go_router (typed routes, mode-aware shell), `dio` (auth + request-id interceptors), `freezed` + `json_serializable`, `drift` (offline cache of shops/items and merchant redemption log), `flutter_secure_storage`, `mobile_scanner`, `qr_flutter`, `flutter_map` with a keyless tile source chosen in ADR-0003 (self-hosted PMTiles via `flutter_map_pmtiles` if usage policy requires), `geolocator` (when-in-use; recipients use coarse city-level location by default), `webview_flutter` for the payment page only (navigation allowlist: `https://askida.app/pay/*` and iyzico hosts), `intl` + ARB (tr default, en), `very_good_analysis`.
- Platform channel `askida/attest`: Android Play Integrity request token, iOS DeviceCheck token.
- Config via `--dart-define-from-file=env/{dev,prod}.json` (gitignored; `env/example.json` committed) carrying only `API_BASE_URL`.

### Laravel server

- Sanctum personal access tokens per device with abilities (`donor`, `merchant`, `anon`); `bepsvpt/secure-headers`; `spatie/laravel-permission` (admin roles); Filament 3 panel at `/admin` with mandatory TOTP (Fortify two-factor); `spatie/laravel-activitylog`, `spatie/laravel-backup`, `spatie/laravel-sitemap`, `spatie/laravel-responsecache`; Horizon + Redis queues; PostGIS via `ST_DWithin` with bindings; Flysystem S3 on Cloudflare R2 (private disk for documents); Intervention Image; Resend mail; Larastan level 8, Pint, Pest.
- iyzico: Checkout Form token created server-side; sub-merchant (`pazaryeri`) onboarding for shops; payment callback + signed webhook; daily reconciliation via `retrieve` API. PayTR is the recorded fallback provider in ADR-0002 (same interfaces via `PaymentGateway` contract).
- Attestation verification: Play Integrity token decoded with Google's API (service account from env), DeviceCheck token validated with Apple's `validate_device_token` (JWT signed with the `.p8` key from env); results cached per `anon_id` for 30 days.
- Deployment: Docker (php-fpm + nginx + horizon + scheduler) behind Caddy/Cloudflare; `docker-compose.yml` for local (Postgres+PostGIS, Redis, MinIO, mailpit). Hosting in ADR-0002.

---

## 5. Data Model and API Surface

### Tables (migrations; ids UUIDv7; money `BIGINT` minor units)

`users` (email, email_verified_at, password nullable, apple_sub, google_sub, name, kind `donor|merchant`, deactivated_at) · `shops` (owner_id, name, slug, type, address, il, ilce, location geography, phone, tax_number_enc, iban_enc, sub_merchant_key, verification_state, verified_at, listed_on_web boolean, is_sample) · `shop_documents` (shop_id, kind, path (private disk), mime, size, reviewed_at) · `shop_members` (shop_id, user_id, role `owner|staff`) · `items` (shop_id, name, category, price_minor, daily_cap, active) · `donations` (donor_id nullable-after-deletion, shop_id, item_id, qty, amount_minor, commission_minor, provider, provider_payment_id, provider_token, status `initiated|paid|failed|refunded`, paid_at) · `hooks` (donation_id, shop_id, item_id, status `AVAILABLE|RESERVED|REDEEMED|EXPIRED`, anon_id nullable, code_hash nullable, reserved_at, expires_at, redeemed_at, redeemed_by_user_id) · `anon_devices` (anon_id unique, platform, attested_at, attestation_verdict, banned_at, last_seen_at) · `anon_daily_counters` (anon_id, day, count, per_shop jsonb) · `payment_events` (provider, event_id unique, payload_hash, received_at, processed_at) · `payouts` (shop_id, provider_settlement_id, amount_minor, status, period) · `impact_snapshots` (il, ilce, day, donated, redeemed, shops) · `device_push_tokens` · `personal_access_tokens` (Sanctum) · `activity_log` · `deletion_requests` · `kvkk_consents` (user_id, text_version, accepted_at, ip_hash).

### API (`/api/v1`, JSON, RFC 9457 problem details)

`POST auth/register · POST auth/login · POST auth/apple · POST auth/google · POST auth/logout · POST auth/verify-email · POST auth/forgot · POST auth/reset · GET me · PATCH me · DELETE me · PUT me/push-token`
`POST anon/attest (platform, token) → anon session token · DELETE anon/me`
`GET shops?near=lat,lng&radius=3000&hasAvailable=1 · GET shops/{slug} · POST shops (merchant) · PATCH shops/{id} · POST shops/{id}/documents/presign · POST shops/{id}/items · PATCH shops/{id}/items/{itemId}`
`POST donations (shop_id, item_id, qty) → checkout page URL · GET donations (mine) · GET donations/{id}`
`POST hooks/reserve (anon; shop_id, item_id) → code · POST shops/{id}/redeem (merchant; code) · GET shops/{id}/redemptions?day=`
`GET shops/{id}/payouts (merchant owner)`
`GET impact?il=&ilce=`
`POST webhooks/iyzico` · `GET|POST pay/{token} (web page for WebView) · POST pay/callback`
Admin is Filament (web), not JSON.
OpenAPI 3.1 maintained at `docs/api/openapi.yaml` (hand-written from Form Requests + Resources, validated by a Pest contract test using `league/openapi-psr7-validator`).

---

## 6. Security — the 23-item checklist, mapped to this stack

Item numbers are referenced by §10 and the final verification matrix (§12). Each item lists the project-specific decision and what counts as evidence.

1. **Anahtarları çıkar.** Flutter binary carries only `API_BASE_URL` and the Firebase client config; iyzico keys, Apple `.p8`, Google service account and `APP_KEY` live only in server environment, read through `config/*.php` (no `env()` outside config); secret-file handling per ADR-0004; `gitleaks` in `lefthook` pre-commit + CI. Evidence: `gitleaks detect` clean; greps for `BEGIN PRIVATE KEY`, `AKIA`, `iyzico`+`secret` empty.
2. **.env'i geçmişten sil.** `docs/security/history-purge-runbook.md`: `git filter-repo` targets (env, key and service-account files) and the rotation list (`APP_KEY` with a re-encryption plan for `tax_number_enc`/`iban_enc`, DB, Redis, R2, iyzico, Resend, Apple key, Google SA). **Not executed** without Ayberk's approval. Evidence: runbook + CI history scan.
3. **İzin kurallarını yaz.** Policies for Shop, Item, Donation, Hook, Payout + admin Gates, backed by `docs/security/authorization-matrix.md` with roles `donor`, `merchant_owner`, `merchant_staff` (redeem + view redemptions only), `anon` (reserve only, own `anon_id`), `moderator`, `finance`, `admin`; Sanctum token abilities mirror roles. Evidence: table-driven Pest tests over every cell.
4. **Yetkiyi sunucuda tut.** Every controller action authorizes; redemption is validated only server-side (code hash + expiry + shop match + `SELECT … FOR UPDATE` on the hook row + unique `REDEEMED` transition); Flutter hides UI by mode only. Evidence: IDOR suite across donors, shops and anon ids, including a parallel double-reserve test.
5. **Girişe sınır koy.** `auth` 5/min per IP and per email, lockout 15 min after 10 failures; `anon/attest` 3/day per device; `hooks/reserve` 5/hour per `anon_id` and 60/hour per IP; `redeem` 30/min per shop; `Retry-After` on 429; trusted proxies configured. Evidence: negative test per limiter; spoofed `X-Forwarded-For` ignored.
6. **Girdiyi doğrula.** Form Request on every endpoint; bounds: `qty` 1..20, price 100..1_000_000 kuruş, coordinates in the Türkiye bbox, radius ≤ 5 000 m, code `^[0-9A-HJKMNP-TV-Z]{8}$`; JSON body limit 1 MB (nginx `client_max_body_size 6m` only for document endpoints). Evidence: negative test per rule.
7. **Yüklemeyi sınırla.** Documents ≤ 5 MB each, max 3, `application/pdf|image/jpeg|image/png` by magic bytes, PDF sanity (no JavaScript, ≤ 10 pages), stored on the **private** disk, served to admins only through 5-minute signed URLs; shop photos ≤ 3 MB re-encoded by Intervention Image (WebP, 1600 px, metadata stripped); quota 10 uploads/shop/day; ClamAV documented as an optional switch. Evidence: renamed executable rejected; document URL without signature → 403.
8. **CORS'u kilitle.** `api/*` allows only `https://askida.app` (the web impact widget), `supports_credentials=false`, no wildcard. Evidence: request from another origin gets no `Access-Control-Allow-Origin`.
9. **Güvenlik başlıkları.** HSTS 2 years + preload; nonce CSP for Blade (`object-src 'none'`, `frame-ancestors 'none'`); a relaxed CSP only for `/admin` (Filament assets) and `/pay/*` (`frame-src` iyzico hosts only); `Permissions-Policy: geolocation=(self), camera=(), microphone=()`; API `Cache-Control: no-store`. Evidence: header assertions in Pest.
10. **HTTPS zorunlu.** Force https outside local; no cleartext on Android or iOS; WebView blocks any non-`https` URL and any host outside the §4 allowlist. Evidence: plain `http` API call fails; WebView foreign-host navigation blocked (widget test).
11. **Şifreleri hash'le.** `argon2id` (memory 65536, time 4, threads 1); `Password::min(10)->uncompromised()`; redemption codes stored only as `HMAC-SHA256(code, HOOK_CODE_PEPPER)`; `tax_number`/`iban` encrypted with `Crypt`; Apple/Google-only users have `password = NULL`. Evidence: DB dump shows only `$argon2id$` and hashes; no plaintext codes.
12. **Çerezi güvenli yap.** Web/admin sessions: secure + http-only, `SESSION_COOKIE=__Host-askida_session`, SameSite `strict` for the admin guard and `lax` for public web, CSRF on; mobile: Sanctum token in `flutter_secure_storage` (iOS Keychain `first_unlock_this_device`, Android `encryptedSharedPreferences: true`), one token per device, 30-day expiration, revoked on logout/deletion. Evidence: cookie attribute tests; token expiry test.
13. **Hata mesajını kıs.** `APP_DEBUG=false` outside local; API errors render `{type,title,status,code,request_id}`, web a generic error page; validation errors return field + code only; Flutter maps `code` → Turkish ARB strings. Evidence: forced exception returns the generic body only.
14. **Logları temizle.** Mask emails, phones, IBAN/tax numbers and card-like sequences in logs; never log request bodies for `/auth/*`, `/pay/*`, `/webhooks/*`; job payloads keep ids only; 30-day rotation; no PII in Flutter release logs; Sentry `beforeSend` scrub on both sides. Evidence: log sample of register + donate + redeem contains no email/IBAN/code.
15. **Sorguyu parametrele.** PostGIS only through `whereRaw` with bindings; a custom PHPStan rule forbids string interpolation inside `DB::raw`/`whereRaw`. Evidence: PHPStan passes; grep for `whereRaw("` with `{$` empty.
16. **XSS'e karşı kaçır.** `{!! !!}` allowed solely for trusted Markdown rendered through HTMLPurifier; CSP nonce; the payment WebView never receives injected user content. Evidence: stored `<script>` in a shop name renders as text on web and in Filament.
17. **Webhook imzası.** `POST /api/v1/webhooks/iyzico`: verify the signature on the raw body exactly per iyzico's current webhook specification, reject mismatch or stale timestamp; idempotency by `event_id`/`paymentId` (unique index in `payment_events`); respond 200 fast, then a queued job re-fetches the payment via `retrieve` and only then transitions `donations.status` and creates `hooks`; `POST pay/callback` never trusts posted status — it also calls `retrieve`; daily reconciliation job compares provider records with `donations`. Evidence: tests for missing/invalid signature, replayed event, callback with forged status, mismatch alert.
18. **Admin'e rol koy.** Filament `/admin`; roles `admin`, `moderator` (shop verification, documents, abuse), `finance` (payouts, reconciliation); mandatory TOTP at login; session `strict`; IP allowlist switch; `activity_log` on every model change and login; Filament impersonation disabled; no admin access to recipient identities (none exist). Evidence: role tests; activity log assertions; e2e admin verification flow.
19. **Paketleri denetle.** CI: `composer audit` (fail), `npm audit --audit-level=high`, `osv-scanner --lockfile=pubspec.lock`, `flutter pub outdated` report; Dependabot for composer/npm/pub/gradle/cocoapods; lockfiles committed; CycloneDX SBOM (`cyclonedx-php-composer`). Evidence: CI workflow + reports.
20. **Otomatik yedek.** `spatie/laravel-backup` daily 03:30 Europe/Istanbul: DB dump + `storage/app/private` to a **separate** R2 bucket with write-only credentials, encrypted; retention 7 daily / 4 weekly / 6 monthly; health checks + failure email; R2 versioning on the public bucket; `docs/ops/backup-restore.md`; weekly CI `restore-drill.yml` restores the latest dump into Postgres+PostGIS and asserts `AVAILABLE + RESERVED + REDEEMED + EXPIRED = qty sum`. Evidence: drill output.
21. **Hesabı gerçekten sil.** Donors: in-app + web `/hesap-silme`, re-auth → immediate deactivation (tokens revoked, push tokens deleted) → 7-day grace → hard delete of PII; donation rows kept with `donor_id = NULL` and `anonymized_at` because payment records must be retained for legal accounting (retention period in ADR-0005 after Ayberk confirms with an accountant). Merchants: deletion only when the shop has zero `AVAILABLE|RESERVED` hooks (else admin transfers to another verified shop with donor notice, or refunds via provider); documents deleted from the private disk. Anonymous devices: `DELETE anon/me` removes `anon_id` rows and counters immediately. Confirmation email; activity log without PII. Evidence: e2e proves no residual PII.
22. **Harcama uyarısı kur.** `docs/ops/cost-alerts.md` (hosting, DB, Redis, R2, Resend, iyzico fees/commission, FCM free); application caps: the donation caps of §3 story 4, per-shop daily item caps, reserve/redeem rate limits, push fan-out cap; job `cost.guard` counts daily emails/pushes and pauses non-critical sends above caps; fraud budget: automatic payout hold for shops whose redemption rate exceeds configurable anomaly thresholds, flagged to `finance`. Evidence: doc + guard/anomaly tests.
23. **Saldırgan gibi dene.** `docs/security/threat-model.md` (redemption code brute force, redemption race/double-spend, anon farming across devices/emulators, merchant self-redeem collusion, webhook/callback forgery, IDOR on donations/documents, private document leak, CSRF on web, Filament exposure, WebView phishing, payment amount tampering); `server/tests/Security/AttackSuiteTest.php` (Pest): concurrent redeem of the same code (exactly one succeeds), code guessing at rate limit, forged webhook, tampered `amount` in checkout initiation (server recomputes from `items.price_minor`), IDOR matrix, spoofed headers, expired/revoked tokens, oversize uploads + MIME spoof, signed URL tampering, admin without TOTP; OWASP ZAP baseline (web) + API scan (`openapi.yaml`) in CI; MobSF on APK/IPA; `docs/security/pentest-report.md` with fixes and retest. Evidence: report present; all findings closed or accepted with reason.

---

## 7. SEO and GEO (web = Laravel Blade SSR)

### Information architecture

`/` · `/nasil-calisir` · `/esnaf` (merchant landing + sign-up CTA) · `/bagisci` · `/askidan-al` (recipient explainer, dignified, no photos of people) · `/dukkanlar/[il]` · `/dukkanlar/[il]/[ilce]` · `/dukkan/[slug]` (only shops with `listed_on_web = true`; shows available counts, hours, map, "Askıya bırak" deep link) · `/etki` and `/etki/[il]` (real hourly counters + methodology note) · `/rehber/[slug]` (guides: "Askıda ekmek geleneği nedir", "Esnaf için askıda sistemi nasıl işler", "Bağışınız nereye gidiyor", "Askıdan almak ayıp değil", "İşletmenizi nasıl doğrularız") · `/sss` · `/hakkinda` · `/gizlilik` · `/kvkk-aydinlatma` · `/hesap-silme` · `/iletisim` · `/pay/*` and `/admin/*` (`noindex`, disallowed).

### Technical SEO

- Title ≤ 60 / description ≤ 155 (Turkish); `hreflang` `tr-TR` + `en` + `x-default`; scheduled sitemap (shops, districts, guides, impact); per-shop OG images (brand frame + shop name, no personal data); JSON-LD: `Organization`, `MobileApplication` (iOS + Android, `applicationCategory: LifestyleApplication`), `LocalBusiness` (subtype by shop type: `Bakery`, `Restaurant`, `Store`) for listed shops, `BreadcrumbList`, `FAQPage` on `/sss`, `Article` on guides, `Dataset` on `/etki` (public impact data with license note); `responsecache` 5 min for public pages; Lighthouse CI budgets ≥ 90.
- App linking: `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` for `app.askida.mobile` (paths `/dukkan/*`, `/d/*`), Smart App Banner meta; Flutter deep-link routing in go_router.

### GEO

- `/llms.txt` + `/llms-full.txt` (definition, personas, how redemption works, safety/anonymity guarantees, pricing/commission, links); 40–60 word answer-first paragraph on every page ("Askıda, askıda ekmek geleneğini…"); `/sss` with 15 Turkish Q&A pairs mirrored in JSON-LD; consistent facts across `/hakkinda`, `llms.txt`, JSON-LD; `/etki` numbers dated and quotable; guides with H2 questions and short answers; honest `dateModified`.

### ASO (`docs/seo/aso.md`)

Title "Askıda: Askıda Ekmek & İyilik"; subtitle "Askıya bırak, askıdan al"; keywords (tr): askıda ekmek, bağış, iyilik, esnaf, yardımlaşma, askıda çorba, kırtasiye yardımı, mahalle; en secondary; 6 screenshots with Turkish captions (no recipient imagery); Play Data Safety and App Privacy must state that anonymous mode collects no personal data and that location is used only for nearby shops (approximate by default).

---

## 8. Quality, Testing, CI, Observability

- Flutter: unit tests for money formatting, code parsing, mode routing; widget tests per mode; `integration_test` flows (register, donate through a mocked checkout page, reserve code, redeem by scanning the issued QR, delete account) on Android emulator + iOS simulator; golden tests for design-system components.
- Laravel: Pest against a real Postgres+PostGIS service, iyzico/attestation faked; contract test against `docs/api/openapi.yaml`; migration round-trip test.
- CI (`.github/workflows/ci.yml`): `flutter analyze`/`flutter test`/unsigned builds; `composer audit`, Pest, Larastan, Pint check; `gitleaks`; ZAP on the compose stack; Lighthouse CI; `osv-scanner`. Store uploads on manual dispatch only.
- Observability: Sentry (Flutter + Laravel) scrubbed; Horizon dashboard behind admin auth; structured JSON logs with request ids; uptime check on `/up`.
- Accessibility: Semantics labels, large text, contrast ≥ 4.5:1 (Ekmek Kabuğu on Un Beyazı verified; use Kömür for body text); Turkish first, English secondary via ARB.

---

## 9. Work Ownership and Repository Conventions

| Owner      | Owns (exclusive write)                                                                                                                                                                                             | Reads                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `lead`     | `docs/adr/**`, `docs/handoffs/**`, `docs/api/**`, `brand/**`, `CONTRIBUTING.md`, root configs, `docker-compose.yml`                                                                                                | everything                       |
| `api`      | `server/app/**` except `server/app/Filament/**` and `server/app/Http/Controllers/Web/**`, `server/database/**`, `server/routes/api.php`, `server/config/**`, `server/tests/Feature/Api/**`, `server/tests/Unit/**` | ADRs, openapi                    |
| `admin`    | `server/app/Filament/**`, `server/tests/Feature/Admin/**`                                                                                                                                                          | domain models (read)             |
| `flutter`  | `app/**`                                                                                                                                                                                                           | `docs/api/openapi.yaml`, brand   |
| `web`      | `server/resources/**`, `server/routes/web.php`, `server/app/Http/Controllers/Web/**`, `server/tests/Feature/Web/**`, `docs/seo/**`                                                                                 | brand, ADRs                      |
| `security` | `docs/security/**`, `server/tests/Security/**`, `.github/workflows/security.yml`, `ops/backup/**`                                                                                                                  | everything (read-only elsewhere) |
| `qa`       | `app/integration_test/**`, `.github/workflows/ci.yml`                                                                                                                                                              | everything                       |

Handoffs via `docs/handoffs/<from>-to-<to>-<NNN>.md`; API contract changes go through `lead` (`docs/api/openapi.yaml`).

---

## 10. Delivery Phases and Gates

Each phase ends with stop → report (§11) → wait for `devam`.

**Phase 0 — Foundation.** Repo layout, Flutter project (flavors dev/prod, platform channel scaffolds), Laravel project (Docker, Horizon, Filament installed), `CONTRIBUTING.md` (§13), ADR-0001 (stack/versions), ADR-0002 (hosting + payment provider iyzico/PayTR), ADR-0003 (map tiles), ADR-0004 (push/Firebase policy), ADR-0005 (financial record retention — needs Ayberk's accountant input; document the open question), `brand/`, CI skeleton, authorization matrix draft, threat-model outline, `.env.example`, `env/example.json`. Gate: both projects build; ADRs written.

**Phase 1 — Laravel core + auth + security baseline (items 1, 3–6, 8–15).** Migrations + factories + `[ÖRNEK]` seeders, auth (email, Apple, Google, Sanctum devices), rate limiters, Form Requests, secure headers/CSP, error handler, masked logging, Policies + matrix tests, IDOR harness. Gate: Pest green.

**Phase 2 — Domain, anonymity, uploads (items 7, 21 partial).** Shops + verification workflow + documents (private disk, signed URLs), items, anonymous attestation + `anon_id` sessions, hook reservation/redemption engine with locks and caps, impact snapshots job, push tokens, deletion flows (donor/merchant/anon), `openapi.yaml`. Gate: concurrency tests (double-redeem) green; OpenAPI validated.

**Phase 3 — Payments + admin (items 17, 18).** `PaymentGateway` contract + iyzico implementation (sub-merchant onboarding, checkout token, `/pay/{token}` page, callback, webhook, reconciliation job, payouts view), Filament panel (verification queue, documents viewer via signed URLs, finance views, abuse tools) with TOTP + activity log. Gate: webhook/callback/reconciliation tests green; admin e2e.

**Phase 4 — Flutter app.** Design system, mode shell (donor/merchant/recipient), auth, shop discovery map/list, donation flow with WebView checkout, merchant catalog + redemption scanner + payouts, anonymous mode with attestation channels + code/QR screen, impact cards, settings + deletion, push handling, offline caches, deep links, ARB tr/en. Gate: integration tests green on emulator + simulator; `flutter analyze` clean.

**Phase 5 — Web SEO/GEO + impact (§7).** Public pages, persona landings, shop/district pages, impact pages, 5 Turkish guides (≥ 600 words), legal pages (KVKK aydınlatma including anonymity statement), sitemap/robots/JSON-LD/hreflang/OG generation, AASA/assetlinks, `llms.txt`, Lighthouse CI. Gate: Lighthouse ≥ 90 on 5 pages; JSON-LD validates.

**Phase 6 — Hardening and release readiness (items 2, 19, 20, 22, 23 + matrix).** Attack suite (races, forgery, farming), ZAP, MobSF, dependency audits, backups + restore drill, cost/fraud guards, history-purge runbook, ASO doc, store copy (tr/en), Data Safety / App Privacy mapping, final **23-item verification matrix**. Gate: final report.

---

## 11. Report Template (use verbatim at every gate)

```
# Askıda — Phase <N> Report
## Summary (5 lines max)
## Files created / modified (grouped by owner, full paths)
## Decisions & ADRs added
## Security checklist status
| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
## SEO/GEO status (Phase 5+)
## Tests executed (command + result counts)
## Known gaps / risks
## Open questions / proposals (scope, cost, legal)
## Proposed Conventional Commits (not executed)
## Next phase preview (3 lines)
STOPPED — waiting for "devam".
```

---

## 12. Definition of Done (final)

- 23/23 items **done** with evidence; SEO/GEO checklist complete; every MVP story demonstrable (integration + Pest tests).
- No placeholders (CI grep `TODO|FIXME|lorem|YOUR_`); no float money (PHPStan + Dart lint rule); anonymity invariants covered by tests (no PII columns on `anon_devices`, no recipient identity in any donor/merchant response).
- `flutter analyze` + tests green; Pest + Larastan 8 + Pint green; `composer audit` and `osv-scanner` clean; `gitleaks` clean; Lighthouse budgets met.
- Docs: ADRs (incl. legal open questions: marketplace agreement, retention), authorization matrix, threat model, pentest report, backup/restore runbook, cost/fraud alerts, ASO, store copy, KVKK texts.
- Release: signing docs (no keys in repo), Docker images, Caddy/nginx config, Horizon/scheduler supervisors.

---

## 13. `CONTRIBUTING.md` to create in Phase 0

Title `Askıda — Contributor Rules`. Content: the language rule, §0 items 1, 3, 4, 6 and 7 in plain words, a copy of the §9 ownership table plus the handoff rule, "the 23-item checklist is a hard requirement; `docs/security/verification-matrix.md` is maintained", and these two lines verbatim:

```
- Commands: app: flutter pub get | flutter analyze | flutter test | flutter run --dart-define-from-file=env/dev.json ; server: docker compose up | php artisan migrate --seed | php artisan test | vendor/bin/phpstan | vendor/bin/pint ; php artisan horizon
- Env: server secrets via .env (gitignored) and config/*.php only; app via env/*.json (gitignored) — keys documented in docs/ops/env.md.
```
