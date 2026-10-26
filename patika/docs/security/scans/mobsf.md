# MobSF static scan and Android manual checks

Run on 2026-10-26 against the Release APK built from `feat/patika-p6` (phase 6, after the hardening and review fixes).

**Real vs simulated.** The scan and every check below were run for real on this machine. The APK is signed with a throwaway local upload key (`CN=Patika Local`, RSA 4096) created only for this scan, because Patika is a portfolio project with no Play Console app and no Play App Signing key ([signing.md](../../release/signing.md)). A store build would carry Google's app signing certificate instead; nothing else in the APK changes. The manual sign-in check ran the Debug build on the Android emulator (AVD Pixel_8, Android 17 image) against the local compose stack; it was not run on a physical device.

## Tool and input

| Item | Value |
| --- | --- |
| Tool | MobSF `opensecurity/mobile-security-framework-mobsf:v4.5.3` (Docker, digest `sha256:5113fbad0727445dda01afdccafea5e107bfa8632ead8a169492f5caa8aa1b7c`), REST API `/api/v1/upload`, `/api/v1/scan`, `/api/v1/report_json`, `/api/v1/scorecard` |
| Build | `dotnet publish app/Patika.App/Patika.App.csproj -f net10.0-android -c Release -p:AndroidPackageFormat=apk -p:AndroidKeyStore=true ...` (signing properties as in [signing.md](../../release/signing.md), passwords through `env:`) |
| Package | `app.patika.android`, versionName 0.1.1, versionCode 2, minSdk 24, targetSdk 36 |
| File | `app.patika.android-Signed.apk`, 35,479,958 bytes |
| SHA-256 | `b9e14a1cfdd59e38e1b92f4aed0be90e3fe6455613df6e709ff6538c15d78ec8` |
| Signature | v2 + v3, self-signed throwaway key (see above) |

## Result

Security score **62/100**. Trackers: **0** of 432 known. Network security: **secure** (base config disallows cleartext for all domains).

| Severity (scorecard) | Count |
| --- | --- |
| High | 1 |
| Warning | 4 |
| Info | 1 |
| Secure | 2 |
| Hotspot | 1 |

The score is held down by findings in the .NET runtime and third-party libraries, not by the app's own configuration; the verdicts follow.

### Findings and verdicts

| # | MobSF finding | Severity | Verdict |
| --- | --- | --- | --- |
| M1 | App can be installed on Android 7.0 (minSdk 24); MobSF asks for API 29+ | High | **Accepted.** Volunteers on older, cheaper phones are part of the audience. Raising minSdk to 26 would not clear the finding (MobSF wants 29). Security-relevant decisions are server-side (authorization, quotas, entitlements); tokens sit in Keystore-backed EncryptedSharedPreferences, which works on API 23+. Revisit when Play's minimum or the device data says so. |
| M2 | Exported receiver `androidx.profileinstaller.ProfileInstallReceiver` protected by `android.permission.DUMP` | Warning | **Accepted.** AndroidX library component; `DUMP` is a signature/privileged platform permission, so only the system shell and platform apps can send to it. It only writes ART baseline profiles. |
| M3 | Exported receiver `com.google.firebase.iid.FirebaseInstanceIdReceiver` protected by `com.google.android.c2dm.permission.SEND` | Warning | **Accepted.** Firebase Messaging component required for push; the permission is signature-level and held by Google Play services only. |
| M4 | "Files may contain hardcoded sensitive information" | Warning | **Accepted, false positive.** All four hits are Glide library classes (`com/bumptech/glide/load/Option.java`, `DataCacheKey`, `EngineResource`, `ResourceCacheKey`) where the word "key" names a cache key. |
| M5 | "This app may contain hardcoded secrets" (485 strings) | Warning | **Accepted, false positive.** The strings are hex tables, curve constants and test vectors from the .NET runtime, BouncyCastle-style crypto tables and Tink. A filter for `AIza`, `BEGIN`, `sk_`, `key`, `token`, `pass`, `secret`, `patika` and `http` over the 485 strings matched none. The only app endpoint in the binary is `https://api.patika.app/` (public); `appsettings.Development.json` and the `10.0.2.2` exception are not in the Release APK (MobSF's domain list has no `10.0.2.2`; csproj condition `'$(Configuration)' == 'Debug'`). |
| M6 | The app logs information | Info | **Accepted.** Hits are in Glide. The app's own logging was checked on the device (below): nothing sensitive. |
| M7 | 5 dangerous permissions (hotspot) | Hotspot | **Accepted, all used.** Coarse/fine location (foreground only, at the moment a station, urgent post or check-in is created; no background location), camera (photos), `READ_EXTERNAL_STORAGE` with `maxSdkVersion="32"` (photo picker on old Android), `POST_NOTIFICATIONS` (urgent pushes). Mapped in [data-safety.md](../../release/data-safety.md). |
| M8 | Native binaries: 448 of 480 `.so` files without stack canary, 436 partial RELRO, 452 not fortified, `libmonodroid.so` with symbols | High/Warning (binary section, not in the scorecard) | **Accepted.** These are the .NET for Android AOT images (`libaot-*.dll.so`), the Mono runtime and `libe_sqlite3.so`, produced by the platform toolchain; the app has no native code of its own. They carry managed code compiled ahead of time, where stack canaries do not apply in the C sense; NX and PIC are set on all 480. |
| M9 | APKiD: `r8`, emulator-check strings in `classes.dex` | Info | **Accepted.** R8 is the normal shrinker; the VM-check strings come from bundled Google libraries, the app has no anti-emulator logic. |

No finding needed a code or manifest change.

## Manifest, components and backup (Release APK, `aapt2 dump xmltree`)

- `android:allowBackup="false"`, `android:dataExtractionRules` and `android:fullBackupContent` set; both rule files exclude every domain (`root`, `file`, `database`, `sharedpref`, `external` and the `device_*` domains) for cloud backup and device transfer ([source](../../../app/Patika.App/Platforms/Android/Resources/xml/)).
- `android:usesCleartextTraffic="false"`; `network_security_config.xml` in the APK is `<base-config cleartextTrafficPermitted="false" />` with no domain exceptions.
- Not debuggable (no `android:debuggable` attribute).
- Every component declares `android:exported`. Exported `true`: only `MainActivity` (MAIN/LAUNCHER intent filter, no deep links or browsable filters) and the two library receivers in M2 and M3. `PatikaMessagingService`, all providers (`FirebaseInitProvider`, `MonoRuntimeProvider`, `InitializationProvider`) and all other services and receivers are `exported="false"`.
- CI keeps this true: the `Check merged Android release manifest` step in `patika-ci.yml` fails on `allowBackup`, cleartext, `debuggable`, a missing `exported` or missing backup rules.

## Manual checks on the emulator

Setup: the Debug build installed with `dotnet build -t:Install -f net10.0-android -c Debug`, the compose stack (`ASPNETCORE_ENVIRONMENT=Staging`) reached from the emulator at `10.0.2.2:5000` (a temporary relay container on the compose network forwarded host port 5000 to the API, so the emulator did not share the per-address rate-limit bucket with the ZAP scan). A sample account `logcat.probe@example.test` was registered through `POST /v1/auth/register` and marked verified in the database (Staging has no mail transport, so no code arrives). Sign-in was done through the app's sign-in form; the profile then showed "Logcat Deneme".

### No tokens or credentials in logcat

```sh
adb logcat -c
# sign in through the UI (email, password, "Giriş yap")
adb logcat -d > logcat-signin.txt          # 3,396 lines
grep -ci -- <pattern> logcat-signin.txt
```

| Pattern | Matches | Note |
| --- | --- | --- |
| `eyJ` (JWT prefix) | 0 | |
| `refresh` | 0 | |
| `Bearer` | 0 | |
| `accessToken` | 0 | |
| `Authorization` | 0 | |
| the password | 1 | `adbd` logging the test's own `adb shell input text` command, not the app |
| the email address | 1 | same `adbd` line for the email |

Lines from the app process (pid filter, 61 lines: IME, autofill, window insets, GC) contain none of the patterns. The API's own log for the same sign-in records the user id and path only.

### Token storage

- Refresh token and account id: `SecureStorageTokenStore` (`app/Patika.App/Services/Api/SecureStorageTokenStore.cs`) on MAUI `SecureStorage`, which on Android is AndroidX `EncryptedSharedPreferences` with Keystore-held keys. The access token lives in memory only. Sign-out removes both entries (`ClearAsync`); an unreadable store (Keystore reset) is wiped with `SecureStorage.RemoveAll()`.
- On the device after sign-in (`adb shell run-as app.patika.android`): `shared_prefs/` holds only the encrypted preferences file (Tink keysets plus encrypted names and values), 0 matches for `eyJ`; the offline database `files/patika-offline.db` and its WAL contain no token, email or password (0 matches each).
- Plain `Preferences` hold only non-secret state: pending account deletion (user id and time), the push switch and the FCM registration token (not a credential for the Patika API). The installation id and local billing receipts use `SecureStorage`.
- Release builds have no `run-as` (not debuggable), and `allowBackup="false"` plus the rules above keep the files out of backups.

### Cleartext

- Release: as above, no cleartext anywhere (manifest attribute plus network security config, both read from the built APK).
- Debug: cleartext only to `10.0.2.2` (`Platforms/Android/DebugResources/xml/network_security_config.xml`), swapped in by the csproj for Debug only.

## Not exercised

- A Play-signed build, Play pre-launch report and Play Integrity: no Play Console app (portfolio).
- MobSF dynamic analysis (needs a rooted MobSF-prepared emulator image) and a physical device.
- Google sign-in and push on the device (no `google-services.json` or OAuth client); logcat during a token refresh or with push enabled was not captured.
