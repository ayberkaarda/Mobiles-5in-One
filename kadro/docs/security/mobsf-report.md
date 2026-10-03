# Kadro — MobSF Static Analysis (Android)

|               |                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status        | **Run once, locally, against an Android release APK built from `main` (88cc98f).** No production code was changed. One finding needs a configuration change (§4, handoff `mobsf-1`). |
| Tool          | MobSF **v4.5.4**, Docker image `opensecurity/mobile-security-framework-mobsf:latest` (digest `sha256:83bc8aaf940d…2924b0`), static analysis only, REST API.                          |
| Companions    | `docs/security/attack-report.md` §4 (this closes its "MobSF static scan: not run" row for Android only), `docs/security/threat-model.md`, `docs/handoffs/mobsf-1-to-owner.md`        |
| Evidence rule | Every result below comes from the JSON report and scorecard of this run. Steps that were not run are listed as **not run** in §6.                                                    |

---

## 1. What was scanned

| Property      | Value                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Build variant | `assembleRelease` (not debug): `debuggable` is false and the release `network_security_config.xml` is used.                                   |
| Signing       | The Expo template's local release config signs with the **Android debug keystore**. Store builds are signed by EAS with the upload key.       |
| ABI           | `arm64-v8a` only (`-PreactNativeArchitectures=arm64-v8a`) to shorten the build; the Java/Kotlin and manifest surface is the same for all ABIs |
| JavaScript    | Hermes bytecode (`hermesEnabled=true`), new architecture on. R8 minification off (template default `android.enableMinifyInReleaseBuilds`).    |
| Public env    | `EXPO_PUBLIC_APP_ENV=preview`, `EXPO_PUBLIC_API_URL=https://kadro.app`, `EXPO_PUBLIC_WEB_ORIGIN=https://kadro.app`, RevenueCat keys empty     |
| Package / SDK | `app.kadro.mobile` 0.1.0 (versionCode 1), minSdk 24, targetSdk 36                                                                             |
| APK           | 53.99 MB, SHA-256 `21f0a3ef5c8b864d9d243b631530369f8eaa352c312dc500289e0d9cfa43f835`                                                          |

The APK was built in a scratch copy of the repository outside the working tree; no native project
or APK was committed.

## 2. Score

MobSF security score: **48 / 100**. Scorecard totals: 5 high, 16 warning, 2 info, 3 secure, 2
hotspot. Trackers: **0** of 432 known trackers detected.

The score is dominated by build-variant artifacts (debug certificate) and third-party library code;
see the triage. None of the code findings is in the app's own package (`app/kadro/**`): every file
MobSF flagged belongs to Expo modules, React Native community modules, RevenueCat, the Amazon
Appstore SDK pulled in by RevenueCat, or Glide.

## 3. Findings and triage

Triage values: **fix** (real, our configuration, needs a change), **accepted** (real but acceptable,
reason given), **variant** (artifact of the local build variant), **false positive**, **upstream**
(inside a third-party library, not our code; tracked by dependency updates).

### 3.1 High

| #   | Category    | Finding                                                                           | Triage                  | Reason                                                                                                                                                                                                                                                                                                                 |
| --- | ----------- | --------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | certificate | Application signed with debug certificate (`CN=Android Debug`)                    | variant                 | Local `assembleRelease` uses the template's debug signing config. Store builds are signed by EAS; re-check on an EAS build (§6).                                                                                                                                                                                       |
| H2  | certificate | Certificate algorithm vulnerable to hash collision (SHA-1, v2 scheme only)        | variant                 | Property of the shared Android debug keystore. Re-check on an EAS build.                                                                                                                                                                                                                                               |
| H3  | manifest    | Can be installed on unpatched Android 7.0 (`minSdk=24`)                           | accepted                | minSdk 24 is the Expo SDK 57 / React Native 0.86 floor. Raising it is a product reach decision, listed as an open question.                                                                                                                                                                                            |
| H4  | manifest    | App Link `assetlinks.json` not found for host `kadro.app`                         | accepted (until launch) | The web app serves `/.well-known/assetlinks.json` only when `ANDROID_CERT_SHA256_FINGERPRINTS` is set (`apps/web/lib/server/app-links.ts`); the production origin is not deployed. Release checklist item: re-scan after the domain serves the store fingerprint.                                                      |
| H5  | code        | Remote WebView debugging enabled (`expo/modules/logbox/ExpoLogBoxWebViewWrapper`) | upstream                | `@expo/log-box` calls `setWebContentsDebuggingEnabled(true)` in the LogBox overlay WebView. The overlay is created by the development error surface; the app has no WebView of its own (no `'use dom'` component, no WebView import). Reachability in release builds was judged from source, not verified at run time. |

### 3.2 Warning

| #   | Category      | Finding                                                                                                                                                              | Triage         | Reason                                                                                                                                                                                                                                                                                              |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | network       | Base config trusts system certificates                                                                                                                               | accepted       | Intended: `cleartextTrafficPermitted="false"` with system anchors only; user-installed CAs are not trusted. The app does not pin certificates.                                                                                                                                                      |
| W2  | manifest      | `android:allowBackup=true`                                                                                                                                           | accepted       | Backup is restricted by `expo-secure-store`'s rules to shared preferences minus `SecureStore`, so the refresh token is excluded and the AsyncStorage database (persisted query cache) is not included.                                                                                              |
| W3  | manifest      | `taskAffinity` set on `expo.modules.webbrowser.BrowserProxyActivity`                                                                                                 | upstream       | `expo-web-browser` (auth session redirect activity); not set by our config.                                                                                                                                                                                                                         |
| W4  | manifest      | Exported receivers protected by permissions: `FirebaseInstanceIdReceiver` (`c2dm.permission.SEND`), Amazon IAP `ResponseReceiver`, `ProfileInstallReceiver` (`DUMP`) | upstream       | Library receivers (push, RevenueCat's Amazon store, AndroidX profile installer) guarded by system / signature permissions.                                                                                                                                                                          |
| W5  | code          | Files may contain hardcoded sensitive information (52 files)                                                                                                         | false positive | Glide cache keys, RevenueCat preference / cache key names, Amazon SDK constants. No credential.                                                                                                                                                                                                     |
| W6  | code          | IP address disclosure                                                                                                                                                | upstream       | Amazon Appstore SDK (`LicensingService`, `PurchasingService`).                                                                                                                                                                                                                                      |
| W7  | code / crypto | MD5 use                                                                                                                                                              | upstream       | RevenueCat `UtilsKt`, Expo asset / file-system checksums. Not used for security decisions by the app.                                                                                                                                                                                               |
| W8  | code / crypto | SHA-1 use                                                                                                                                                            | upstream       | Amazon SDK signature check, RevenueCat `UtilsKt`.                                                                                                                                                                                                                                                   |
| W9  | code / crypto | Insecure random number generator                                                                                                                                     | upstream       | Amazon SDK classes and `expo-updates` `UpdatesUtils`. The app's own nonce uses a secure source (`src/auth/nonce.ts`, no `Math.random` fallback).                                                                                                                                                    |
| W10 | code          | Insecure WebView implementation (JavaScript interface)                                                                                                               | upstream       | `ExpoLogBoxWebViewWrapper` (see H5) and `@expo/dom-webview` `DomWebView`; the app uses neither directly.                                                                                                                                                                                            |
| W11 | code          | WebView file access from URLs                                                                                                                                        | upstream       | `@expo/dom-webview` `DomWebView`; unused by the app.                                                                                                                                                                                                                                                |
| W12 | code          | Creates temp files                                                                                                                                                   | upstream       | RevenueCat paywall font / file cache, `expo-image` local file path.                                                                                                                                                                                                                                 |
| W13 | code          | Raw SQL queries                                                                                                                                                      | upstream       | `@react-native-async-storage/async-storage` internal SQLite store; keys are app-chosen constants.                                                                                                                                                                                                   |
| W14 | secrets       | "May contain hardcoded secrets" (1341 strings)                                                                                                                       | false positive | High-entropy constants from crypto / curve tables in bundled libraries. A search of the list for the project name, the RevenueCat key prefixes for Apple and Google, the Google API key prefix, the common secret-key prefix, `expo`, `sentry`, `dsn`, `password` and `secret` found **0** matches. |
| W15 | binary        | 26 native libraries without `_FORTIFY_SOURCE` functions                                                                                                              | upstream       | React Native, Hermes, Fresco, Expo native libraries built by their own toolchains.                                                                                                                                                                                                                  |
| W16 | binary        | No stack canary in `libc++_shared.so` (reported as high in the binary section)                                                                                       | false positive | NDK-provided C++ runtime; MobSF flags it on most Android apps.                                                                                                                                                                                                                                      |

### 3.3 Info, secure, hotspot

| #   | Category    | Finding                                                                                                                                           | Triage           | Reason                                                                                                                                                                                        |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | code        | App logs information                                                                                                                              | upstream         | 171 library files (Amazon, RevenueCat, Expo). Not reviewed per call.                                                                                                                          |
| I2  | code        | Writes to app directory                                                                                                                           | upstream         | RevenueCat `SharedPreferencesManager`.                                                                                                                                                        |
| S1  | network     | Base config disallows cleartext to all domains                                                                                                    | secure           | Confirms `plugins/android-network-security.js` in the release variant; `usesCleartextTraffic=false` in the manifest.                                                                          |
| S2  | code        | SSL pinning detected                                                                                                                              | n/a              | Amazon SDK class; the app itself does not pin.                                                                                                                                                |
| S3  | trackers    | No privacy trackers                                                                                                                               | secure           |                                                                                                                                                                                               |
| P1  | permissions | 4 dangerous permissions: `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` (both `maxSdkVersion=32`), `SYSTEM_ALERT_WINDOW`, `POST_NOTIFICATIONS` | **fix** (3 of 4) | `POST_NOTIFICATIONS` is needed for push. The other three come from the Expo prebuild template's default manifest; the app reads no external storage and draws no overlays. Handoff `mobsf-1`. |
| P2  | files       | Certificate file in APK: `assets/expo-root.pem`                                                                                                   | accepted         | Public Expo root certificate shipped by `expo-updates` for code-signing verification; not a private key.                                                                                      |

APKiD notes (anti-VM checks, "Kiwi encrypter", "r8 without marker") point at library dex files
(Play services, RevenueCat, Amazon SDK) and are not acted on.

## 4. Real findings in our code

| #   | Finding                                                                                                 | Owner         | Handoff                             |
| --- | ------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------- |
| P1  | Unneeded dangerous permissions `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW` | `apps/mobile` | `docs/handoffs/mobsf-1-to-owner.md` |

Nothing was fixed in this change.

## 5. Commands run

Scratch copy, install, prebuild (PowerShell; the copy lives outside the repository, `C:\km`):

```powershell
git -C <repo> archive --format=tar -o src.tar HEAD kadro
tar -xf src.tar -C C:\km
cd C:\km\kadro
Add-Content pnpm-workspace.yaml "`nnodeLinker: hoisted`n"   # scratch copy only
pnpm install --frozen-lockfile
pnpm --filter @kadro/config build
cd apps\mobile
$env:EXPO_PUBLIC_APP_ENV='preview'; $env:EXPO_PUBLIC_API_URL='https://kadro.app'
$env:EXPO_PUBLIC_WEB_ORIGIN='https://kadro.app'; $env:CI='1'
npx expo prebuild --platform android --no-install --clean
```

Build (JDK 21, Gradle 9.3.1 wrapper, Android SDK build-tools 36):

```powershell
$env:JAVA_HOME='C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"; $env:NODE_ENV='production'
cd android
.\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --console=plain
# BUILD SUCCESSFUL in 7m 19s
```

Scan (Git Bash), using `ops/mobsf-scan.sh`: starts `kadro-mobsf-<epoch>` bound to
`127.0.0.1:18000` with a random per-run API key, uploads through `/api/v1/upload`, runs
`/api/v1/scan`, saves `/api/v1/report_json` and `/api/v1/scorecard`, then `docker rm -f` on that
exact name (trap on exit):

```bash
bash ops/mobsf-scan.sh <path>/app-release.apk C:/km/mobsf-out
# starting kadro-mobsf-1791036720 (opensecurity/mobile-security-framework-mobsf:latest)
# scanning a1fdc6a98debcd1fab7533c4f4ce3aa4
docker ps -a --filter name=kadro-mobsf   # empty after the run
```

Build notes for Windows: the first two attempts failed in the native (CMake / ninja) steps, first
with `manifest 'build.ninja' still dirty after 100 tries` under pnpm's isolated layout, then with a
path-length `mkdir` error under `%LOCALAPPDATA%\Temp`. A hoisted `node_modules` layout in a short
path (`C:\km`) built cleanly.

## 6. Not covered

| Item                                       | Status      | Reason                                                                                                        |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------- |
| EAS release build (upload-key signing, R8) | **not run** | No EAS credentials here. H1, H2 must be re-checked on the EAS artifact; R8 may change the code findings list. |
| Android App Bundle (`production` profile)  | **not run** | MobSF scanned an APK; the store artifact is an AAB.                                                           |
| iOS IPA                                    | **not run** | No macOS / Xcode build here.                                                                                  |
| Dynamic analysis (MobSF dynamic, Frida)    | **not run** | Needs a rooted emulator or device session.                                                                    |
| JavaScript bundle review                   | **not run** | The bundle is Hermes bytecode; MobSF does not decompile it.                                                   |
| `expo-updates` code-signing verification   | **not run** | No `codeSigningCertificate` configured yet (`updatesConfig(undefined)` in `app.config.ts`).                   |
| `x86_64` / `armeabi-v7a` native libraries  | **not run** | Built for `arm64-v8a` only.                                                                                   |

## 7. Open questions

1. Raise `minSdk` above 24 (H3)? Product reach decision.
2. Set `android.enableMinifyInReleaseBuilds` for store builds and re-scan?
3. After launch: re-scan the EAS-signed AAB / APK once `kadro.app` serves `assetlinks.json` (H1, H2, H4).
