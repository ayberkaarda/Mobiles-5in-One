# Askıda: MobSF static analysis (Android)

| | |
|---|---|
| Status | Two local runs against the prod-flavor release APK: run 1 on the Phase 6 base, run 2 after the manifest and Gradle changes in section 4. Android only. |
| Tool | MobSF **v4.5.4**, Docker image `opensecurity/mobile-security-framework-mobsf:latest`, digest `sha256:83bc8aaf940d66344b7c10ebc12e921086bec43369a8259582e6dc258f2924b0`; static analysis through the REST API (`/api/v1/upload`, `/api/v1/scan`, `/api/v1/report_json`, `/api/v1/scorecard`). |
| iOS | **Not exercised: no macOS, no IPA.** Nothing in this report applies to the iOS build. |
| Signing | The APK is signed with the local **Android debug key**: no release keystore exists in the repository or on the build machine. Release signing is described in `docs/release/signing.md`. |
| Evidence rule | Every number below comes from the JSON report and the scorecard of the run named next to it. The JSON and HTML reports are not committed. |

## 1. What was scanned

| Property | Run 1 | Run 2 |
|---|---|---|
| Build command | `flutter build apk --release --flavor prod --dart-define-from-file=env/example.json` (Flutter 3.47.6) | same |
| Source | `feat/askida-p6` (1ae6765) | the same base plus the changes in section 4 |
| Package | `app.askida.mobile` 0.1.0, minSdk 24, targetSdk 36 | same |
| Size | 80.6 MB (all ABIs) | 80.6 MB |
| SHA-256 | `fe2e319b86a5e1668ca1f6c95baf2ac35b1e9ccd714de03fff72bf360f3bafe5` | `fa9b7afdca71d8fba8bd6349cb55b3945a8b0c9be23e42e9ea0898df429513b9` |
| Shrinking | R8 (APKiD reports compiler `r8`) | R8, now also stated in `build.gradle.kts` |
| Public configuration | `env/example.json` (sample values, no keys) | same |

## 2. Score

| | Run 1 | Run 2 |
|---|---|---|
| Security score | **54 / 100** | **54 / 100** |
| High | 3 | 3 |
| Warning | 9 | 8 |
| Info | 2 | 2 |
| Secure | 3 | 3 |
| Hotspot | 1 | 1 |
| Trackers | 0 of 432 | 0 of 432 |

Run 2 drops the `allowBackup` warning. The score does not move because MobSF weighs the three
high findings, which are a property of the local build variant and of the undeployed domain
(H1, H3) or a product decision (H2), not of the code.

## 3. Findings and classification

Classification: **fix** (changed in this phase), **accepted** (real, kept, reason given),
**false positive**, **variant** (artifact of the local debug-signed build, re-check on a
store build).

### 3.1 High

| # | Section | Finding | Class | Reason |
|---|---|---|---|---|
| H1 | certificate | Application signed with debug certificate (`CN=Android Debug`, v2 scheme, SHA-256) | variant | No release keystore exists (portfolio rules: no store account). Store builds are signed with the upload key and Play App Signing (`docs/release/signing.md`); re-scan a signed build before a release. |
| H2 | manifest | Can be installed on Android 7.0 (`minSdk=24`) | accepted | `minSdk` follows the Flutter default (`flutter.minSdkVersion`). Raising it to 29 is a reach decision for the product owner; listed as an open question. |
| H3 | manifest | App Link `assetlinks.json` not found for `https://askida.app` (`MainActivity`, `/dukkan/`) | accepted until launch | The server answers `/.well-known/assetlinks.json` from `WEB_ANDROID_CERT_SHA256`; the domain is not deployed (no domain in the portfolio setup), so the check cannot pass. Re-scan once the domain serves the release fingerprint. |

### 3.2 Warning

| # | Section | Finding | Class | Reason |
|---|---|---|---|---|
| W1 | manifest | `android:allowBackup` flag missing (backup on by default) | **fix** | Run 2: `allowBackup="false"`, `fullBackupContent="false"` and `dataExtractionRules` excluding every domain from cloud backup and device transfer. The finding is gone in run 2. |
| W2 | network | Base config trusts system certificates | accepted | Intended: `cleartextTrafficPermitted="false"` with system trust anchors only; user-installed CAs are not trusted. No certificate pinning (a pin would need a rotation plan for a domain that does not exist yet). |
| W3 | manifest | `com.google.android.gms.auth.api.signin.RevocationBoundService` exported, protected by a permission | accepted (library) | Merged from `google_sign_in`; guarded by the Play services permission `REVOCATION_NOTIFICATION`. Not declared by the app. |
| W4 | manifest | `androidx.profileinstaller.ProfileInstallReceiver` exported, protected by `android.permission.DUMP` | accepted (library) | AndroidX profile installer; `DUMP` is a signature/privileged permission. |
| W5 | code | Raw SQL queries (4 files) | false positive for the app | All four hits are in R8-renamed library classes (`defpackage/*`); none is in `app.askida.mobile`. The app's local cache is drift (`drift`, `drift_flutter`) with parameterised statements built from its schema classes, on non-sensitive data. |
| W6 | code | Temp file creation (2 files) | accepted (library) | Library code (R8-renamed); the app writes no secret to a file. Tokens are kept in `flutter_secure_storage` (`lib/core/storage/secure_token_store.dart`). |
| W7 | code | Insecure random number generator (4 files) | false positive for the app | Library code (`java.util.Random` in UI and engine helpers). The anonymous id and the redemption flows do not use it: codes are created on the server. |
| W8 | code | Read/write external storage (1 file) | accepted (library) | Library code; the app declares no storage permission and writes nothing to shared storage. |
| W9 | secrets | "May contain hardcoded secrets" | false positive | The matched strings are hex and digit lookup tables, mangled C++ symbol names from the bundled ML Kit / TensorFlow Lite and S2 geometry libraries, one UUID and four hex digests found in library code, and three Base64 label strings of `flutter_secure_storage` (they decode to fixed English sentences naming the storage key and its prefix, not to key material; the key itself is created per device in the Android Keystore). `env/example.json` holds no key. No string is an Askıda credential. |

### 3.3 Info, hotspot and secure

| # | Section | Finding | Class | Reason |
|---|---|---|---|---|
| I1 | code | The app logs information (291 files, Flutter engine and plugins) | accepted (library) | Engine and plugin logging (`io/flutter/**`, `com/baseflow/geolocator/**` and R8-renamed classes). The app's Dart code has no `print`, `debugPrint` or `log(` call (`grep -rn` over `app/lib`). |
| I2 | code | Copies data to the clipboard (2 files) | accepted (library) | R8-renamed library classes (text editing copy and paste of the Flutter embedding). The app's Dart code does not use `Clipboard`. |
| P1 | permissions | 3 dangerous permissions: coarse location, fine location, camera | accepted | Coarse location for nearby shops (recipients), fine location optional for donors and merchants, camera for the merchant code scanner (`android.hardware.camera` not required). All requested at use time. |
| S1 | network | Clear text disallowed for all domains | secure | `network_security_config.xml` (prod). |
| S2 | code | Root detection capabilities | secure | Library code (R8-renamed); APKiD also reports emulator checks on `Build.*` fields. |
| S3 | trackers | No privacy trackers | secure | 0 of 432 known trackers. |

No finding was raised for `debuggable` (false in both runs) or for exported activities without
protection: the only exported activity is the launcher `MainActivity` (deep links), and MobSF
counts 0 exported activities, 1 exported service and 1 exported receiver, both from libraries
(W3, W4).

## 4. Changes made in this phase

| File | Before | After |
|---|---|---|
| `app/android/app/src/main/AndroidManifest.xml` | `allowBackup` not set (Android default: backup on) | `allowBackup="false"`, `fullBackupContent="false"`, `dataExtractionRules="@xml/data_extraction_rules"` |
| `app/android/app/src/main/res/xml/data_extraction_rules.xml` | absent | excludes `root`, `file`, `database`, `sharedpref`, `external` from cloud backup and device transfer (Android 12+) |
| `app/android/app/build.gradle.kts` | release shrinking and `debuggable` left to the Flutter Gradle plugin defaults | release build type states `isDebuggable = false`, `isMinifyEnabled = true`, `isShrinkResources = true` (same effective values as the plugin defaults, now explicit) |

Unchanged and verified by the scan: `usesCleartextTraffic="false"` in the main manifest, the prod
network security config (HTTPS only, system anchors), no `debuggable` release.

## 5. Commands

```bash
# Build (askida/app)
bash tool/codegen.sh
flutter build apk --release --flavor prod --dart-define-from-file=env/example.json

# MobSF on host port 58537; the API key is random per run and never written to the repository
docker run -d --name askida-p6scan-mobsf -p 127.0.0.1:58537:8000 \
  -e MOBSF_API_KEY="$MOBSF_KEY" opensecurity/mobile-security-framework-mobsf:latest
curl -F "file=@app-prod-release.apk" -H "Authorization: $MOBSF_KEY" http://127.0.0.1:58537/api/v1/upload
curl -X POST -H "Authorization: $MOBSF_KEY" --data "hash=<md5>" http://127.0.0.1:58537/api/v1/scan
curl -X POST -H "Authorization: $MOBSF_KEY" --data "hash=<md5>" http://127.0.0.1:58537/api/v1/report_json
curl -X POST -H "Authorization: $MOBSF_KEY" --data "hash=<md5>" http://127.0.0.1:58537/api/v1/scorecard
```

Run 1 MobSF hash (MD5 of the APK): `8d817cae9a6a749e4d154aac3794894a`; run 2:
`6e04747a0d74796eead63f322df39e40`.

## 6. Not exercised

- iOS: no macOS, no IPA.
- A store-signed APK or AAB: no release keystore, no Play Console account (H1 stays `variant`).
- App Link verification: no deployed domain (H3).
- Dynamic analysis (MobSF dynamic analyzer, Frida): not part of the Phase 6 scope.
- MobSF in CI: not added; the scan is a local release step (it needs a release build and a
  running MobSF container).
