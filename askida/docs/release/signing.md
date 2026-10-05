# Signing

How the Android and iOS builds are signed for the stores, and where the keys live. No key
material exists for this project and none is ever committed. Status of every step is
**not exercised: no Google Play or Apple developer accounts, no macOS** (ADR-0006).

## Current state of the repository

- `app/android/app/build.gradle.kts`: the `release` build type uses the **debug signing config**.
  Every release APK built so far (including the one the mobile scan covers) is debug-signed and
  cannot be uploaded to a store.
- The Gradle file does not read `key.properties` yet. In Phase 6 that file changed only for the
  findings of `docs/security/mobsf-report.md` (section 4), so the wiring is a suggestion, not
  applied here (snippet below).
- `app/android/.gitignore` already ignores `key.properties`, `**/*.keystore` and `**/*.jks`.
  `app/android/key.properties.example` documents the file with dummy values.
- `.gitleaks.toml` and the CI secret scan guard against a key or a store credential entering the
  history; the history purge plan for an accident is `docs/security/history-purge-runbook.md`.

## Android

| Item             | Decision                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution     | Google Play with **Play App Signing**: Google holds the app signing key, the developer holds only an upload key                                                                                                                                                      |
| Upload key       | one RSA 2048+ key in a PKCS12 keystore created once with `keytool`; alias `upload`; valid 25+ years                                                                                                                                                                  |
| Where it lives   | on the release owner's machine in an encrypted store and in the password manager; **never in the repository, CI logs or an image layer**                                                                                                                             |
| `key.properties` | created next to `app/android/` from `key.properties.example` on the machine that builds; gitignored                                                                                                                                                                  |
| Loss             | an upload key can be reset through Play support when Play App Signing is on; the app signing key cannot be lost because Google keeps it                                                                                                                              |
| Build output     | an Android App Bundle for the store: `flutter build appbundle --release --flavor prod --dart-define-from-file=env/<file>.json` (the production define file holds the real `API_BASE_URL`, kept outside the repository; `env/example.json` is the only committed one) |

Creating the key (run once, on the owner's machine; values are the owner's):

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore upload-keystore.jks \
  -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Suggested Gradle wiring (not applied; see the note above):

```kotlin
val keystoreProperties = java.util.Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) load(file.inputStream())
}
android {
    signingConfigs {
        create("release") {
            if (keystoreProperties.isNotEmpty()) {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            signingConfig = if (keystoreProperties.isNotEmpty())
                signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}
```

With no `key.properties` the build falls back to the debug key, so a fresh checkout still builds.

## iOS

| Item                      | Decision                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution              | App Store through TestFlight; bundle id `app.askida.mobile`                                                                                                       |
| Certificates and profiles | an Apple Distribution certificate and an App Store provisioning profile, created in the Apple Developer account                                                   |
| Where they live           | the developer's Keychain and the Apple account; exported `.p12` files and `.p8` API keys are never committed (the purge runbook lists `*.p12`, `*.p8` as targets) |
| Capabilities to enable    | Sign in with Apple, Associated Domains (`applinks:askida.app`), Push Notifications (only once a push provider exists)                                             |
| Build                     | `flutter build ipa --release --dart-define-from-file=env/<file>.json` on macOS                                                                                    |

**Not exercised: no macOS, no Apple account.** The iOS project exists in `app/ios`, but it was
never built, signed or run for this phase. Nothing in this repository claims iOS verification, and
the store documents (`docs/seo/aso.md`, `docs/release/privacy-labels.md`) say so too.

## CI signing

Not exercised. The CI workflows build unsigned or debug-signed artifacts only. A signing job would
need the upload keystore (base64) and its passwords as repository secrets, a protected
environment with a required reviewer, and a manual dispatch trigger, never a trigger on pull
requests from forks. Store uploads stay manual (spec section 8). None of that is configured:
no accounts, no secrets.

## Key rotation and incident steps

1. Suspected exposure of the upload key: request an upload key reset in Play Console (with Play
   App Signing the app signing key is unaffected), then create a new keystore.
2. A key committed by mistake: follow `docs/security/history-purge-runbook.md` (documented, not
   executed) and rotate the key first; deleting the file from history alone is not a fix.
3. Apple certificate exposure: revoke it in the Apple Developer account and issue a new one.
