# Privacy labels: Google Play Data Safety and Apple App Privacy

Mapping of every data element the app and the server process to the two stores' questionnaires.
Nothing is submitted: no store accounts (**not exercised: no store accounts**). The answers below
are what the code does today; each row cites the code path or test that backs it. The legal texts
(`/gizlilik`, `/kvkk-aydinlatma`) stay labelled samples (ADR-0051).

Terms. "Collected" follows the stores' meaning: data leaves the device to the server. "Linked"
means tied to an account or a persistent identifier. "Shared" means handed to a third party for its
own use: the app shares nothing for advertising or analytics. Processors that act for the service
(the payment provider, the mail provider) are not "sharing" under the Play definition, but they
are named in the Evidence column where they apply. No advertising SDK, analytics SDK or
crash-reporting SDK is listed in `app/pubspec.yaml`, and `server/composer.json` has no
error-tracking package (checked by searching both files on this commit).

## Account holders (donor, merchant)

| Data type | Collected | Linked | Purpose | Play Data Safety answer | App Privacy answer | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| E-mail address | yes | yes | Account, verification, receipts, password reset | Personal info > Email address; collected; not shared; required; account management, app functionality | Contact Info > Email Address; linked; App Functionality | `users.email` (`server/database/migrations/2026_10_04_000100_create_users_table.php`); receipt mail `app/Domain/Payments/Mail/DonationReceiptMail.php` |
| Name | yes | yes | Display name on the account | Personal info > Name; collected; not shared; required; account management | Contact Info > Name; linked; App Functionality | `users.name` (same migration) |
| User identifier | yes | yes | Sign in with Apple or Google, API tokens | Personal info > User IDs; collected; not shared; account management | Identifiers > User ID; linked; App Functionality | `users.apple_sub`, `users.google_sub` (same migration); Sanctum tokens |
| Purchase history (donations) | yes | yes | Receipts, payouts, impact counters | Financial info > Purchase history; collected; not shared; app functionality | Purchases > Purchase History; linked; App Functionality | `donations` (`...000225_create_donations_table.php`): quantity, `amount_minor`, `commission_minor`, provider payment id; the row outlives the account with `donor_id` set to null and `anonymized_at` stamped |
| Payment card data | no | n/a | Entered only on the payment provider's page inside a WebView | Not collected | Not collected | the `/pay/{token}` page embeds the provider; no card field exists in the app (`app/lib`) or in `donations`; the provider itself is **not exercised: no sandbox account** |
| Precise location (donors, merchants) | yes, per request | no | Show nearby shops; a merchant may pin the shop's own position | Location > Precise location; collected; not shared; optional; app functionality; processed ephemerally | Location > Precise Location; not linked; App Functionality | `app/lib/features/donor/presentation/donor_providers.dart` asks with `precise: true`; `GET /api/v1/shops?near=` is not stored (`server/tests/Security/AnonymityRulesTest.php` AN-5: the only coordinate column is `shops.location`) |
| Photos (merchant verification documents) | yes (merchants only) | yes | Shop verification | Photos and videos > Photos; collected; not shared; optional for the app, required to become a verified shop; app functionality | User Content > Photos or Videos; linked; App Functionality | `shop_documents` (`...000210_create_shop_documents_table.php`), private bucket and signed URLs (`server/tests/Feature/Documents`); picked with `image_picker` |
| Phone number (shop) | yes (merchants only) | yes | Shop contact | Personal info > Phone number; collected; not shared; app functionality | Contact Info > Phone Number; linked; App Functionality | `shops.phone`; the public directory returns no owner contact data (AnonymityRulesTest "never returns owner contact data") |
| Address (shop) | yes (merchants only) | yes | Public shop page and map | Personal info > Address; collected; not shared; app functionality | Contact Info > Physical Address; linked; App Functionality | `shops.address`, `il`, `ilce` |
| Tax number and IBAN (merchants) | yes | yes | Verification and payouts | Financial info > Other financial info; collected; not shared; app functionality | Financial Info > Other Financial Info; linked; App Functionality | `shops.tax_number_enc`, `shops.iban_enc` (encrypted columns, `APP_KEY`) |
| Push token | declared, nothing is collected today | yes | Notifications "Yeni askı" and "Askın alındı" | Device or other IDs; collected only once a push transport exists | Identifiers > Device ID; linked; App Functionality | `device_push_tokens` holds a token for a signed-in user only (`...000260_create_device_push_tokens_table.php`); the app ships `NoopPushService` (no token); `PUSH_DRIVER=log` is refused outside local and testing. **not exercised: no Firebase project, no push provider (ADR-0004, ADR-0021)** |
| Camera | used; nothing leaves the device unless a document photo is chosen | no | Scan redemption codes (merchants), take a document photo | Permission only, not a data type | Usage string only, not a data type | `app/android/app/src/main/AndroidManifest.xml` (`CAMERA`); `app/ios/Runner/Info.plist` (`NSCameraUsageDescription`) |
| Diagnostics (server request log) | yes | partly | Operations and abuse handling | App info and performance > Diagnostics; collected; not shared; app functionality | Diagnostics > Performance Data; may be linked through the user id; App Functionality | `server/app/Http/Middleware/LogRequest.php`: method, route pattern, status, duration, request id, user id; no query string, no body. The `daily` channel keeps 30 files (`server/config/logging.php`); `.env.example` selects `single`, so production sets `LOG_STACK=daily` (not verified: no production host) |
| Crash reports | no | n/a | n/a | Not collected | Not collected | no crash-reporting SDK in `app/pubspec.yaml`; error tracking (Sentry) is **not connected: no account** |
| Advertising identifier, contacts, health data, browsing or search history | no | n/a | n/a | Not collected | Not collected | no such SDK in `app/pubspec.yaml`, no such permission in `AndroidManifest.xml` |

## Anonymous mode (taking an item): what is processed

This section does not say "no personal data". Anonymous mode has no account, but the elements
below are processed. None is a name, an e-mail address, a phone number, a precise location or a
hardware identifier. (The spec's ASO sentence is corrected here; the deviation is recorded in
ADR-0063.)

| Element | Processed | Stored | Where and for how long | Evidence |
| --- | --- | --- | --- | --- |
| `anon_id` | yes | yes | A random UUID version 7 created by the **server** when the device first attests; it is not derived from a hardware identifier and is not created by the app. Stored in `anon_devices.anon_id`, in `anon_daily_counters.anon_id` and in `hooks.anon_id` while a reservation is open. "Verilerimi sıfırla" (`DELETE /api/v1/anon/me`) removes the device, its counters and its reservation link. Daily counters older than 30 days, and the device link on redeemed or expired units older than 30 days, are purged | `server/app/Domain/Anon/Services/AnonAttestationService.php` (`Str::uuid7()`); `AnonRetentionService`; `server/config/askida.php` `hooks.retention_days` = 30; AnonymityRulesTest AN-6 |
| `anon_devices` columns | yes | yes | Exactly: `id`, `anon_id`, `platform`, `attested_at`, `attestation_verdict`, `banned_at`, `last_seen_at`, `created_at`, `updated_at`. No name, e-mail, phone, IP, coordinates, advertising id or device nonce. `anon_daily_counters` holds `anon_id`, `day`, `count`, `per_shop` and timestamps | AN-3 asserts both column lists and rejects any column named like email, phone, name, ip, lat, lng, location, advertising, address or nonce |
| Device nonce | yes | no (a keyed hash only, in the cache) | The app builds a 32-byte random `device_nonce` (`Random.secure()`) and sends it with the attestation request. The server keeps a keyed hash of platform and nonce as a cache key that maps to the `anon_id` for the verdict cache lifetime (30 days). Neither the nonce nor the hash is written to the database | `app/lib/data/repositories/impl/dio_anon_repository.dart` (`randomDeviceNonce`); `AnonAttestationService` (class comment, `deviceKey`); `server/config/askida.php` `attestation.verdict_cache_days` |
| Attestation verdict | yes | yes, the verdict only | `anon_devices.attestation_verdict` (a short string) and `attested_at`. The attestation token is not stored: no column can hold it | the `anon_devices` column list (AN-3); `AnonAttestationService::attest` writes the verdict and timestamps only. The real providers (Play Integrity, DeviceCheck) are **not exercised: no Google Cloud project, no Apple team**; the local verifier is a fake that is refused outside local and testing (ADR-0019, ADR-0021) |
| IP address | yes | not in the database | Present in transit, in the reverse proxy and web server access logs, and in rate-limiter keys in Redis: `hooks-reserve:ip:<ip>` is an IP key; `anon-attest:` and `hooks-reserve:anon:` keys use a hash of the device key or `anon_id`. `anon_devices` and `anon_daily_counters` hold no IP. The application log never records the IP or the URL. The web server (`docker/nginx/default.conf`) defines no log format and its access log goes to the container's standard output (`docker/php/Dockerfile`), so the default format applies and it includes the client address and the request line; the retention of that stream is set by the host's container log driver and is **not defined in this repository (not exercised: no production host)** | `server/app/Providers/AnonServiceProvider.php` (limiter keys); `server/app/Http/Middleware/LogRequest.php`; `docker/nginx/default.conf`; `docker/php/Dockerfile`; AN-3 (no IP column) |
| Push token | no | no | Anonymous devices never register a push token: `PUT me/push-token` is inside the "User accounts only" route group, which an anonymous token does not reach, and the app registers a token only when a user is signed in (no user: state `waitingForAccount`, no call). The app also ships no push transport. State: **not collected** | `server/routes/api/accounts.php` (group header comment); `app/lib/features/settings/presentation/settings_controller.dart` (`sync`); `app/test/features/settings/push_wiring_test.dart`; `device_push_tokens.user_id` is a non-null foreign key |
| Approximate location | yes | no | The recipient app rounds the device position to two decimals (about 1.1 km) before it leaves the device, or uses a district centre when the person prefers; it is sent as `near=lat,lng` in `GET /api/v1/shops` and used for that query only. No table stores it (the only coordinate column in the schema is `shops.location`). The application log records the route pattern only. A web server access log of the default format would contain the request line with the query (see the IP row): this is a known gap, listed as an open question in the Phase 6 release report | `app/lib/features/discovery/presentation/coarse_location.dart` (`coarsen`); `app/lib/features/discovery/domain/districts.dart`; `server/app/Http/Requests/Shops/ListShopsRequest.php` (class comment); AN-5 |
| Reservation and redemption record | yes | yes, while open | The unit, shop, time and `anon_id` of an open reservation; after redemption or expiry the `anon_id` link is removed at 30 days; the code is stored only as a keyed hash. The donor learns only that the unit was taken; the merchant sees the item only | AN-1, AN-2, AN-6, AN-7, AN-8 in `server/tests/Security/AnonymityRulesTest.php`; `HookReservationService` |
| Not processed | no | no | account, name, e-mail, phone number, precise location, rating of the person, advertising identifier, contacts | AN-3, AN-5; `AndroidManifest.xml` (no contacts or advertising-id permission) |

### Store answers for anonymous mode

- **Play Data Safety:** Device or other IDs (the random `anon_id`): collected, not shared,
  required for anonymous mode, purposes app functionality and fraud prevention. Location >
  Approximate location: collected, not shared, optional (a district can be chosen instead), app
  functionality, processed ephemerally. Data deletion: in the app (settings) and by request for
  account holders. Encryption in transit: HTTPS only (`usesCleartextTraffic=false`).
- **Apple App Privacy:** Identifiers > Device ID (the `anon_id`): not linked to the person's
  identity, not used for tracking, purposes App Functionality and Other (abuse prevention).
  Location > Coarse Location: not linked, not used for tracking, App Functionality.
- **Tracking:** none. No data is combined with third-party data for advertising.

## Location summary (both stores)

"Approximate, nearby shops only" for recipients (rounded to about 1 km, sent once per search, not
stored). Donors and merchants can allow precise location, used the same way, plus the merchant's
own shop pin. Permission is when-in-use only (`NSLocationWhenInUseUsageDescription`; Android
coarse and fine location, no background location).

## Retention and deletion summary

| Data | Deleted when |
| --- | --- |
| Anonymous device, counters, reservation link | "Verilerimi sıfırla" (`DELETE /api/v1/anon/me`); counters and links also purged after 30 days |
| Donor account | Account deletion in settings with a 7-day grace period (`deletion_requests`); donation rows are kept without the donor link for the financial record |
| Application request log | 30 daily files when `LOG_STACK=daily` |
| Web server and proxy access log | host-defined; **not exercised: no production host** |
| Backups | see `docs/ops/backup-restore.md` (backup worker, same phase) |

## Not exercised

- Submitting the Play Data Safety form and the App Privacy details: no store accounts.
- A lawyer's review, and the controller identity in the policy: the sample legal pages name no
  controller, address or e-mail on purpose (ADR-0051).
- The real attestation providers and any push transport: no accounts.
- iOS: no macOS. This table was derived from the shared Dart code and the server; the iOS binary
  was never built or run, and no claim of iOS verification is made.
