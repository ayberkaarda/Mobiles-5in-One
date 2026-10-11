# Cetele: MobSF static analysis (Android)

| | |
|---|---|
| Spec item | 23 (mobile part). |
| Status | Two local runs on 2026-10-11: the debug APK and the unsigned release APK of `feat/cetele-p6-zap` (base: Phase 5). Android only. |
| Tool | MobSF **v4.5.4**, image `opensecurity/mobile-security-framework-mobsf@sha256:83bc8aaf940d66344b7c10ebc12e921086bec43369a8259582e6dc258f2924b0`, static analysis through the REST API (`/api/v1/upload`, `scan`, `report_json`, `scorecard`). The procedure is `ops/mobsf/run-mobsf.sh`. |
| iOS | Not applicable: there is no iOS build. |
| Reports | `docs/security/scan-reports/mobsf/` and `mobsf-release/` (JSON, about 5 MB each, git-ignored). The numbers below come from `report.json` and `scorecard.json` of each run. |
| Evidence rule | Nothing here is a store build: the debug APK is signed with the Android debug key and the release APK was built with placeholder values (`cetele.apiBaseUrl=https://api.example.test` and two sample SPKI pins), unsigned. A scan of a signed store build with the real pins is **not exercised**. |

## 1. What was scanned

| Property | Debug | Release |
|---|---|---|
| Build command (JDK 21) | `./gradlew --offline :app:assembleDebug` | `./gradlew --offline :app:assembleRelease -Pcetele.apiBaseUrl=https://api.example.test "-Pcetele.certPins=sha256/<sample>,sha256/<sample>"` |
| Package | `app.cetele.android` 0.3.0, minSdk 26, targetSdk 36 | same |
| Size | 28.98 MB | 11.7 MB (R8 and resource shrinking on) |
| SHA-256 | `76a301116c990f7a582114d323b3bcaa9d789dd2e67a79b13ccad2a98844c655` | `811a0263eada1a5e234c535a86fcd07080601900c88fd59d871ad10772437967` |
| Signature | v2, `CN=Android Debug` | none (unsigned) |

## 2. Score

| | Debug | Release |
|---|---|---|
| Security score | 50 / 100 | 60 / 100 |
| High | 4 | 2 |
| Warning | 14 | 11 |
| Info | 1 | 2 |
| Secure | 3 | 4 |
| Trackers | 0 of 432 | 0 of 432 |
| Exported (MobSF `exported_count`) | activities 2, services 1, receivers 2, providers 0 | activities 0, services 1, receivers 2, providers 0 |

## 3. The checklist items, from the manifest and the reports

| Item | Result | Source |
|---|---|---|
| Debuggable | `android:debuggable=true` in the debug APK only (High, variant). The release APK raised no debuggable finding. | `manifest_analysis` of both runs |
| Backup | `allowBackup="false"`, `fullBackupContent="false"` and `dataExtractionRules` in `src/main/AndroidManifest.xml`; no backup finding in either run. | manifest, both reports |
| Cleartext traffic | `usesCleartextTraffic="false"`. Release: base config disallows clear text for all domains (Secure). Debug: the only exception is the `10.0.2.2` domain config of `src/debug/res/xml/network_security_config.xml` (High, variant: the emulator's host loopback for the local compose server); it is not in the release APK. | `network_security`, both runs |
| Certificate pinning | MobSF marks "uses SSL certificate pinning" as Secure in both runs (`PinnedEngineFactory`). The debug build sets `PINNING_ENABLED=false` by design; the release build requires two distinct SPKI pins (`verifyReleaseConfig`). The sample pins of this run say nothing about the real pins. | `code_analysis` |
| Exported components | Release: no exported activity counted by MobSF; the launcher `MainActivity` is exported by design. Exported library components: `SystemJobService` (permission `BIND_JOB_SERVICE`), `DiagnosticsReceiver` and `ProfileInstallReceiver` (permission `DUMP`). Debug adds `PreviewActivity` and `ComponentActivity` (Compose tooling and test manifest, debug configurations only). | `manifest_analysis` |
| Permissions | `INTERNET`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `WAKE_LOCK`, `ACCESS_NETWORK_STATE`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`, `com.android.vending.BILLING`, and the app's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (debug run). No location, contacts, storage or SMS permission. | `permissions` |

## 4. Findings and classification

Classification: **variant** (property of the debug build, absent in release), **accepted** (real, kept, reason given), **false positive**.

| # | Run | Section | Finding | Class | Reason |
|---|---|---|---|---|---|
| H1 | debug | certificate | Signed with the debug certificate | variant | No release keystore exists in the repository; store builds are signed with the upload key. Release run: `Missing Code Signing certificate` because the APK is unsigned (expected for `assembleRelease` without a signing config). Re-scan a signed build before a release. |
| H2 | debug | network | Cleartext permitted for `10.0.2.2` | variant | Debug-only domain config for the emulator; absent in release. |
| H3 | debug | manifest, code | `android:debuggable=true`, "debug configuration enabled" (`BuildConfig.DEBUG` in the app and billing modules) | variant | Debug build type. Release has none. |
| H4 | release | code | CBC with PKCS5 padding (padding oracle) in `defpackage/hr2` | accepted (library, to re-check) | R8-renamed library class, not app code: the app's only `Cipher.getInstance` calls are `AES/GCM/NoPadding` (`AesGcmBox.kt`, grep over `cetele/android`). Which library holds it was not identified from the obfuscated name; **open**, to be traced with the R8 mapping file before a store release. |
| W1 | both | network | Base config trusts system certificates | accepted | Intended: system trust anchors only, no user CAs; pinning sits on top in release (`CertificatePins`, `PinnedEngineFactory`). |
| W2 | both | manifest | Installable on Android 8.0 (`minSdk=26`) | accepted | `MIN_SDK = 26` in build-logic, ADR-0001. |
| W3 | both | manifest | `SystemJobService`, `DiagnosticsReceiver`, `ProfileInstallReceiver` exported behind a permission | accepted (library) | WorkManager and AndroidX profile installer; guarded by `BIND_JOB_SERVICE` and `DUMP` (system permissions). Not declared by the app. |
| W4 | debug | manifest | `PreviewActivity` and `ComponentActivity` exported without protection | variant | `ui-tooling` and `ui-test-manifest` are debug configurations only; the release run lists no exported activity. |
| W5 | both | code | "May contain hardcoded sensitive information" | false positive | The app-side hits are constant names such as `DB_PASSPHRASE = "db_passphrase"` in `VaultKeys` and DTO field names; the values are created per device and kept in the Keystore-backed vault. The remaining hits are library classes. |
| W6 | both | secrets | "May contain hardcoded secrets" | false positive | Hex and digit strings found in library code (the matched files are not app classes). Not traced one by one; none was identified as a Cetele credential, and the build config carries no API key (`API_BASE_URL` and `CERT_PINS` only). |
| W7 | both | code | Raw SQL queries | false positive for the app | Hits are in `net/zetetic/database/*` (SQLCipher) and R8-renamed library classes (Room code, AndroidX). The app reaches the database through Room. |
| W8 | both | code | Insecure random number generator | false positive | `UuidV7.generate` takes a `java.util.Random` parameter whose default is `SecureRandom`; the other hits are library code. |
| W9 | both | code | Temp file creation | accepted | `PhotoCapture.kt` creates `receipt-*.jpg` in the app's private `cacheDir/captures`; the capture is deleted after it is encrypted into the photo store (`EncryptedPhotoStore`, `ImageCompressor`). |
| W10 | both | code | IP address disclosure | accepted | `BuildConfig`/`ApiConfig`: the debug default `http://10.0.2.2:60080`; in release the API URL is an HTTPS host and the only literal is library code. |
| W11 | debug | code | SHA-1 is weak | accepted (library) | Library classes; the app does not call `MessageDigest.getInstance("SHA-1")` (grep over `cetele/android`). |
| I1 | both | code | The app logs information | accepted | Debug: three app classes (`SyncEngine`, `BillingLinkWorker`, Room database implementation); release: library classes after R8. The app's log calls carry no phone number, token or amount (log-sample tests exist on the server side; the Android side was not separately sampled: **not exercised**). |
| S | both | network, code, trackers | Clear text disallowed (base config), SSL pinning, no trackers (0 of 432) | secure | |
| I2 | release | code | Uses SQLCipher, ensure secrets are not hardcoded | info | The passphrase is created per install and kept in the vault (`VaultKeys.DB_PASSPHRASE`). |

## 5. Open items

- H4: trace `defpackage/hr2` to its library with the R8 mapping of a release build and decide (update the library or accept with the reason).
- Re-scan a signed release build with the real API host and pins once they exist.
- MobSF is not part of CI (spec asks for the scan, not a gate); `ops/mobsf/run-mobsf.sh` reproduces it locally.
