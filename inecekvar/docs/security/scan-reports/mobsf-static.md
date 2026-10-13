# Inecek Var: MobSF static analysis of the Android APK

| | |
| --- | --- |
| Spec item | 23 (native assessment, Android part); item 10 (no cleartext on Android). |
| Status | Three local runs on 2026-10-13: the debug APK before the manifest fix, the debug APK after it and the unsigned release APK after it. One real manifest weakness (app data backup) was fixed; the remaining findings are properties of the debug build, of `minSdk` 24 or of third-party SDK code, each accepted below with its reason. No finding is in the app's own code (one `MainActivity` class). |
| Tool | MobSF **v4.5.4**, image `opensecurity/mobile-security-framework-mobsf@sha256:83bc8aaf940d66344b7c10ebc12e921086bec43369a8259582e6dc258f2924b0` (pinned in `ops/security/mobsf/run-mobsf.sh`). |
| Input | `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` and `.../release/app-release-unsigned.apk`, built from this branch (PWA production build, `cap sync android`, Gradle with JDK 21, `--offline`). The APKs are not committed. |
| Reports | `docs/security/scan-reports/mobsf-before/`, `mobsf-after/`, `mobsf-release/` (`scan.json`, `report.json`, `scorecard.json`), ignored by git. The numbers below come from `scorecard.json` and `report.json`. |
| Decisions | ADR-0055. |

## 1. Commands

```bash
cd inecekvar
pnpm nx build mobile && (cd apps/mobile && npx cap sync android)
cd apps/mobile/android
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot" ./gradlew --offline assembleDebug assembleRelease
cd ../../..
IV_MOBSF_SUFFIX=-after   ops/security/mobsf/run-mobsf.sh <copy of app-debug.apk>
IV_MOBSF_SUFFIX=-release ops/security/mobsf/run-mobsf.sh <copy of app-release-unsigned.apk>
# "before": the same build with the manifest of commit 4f1bff93 (allowBackup="true", no network
# security config), restored afterwards
IV_MOBSF_SUFFIX=-before  ops/security/mobsf/run-mobsf.sh <copy of that app-debug.apk>
# transport attributes read back from the compiled manifests (aapt2)
node apps/mobile/scripts/android-transport-check.mjs --apk <app-debug.apk>
node apps/mobile/scripts/android-transport-check.mjs --apk <app-release-unsigned.apk> --release
```

aapt2 read-back: debug `usesCleartextTraffic=false allowBackup=false networkSecurityConfig=@0x7f110005 debuggable=true`; release `usesCleartextTraffic=false allowBackup=false networkSecurityConfig=@0x7f110005 debuggable=absent`, `Android transport check passed (APK)` for both (the `--release` form fails on the debug APK: `debuggable in a release build`).

## 2. Results

| | Debug, before the fix | Debug, after | Release (unsigned), after |
| --- | --- | --- | --- |
| Security score | 49 | 53 | 56 |
| High | 3 | 3 | 2 |
| Warning | 11 | 11 | 11 |
| Info | 2 | 2 | 2 |
| Secure | 2 | 3 | 3 |
| Hotspot | 1 | 1 | 1 |
| Trackers | 0 | 0 | 0 |
| Exported components | 2 receivers | 2 receivers | 2 receivers |

The warning count stays at 11 after the fix because MobSF adds "base config trusts system certificates" once a network security config exists; the backup warning is gone.

## 3. Findings and dispositions

| Finding (MobSF title) | Where | Before | After | Disposition |
| --- | --- | --- | --- | --- |
| Application Data can be Backed up [android:allowBackup=true] | manifest | yes | no | **Fixed** (commit `cbcee65e`): `allowBackup="false"`, `fullBackupContent` and `dataExtractionRules` exclude every domain from cloud backup and device transfer (refresh token, ride drafts with GPS points, packs). Guarded by `scripts/android-transport-check.mjs` in `mobile:lint`; mutation "allowBackup true" fails it. |
| (no finding) cleartext | network | no config | "disallow clear text traffic to all domains" (secure) | **Fixed/hardened**: `res/xml/network_security_config.xml` with `cleartextTrafficPermitted="false"` and system trust anchors only, referenced from the manifest next to `usesCleartextTraffic="false"`. |
| Base config is configured to trust system certificates | network | n/a | warning | **Accepted**: the system store is the intended trust anchor; user-added authorities are not trusted outside `debug-overrides` (none exist). Certificate pinning is not adopted: the API and tiles sit behind rotating public certificates and a wrong pin locks every installed copy out (ADR-0055). |
| Debug Enabled For App [android:debuggable=true] | manifest | high | high | **Accepted, debug build only**: absent from the release APK (aapt2 read-back above, release scan has no such finding). |
| Application signed with debug certificate | certificate | high | high | **Accepted, debug build only**; the release scan reports "Missing Code Signing certificate" instead because the release APK is unsigned here. Store signing keys stay outside the repository (spec item 1, ADR-0036). |
| App can be installed on a vulnerable unpatched Android version 7.0 [minSdk=24] | manifest | high | high | **Accepted**: `minSdk` 24 is the Capacitor 8 default recorded in ADR-0001 (stack table), kept for reach in the target market; the app holds no data that depends on newer platform protections beyond what the backup and transport settings cover. Revisit when the store statistics exist. |
| Broadcast Receiver `com.amazon.device.iap.ResponseReceiver` protected by a permission | manifest (RevenueCat SDK, Amazon billing) | warning | warning | **Accepted**: added by the RevenueCat SDK (ADR-0004 allowlist); protected by `com.amazon.inapp.purchasing.Permission.NOTIFY`, which only the Amazon store holds; the app never uses the Amazon store. |
| Broadcast Receiver `androidx.profileinstaller.ProfileInstallReceiver` protected by `android.permission.DUMP` | manifest (AndroidX) | warning | warning | **Accepted**: AndroidX baseline-profile receiver; `DUMP` is a signature/privileged permission. |
| Hardcoded sensitive information; may contain hardcoded secrets | code and strings (Capacitor, RevenueCat, Amazon SDK) | warning | warning | **False positive**: the flagged "secrets" are elliptic-curve domain constants (P-256, P-384, P-521 primes and generator coordinates) and SDK field names; the app's RevenueCat public key is empty in this build and is public by design (spec item 1). No project credential is in the APK. |
| Insecure random, SHA-1, MD5, temp files, IP address disclosure, logging, external storage, app directory writes | code (Amazon IAP SDK, RevenueCat SDK, Capacitor bridge and filesystem plugin) | warning/info | warning/info | **Accepted, third-party code**: none of the flagged classes is project code. The filesystem plugin's external-storage path is the legacy API for Android 9 and older; packs are written to `Directory.Data`, the app data directory (ADR-0034). Upstream SDK updates come through Renovate (ADR-0051). |
| SSL certificate pinning detected | code (Amazon SDK) | secure | secure | Informational. |
| 2 critical permissions (fine and coarse location) | permissions | hotspot | hotspot | **Accepted**: foreground location for nearby lines and the ride recorder (ADR-0004); no background location. |

## 4. Not exercised

- iOS IPA: no macOS host, so no Xcode build and no MobSF iOS scan; App Transport Security stays at its defaults (no exceptions in the repository).
- Dynamic analysis (MobSF dynamic, Frida, a device or emulator with traffic interception): not run.
- A store-signed release build (no signing key on this host, by design).
