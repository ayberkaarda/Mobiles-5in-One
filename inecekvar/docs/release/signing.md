# Signing and app association

How the Android and iOS builds are signed for the stores, where the keys live and how the web
servers prove the app owns its links. **No key material exists for this project and none is ever
committed.** Every step below is `not exercised: no Google Play or Apple developer account, no
macOS host` (ADR-0005).

## 1. Current state of the repository

- `apps/mobile/android/app/build.gradle`: the `release` build type has no `signingConfig`. A
  release build produces `app-release-unsigned.apk` (the input of the release MobSF scan,
  `docs/security/scan-reports/mobsf-static.md`); it cannot be uploaded to a store.
- `applicationId "app.inecekvar.mobile"`, `versionCode 1`, `versionName "1.0"` (same file).
- `inecekvar/.gitignore` ignores `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `google-services.json`,
  `GoogleService-Info.plist`. It does **not** ignore `apps/mobile/android/key.properties`; add that
  line (owner of root configs: lead) before anyone creates the file of section 2.
- The Gradle file applies the Google services plugin when `app/google-services.json` exists
  (Capacitor template). The app uses no Firebase service; the file must not be created.
- No iOS platform exists (`@capacitor/ios` is not a dependency, no `ios/` directory).
- CI builds only a debug APK, on manual dispatch (`Inecek Var Android (manual)` in
  `.github/workflows/inecekvar-ci.yml`); no workflow holds a signing secret.
- `.gitleaks.toml`, the pre-commit hook and the CI history scan guard the history; the procedure
  for an accident is `docs/security/history-purge-runbook.md`.

## 2. Android

| Item                           | Decision                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution                   | Google Play with **Play App Signing**: Google creates and keeps the **app signing key**; the project holds only an **upload key**                              |
| Upload key                     | one RSA 2048 key in a PKCS12 keystore, alias `upload`, created once with `keytool`                                                                             |
| Custody                        | the release owner's machine, in an encrypted volume, plus an offline copy in the password manager; never in the repository, a CI log, an image layer or a chat |
| Loss or leak of the upload key | request an upload key reset in Play Console (possible because Play keeps the app signing key); rotate per runbook section 6 row 12                             |
| Store artefact                 | Android App Bundle (`bundleRelease`)                                                                                                                           |

Create the upload key (once, on the owner's machine; the passwords are typed at the prompt, not
passed as arguments):

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore upload-keystore.jks \
  -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Suggested Gradle wiring, **not applied** (code change for the mobile owner):

```groovy
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.withInputStream { keystoreProperties.load(it) }
}
android {
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            if (keystorePropertiesFile.exists()) {
                signingConfig signingConfigs.release
            }
        }
    }
}
```

`key.properties` (next to `apps/mobile/android/`, ignored, never committed) holds `storeFile`
(an absolute path outside the repository), `storePassword`, `keyAlias=upload`, `keyPassword`.

### 2.1 Fingerprints for `assetlinks.json`

The web server serves `/.well-known/assetlinks.json` for `app.inecekvar.mobile` from
`IV_WEB_ANDROID_CERT_SHA256` (comma-separated, 32 bytes each as `AA:BB:...`, upper-cased by the server;
an invalid value stops the start-up; unset means 404) (`apps/web/src/server/config.ts`,
`server/machine-files.ts`, ADR-0039 item 13).

With Play App Signing, the device sees the **app signing key**, so that fingerprint is required:

1. Play Console, the app, "Test and release", "App integrity", "App signing": copy the
   **SHA-256 certificate fingerprint** of the app signing key.
2. Also add the upload key fingerprint if builds signed with the upload key are installed outside
   Play (internal testing by side-loading):

   ```sh
   keytool -list -v -keystore upload-keystore.jks -alias upload | grep "SHA256:"
   ```

   or, from a signed bundle or APK: `keytool -printcert -jarfile app-release.aab`.

3. Set `IV_WEB_ANDROID_CERT_SHA256="<app signing SHA-256>,<upload SHA-256>"` on the web server.
   Fingerprints are public values; they are not secrets.
4. Check after deployment: `curl -s https://inecekvar.app/.well-known/assetlinks.json`, then
   `adb shell pm verify-app-links --re-verify app.inecekvar.mobile` and
   `adb shell pm get-app-links app.inecekvar.mobile` on a device with the store build.

Gap found while writing this: the Android intent filter (`AndroidManifest.xml`) declares
`autoVerify` for **both** `inecekvar.app` and `app.inecekvar.app`, including `/giris/baglanti`
(the magic-link page) and `/hat/`. Only the web SSR server (`inecekvar.app`) serves
`assetlinks.json`; the PWA host `app.inecekvar.app` (Caddy static site, `ops/Caddyfile`) serves
none. Links on `app.inecekvar.app`, among them every magic link
(`INECEKVAR_MAGIC_LINK_BASE_URL=https://app.inecekvar.app/giris/baglanti`), will stay unverified
until the PWA host serves the same file. Owner: lead (`ops/Caddyfile`) with the mobile owner.

## 3. iOS (when the platform exists)

| Item             | Decision                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team             | the owner's Apple Developer team; its 10-character **Team ID** (Apple Developer, Membership details)                                                                                                                      |
| Signing          | Xcode automatic signing on the release Mac, or an App Store Connect API key (`.p8`) for CI; the `.p8` and any `.p12` stay outside the repository                                                                          |
| Association      | `/.well-known/apple-app-site-association` from `IV_WEB_IOS_TEAM_ID` (`^[A-Z0-9]{10}$`; unset means 404): `appIDs: ["<TEAM_ID>.app.inecekvar.mobile"]`, components `/*/hat/*` and `/*/durak/*` (`server/machine-files.ts`) |
| Entitlement      | Associated Domains `applinks:inecekvar.app` (and `applinks:app.inecekvar.app` once that host serves the file)                                                                                                             |
| Smart App Banner | `IV_WEB_IOS_APP_ID` (the numeric App Store id, 6 to 12 digits)                                                                                                                                                            |

The AASA components cover line and stop pages only; the magic-link page `/giris/baglanti` opens
in the browser on iOS until a component is added (web owner) and the PWA host serves the file.

## 4. No keys in the repository

Never commit: keystores, `key.properties`, `.p8`, `.p12`, provisioning profiles, the JWT PEM
pair, the age identity, `google-services.json`. The CI placeholder and banned-word greps do not
catch key files; gitleaks and the ignore list do. A key that reaches a commit is rotated first
(runbook section 6), then purged with the owner's approval.

## 5. CI secret names (suggested, none created)

For a future manual-dispatch release job; GitHub encrypted secrets of an environment `release`
with required reviewers:

| Secret                                                                     | Content                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IV_ANDROID_UPLOAD_KEYSTORE_B64`                                           | base64 of the upload keystore, decoded to a temp file in the job                                                                                                              |
| `IV_ANDROID_UPLOAD_KEYSTORE_PASSWORD`                                      | keystore password                                                                                                                                                             |
| `IV_ANDROID_UPLOAD_KEY_ALIAS`                                              | `upload`                                                                                                                                                                      |
| `IV_ANDROID_UPLOAD_KEY_PASSWORD`                                           | key password                                                                                                                                                                  |
| `IV_PLAY_SERVICE_ACCOUNT_JSON`                                             | Play Developer API service account, only if uploads are automated                                                                                                             |
| `IV_APPLE_API_KEY_P8_B64`, `IV_APPLE_API_KEY_ID`, `IV_APPLE_API_ISSUER_ID` | App Store Connect API key, only with a macOS runner                                                                                                                           |
| `IV_REVENUECAT_PUBLIC_SDK_KEY`                                             | the **public** SDK key (`goog_...` / `appl_...`), not a secret, but kept out of the source because `environment.ts` has no per-build replacement (see `release-checklist.md`) |

The job writes the keystore to `$RUNNER_TEMP`, never echoes a secret and deletes the file at the
end; the artefact is the signed bundle only.
