# Google Play Data safety

Mapping of Patika (`app.patika.android`) to the Play Console Data safety form, cross-checked against the code on 2026-10-26. **Portfolio: not submitted** (no Play Console account).

Play's definitions apply: "collected" means sent off the device; "shared" means transferred to a third party, excluding service providers that process data on Patika's behalf (Cloudflare R2, Resend, Firebase Cloud Messaging, Google Play) and transfers the user starts and expects (for example a public adoption post). With that definition Patika **shares no user data**.

## Section answers

| Question | Answer | Evidence |
| --- | --- | --- |
| Does the app collect or share any of the required user data types? | Yes (collects) | Tables below |
| Is all user data encrypted in transit? | Yes | Release `network_security_config.xml` sets `cleartextTrafficPermitted="false"` with no exceptions (`app/Patika.App/Platforms/Android/Resources/xml/network_security_config.xml`); cleartext to `10.0.2.2` exists only in the Debug resource. The API and storage are reached over HTTPS only (`Api:BaseUrl`, `Storage:Origins`) |
| Do you provide a way for users to request that their data is deleted? | Yes, in the app and on the web | In-app: Profil → Ayarlar → Hesabımı sil (`DELETE /v1/me`, `src/Patika.Api/Features/Account/AccountEndpoints.cs`). Web: `https://patika.app/hesap-silme` (`src/Patika.Web/Pages/Legal/HesapSilme.cshtml`). Hard delete by the Worker after the 7-day grace period (`DeletionGracePeriod`, `AccountPurger`) |
| Independent security review | No | Not done (portfolio) |
| Families policy | Not applicable | Target audience 18+ (see [play-listing.md](play-listing.md)) |

## Data types

"Required" means the feature cannot work without it; "optional" means the user can use the app without providing it.

| Play data type | Collected | Shared | Purpose (Play terms) | Required? | What exactly | Deletion path | Code |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Personal info: Email address | Yes | No | Account management, App functionality (verification codes), Developer communications (deletion confirmation) | Required for an account; browsing needs none | `users.email`, verified by a 6-digit code; codes stored only as HMAC | Hard delete sets `email = NULL` and removes `email_tokens` | `src/Patika.Api/Features/Auth/AuthHandlers.cs`, `EmailCodes.cs`; `src/Patika.Worker/Jobs/Accounts/AccountPurger.cs` |
| Personal info: Name | Yes | No | App functionality (shown on the user's posts and feedings), Account management | Required (display name, user-chosen, can be a nickname) | `users.display_name`, optional `users.district` | Replaced with "Silinmiş hesap", district cleared | `AccountPurger.cs` |
| Personal info: User IDs | Yes | No | Account management | Optional (Google sign-in only; not wired in the current build) | `external_logins` (Google subject) | Deleted | `src/Patika.Api/Features/Auth/ExternalIdentity.cs`; `AccountPurger.cs` |
| Location: Approximate location | Yes | No | App functionality | Optional | Map queries send a bounding box on the server's grid, not a position; the urgent-alert home area is stored rounded to 3 decimals | Map boxes are not stored; the home area is cleared when alerts are turned off and on hard delete | `src/Patika.Api/Features/Devices/DeviceEndpoints.cs` (`HomeAreaDecimals = 3`); `AccountPurger.cs` (`UrgentHome = null`) |
| Location: Precise location | Yes | No | App functionality | Optional (permission asked when the user taps "Konumuma git", adds a station or opens an urgent post) | The device position (MAUI `Geolocation`, `GeolocationAccuracy.Medium`) is sent for a nearby search (not stored) or becomes the location of the station or urgent post the user creates. Never stored on the profile, never in the background | Urgent posts are deleted on hard delete; stations stay as shared map data with the photo removed and the creator replaced by the tombstone | `app/Patika.App/Services/Location/MauiLocationService.cs`; `AccountPurger.cs` |
| Photos and videos: Photos | Yes | No | App functionality | Optional | Station, feeding, animal and urgent photos, re-encoded on the phone with all metadata (EXIF GPS included) removed, then re-encoded again by the Worker; stored in object storage | Every photo key of the user is queued for object removal on hard delete; versioned copies expire after 30 days | ADR-0007; `app/Patika.App.Core/Media/`; `src/Patika.Worker/Jobs/Media/MediaProcessor.cs`; `AccountPurger.cs` (`IObjectKeyRemovalQueue`) |
| App activity: Other user content (UGC) | Yes | No | App functionality | Optional | Stations, feedings and notes, animal profiles and sightings, adoption posts and requests, urgent posts, reports | Adoption posts and requests, urgent posts, reports, follows deleted; feedings and sightings anonymised (`user_id = NULL`, note and photo cleared) to keep station history | `AccountPurger.cs` |
| App activity: Other actions | Yes | No | App functionality | Optional | Animals followed | Deleted | `AccountPurger.cs` (`Follows`) |
| Financial info: Purchase history | Yes | No | App functionality (Destekçi entitlement), Fraud prevention | Optional (only for Destekçi) | `subscriptions`: product, base plan, status, expiry, SHA-256 of the purchase token, the token itself encrypted with the Data Protection ring. No card or payment data: Google Play handles payment | On hard delete the user link and the encrypted token are removed; the token hash, product and dates stay for refund and fraud handling, and the whole row is deleted 90 days after the subscription ended or 90 days after the account purge once the subscription is no longer running; Play notification rows lose the token hash after 90 days (`BillingTokenRetention`) | ADR-0010; `src/Patika.Infrastructure/Billing/`; `AccountPurger.cs` (`Subscriptions`) |
| Device or other IDs | Yes | No | App functionality (urgent push) | Optional (only with notifications on) | FCM registration token and a random installation UUID kept in SecureStorage (not derived from hardware or advertising IDs) | Removed at sign-out, when notifications are turned off and on deletion (`device_tokens`) | ADR-0008; `app/Patika.App.Core/Push/InstallationId.cs`; `src/Patika.Api/Features/Devices/DeviceEndpoints.cs`; `AccountPurger.cs` |
| App info and performance: Crash logs | **No** | No | n/a | n/a | No crash reporter or analytics SDK in the app (ADR-0004); the app has no logging calls | n/a | `app/Patika.App/Patika.App.csproj` (runtime packages: MAUI, CommunityToolkit.Mvvm, Xamarin.Firebase.Messaging) |
| App info and performance: Diagnostics | **No** | No | n/a | n/a | Server request logs record path, status and duration with masked values (see [logging](../ops/logging.md)); they are server operations data, not data the app collects about the device | Logs kept 30 days | `src/Patika.Api/Logging/` |
| Messages, contacts, calendar, health, files, audio, web history, installed apps | No | No | n/a | n/a | None of these are read | n/a | Manifest permissions: INTERNET, ACCESS_NETWORK_STATE, ACCESS_COARSE_LOCATION, ACCESS_FINE_LOCATION, CAMERA, READ_EXTERNAL_STORAGE (max SDK 32), POST_NOTIFICATIONS |

Passwords are not a Play data type but for completeness: stored only as Argon2id hashes, removed on hard delete. At registration the API checks the password against Have I Been Pwned with k-anonymity: only the first 5 characters of its SHA-1 leave the server.

## Items to recheck before a real submission

- Google sign-in: when the Credential Manager adapter replaces `NotConfiguredGoogleSignIn`, keep "User IDs" and check that no extra profile field (photo, name) is stored.
- Maps: if the Google Maps street layer is added (ADR-0007), Google receives map tile requests; declare per Google's SDK guidance.
- The purchase token hash is kept for 90 days after the subscription ends in a terminal state (canceled, expired, revoked; or after the account purge, once nothing is running), then deleted by the Worker's hourly maintenance job, together with any copy of it that a successor subscription holds as its predecessor link. Paused and on-hold subscriptions are kept, because Play can still resume them ([`BillingTokenRetention.cs`](../../src/Patika.Worker/Jobs/Maintenance/BillingTokenRetention.cs), `BillingTokenRetentionTests`). The Data safety answer for purchase history stays "kept for fraud prevention", now with that bound.

## KVKK aydınlatma metni and privacy policy

The Turkish legal texts are drafts awaiting legal review, served by the Web app:

- KVKK aydınlatma metni: `https://patika.app/kvkk`, source [`src/Patika.Web/Content/yasal/kvkk.md`](../../src/Patika.Web/Content/yasal/kvkk.md) (covers location and photo processing, transfers to service providers, retention and data subject rights).
- Gizlilik politikası (the Play privacy policy URL): `https://patika.app/gizlilik`, source [`src/Patika.Web/Content/yasal/gizlilik.md`](../../src/Patika.Web/Content/yasal/gizlilik.md).
- Hesap silme: `https://patika.app/hesap-silme`, page [`src/Patika.Web/Pages/Legal/HesapSilme.cshtml`](../../src/Patika.Web/Pages/Legal/HesapSilme.cshtml).

Bracketed fields in those texts (data controller name, address, VERBİS status, legal bases) are owner and legal items.
