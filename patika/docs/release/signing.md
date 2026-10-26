# Release signing

Android release signing for `app.patika.android` (.NET MAUI). **Portfolio: not published.** No upload key, Play Console app or release track exists. The build command below was run locally with a throwaway key to prove it works; the Play steps are written out but not executed.

## Keys

Patika uses **Play App Signing**:

- The **app signing key** is created and held by Google. Patika never sees it, so it cannot leak from this repository or a build machine.
- The **upload key** is Patika's own. It signs the bundles uploaded to Play. If it leaks or is lost, the owner asks for an upload key reset in Play Console (Setup → App integrity) and registers a new one. Installed apps are unaffected because they carry Google's signature.

Create the upload key once, on the owner's machine, outside the repository:

```bash
keytool -genkeypair -keystore ~/secure/patika-upload.keystore -alias patika-upload \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Patika, O=<owner>, C=TR"
```

Store the keystore file and its two passwords in the owner's password manager, with one offline copy. Never commit it, never put it in CI logs, and never place it inside `patika/`.

The Google sign-in OAuth client (ADR-0008) and any Maps key (ADR-0007) are bound to the SHA-1 or SHA-256 of the signing certificate. Use the **app signing key** certificate from Play Console for store builds and the upload or debug certificate for local builds.

## Ignore rules (verified)

`git check-ignore -v` in this worktree on 2026-10-26:

```text
patika/app/Patika.App/upload.keystore -> NOT IGNORED
patika/app/Patika.App/patika-upload.jks -> NOT IGNORED
patika/app/Patika.App/google-services.json -> patika/app/.gitignore:4:google-services.json	patika/app/Patika.App/google-services.json
patika/.env -> patika/.gitignore:3:.env	patika/.env
patika/.env.production -> patika/.gitignore:4:.env.*	patika/.env.production
patika/src/Patika.Api/appsettings.Production.json -> NOT IGNORED
```

**Gap:** `*.keystore`, `*.jks` and `appsettings.Production.json` are not ignored today. The patterns `*.keystore`, `*.jks`, `*.aab`, `*.apk` and `appsettings.Production.json` belong in `patika/.gitignore`, which is outside this change. Until then the rules are to keep the keystore outside the repository, and gitleaks in CI (`patika-ci.yml`, all refs) catches private key material in committed files. The [history purge runbook](../security/history-purge-runbook.md) covers a keystore that was committed anyway.

## Release build

The signing inputs come from MSBuild properties. The passwords are read from environment variables through the `env:` prefix, so they never appear on the command line or in the binlog:

```bash
export PATIKA_UPLOAD_STORE_PASS=...   # from the password manager
export PATIKA_UPLOAD_KEY_PASS=...
cd patika
dotnet publish app/Patika.App/Patika.App.csproj -f net10.0-android -c Release -o out/android \
  -p:AndroidPackageFormat=aab -p:AndroidKeyStore=true \
  -p:AndroidSigningKeyStore="$HOME/secure/patika-upload.keystore" -p:AndroidSigningKeyAlias=patika-upload \
  -p:AndroidSigningStorePass=env:PATIKA_UPLOAD_STORE_PASS -p:AndroidSigningKeyPass=env:PATIKA_UPLOAD_KEY_PASS \
  -p:ApplicationVersion=<versionCode> -p:ApplicationDisplayVersion=<versionName>
```

Before building, put `google-services.json` in `app/Patika.App/` for push (ADR-0008). The release build uses the HTTPS-only network security config and the production `appsettings.json` (`https://api.patika.app/`). The Debug overlay and the `10.0.2.2` cleartext exception are excluded from Release by the csproj.

Local proof on 2026-10-26 (Windows, JDK 21, `maui-android` workload 10.0.110), using a throwaway key created with the `keytool` command above in a temp directory, `ApplicationVersion=2` and `ApplicationDisplayVersion=0.1.1`:

```text
real	1m41.339s
-rw-r--r-- 1 Ayber 197609 34826383 Oct 26 06:11 app.patika.android-Signed.aab
-rw-r--r-- 1 Ayber 197609 35336315 Oct 26 06:11 app.patika.android-Signed.apk
-rw-r--r-- 1 Ayber 197609 34680479 Oct 26 06:11 app.patika.android.aab

$ jarsigner -verify app.patika.android-Signed.aab
jar verified.
$ keytool -printcert -jarfile app.patika.android-Signed.aab
Owner: CN=Patika Drill, O=Portfolio, C=TR
$ aapt2 dump badging app.patika.android-Signed.apk
package: name='app.patika.android' versionCode='2' versionName='0.1.1' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
```

Upload `app.patika.android-Signed.aab`. The unsigned `.aab` and the `.apk` are by-products; the APK is useful only for side-loading a test device.

CI (`patika-ci.yml`) builds Release unsigned (`dotnet build ... -c Release`) to prove that the app compiles. There is no signing or upload workflow, because none can exist without the upload key. If one is added, it should take the keystore as a base64 repository secret decoded into `$RUNNER_TEMP`, and run only on `workflow_dispatch` behind a protected environment.

## versionCode and versionName policy

- `versionCode` (`ApplicationVersion`) is a positive integer that grows by one for every bundle uploaded to any Play track. It is never reused, even for a rejected or deleted release, and Play's ceiling is 2,100,000,000. The value in `Patika.App.csproj` (`1`) is the last local default; release builds override it with `-p:ApplicationVersion` and tag the commit `patika-android-v<versionName>+<versionCode>`.
- `versionName` (`ApplicationDisplayVersion`) is `MAJOR.MINOR.PATCH`, the version users see. It is currently `0.1`, raised to `1.0.0` for a first public release.
- A hotfix gets a new `versionCode` and a patch bump. Rolling back means uploading the old code again under a higher `versionCode`.

## Internal testing track (not executed)

1. Play Console → create app `Patika`, default language Turkish, app type App, free, with the declarations (ads: no, and so on; see [play-listing.md](play-listing.md)).
2. Setup → App integrity → Play App Signing: accept Google-generated app signing and register the upload certificate (`keytool -export -rfc -keystore patika-upload.keystore -alias patika-upload -file upload_cert.pem`).
3. Monetize → Products → Subscriptions: create `patika_destekci` with base plans `aylik` and `yillik` (ADR-0010), then add license testers.
4. Testing → Internal testing → Create release: upload `app.patika.android-Signed.aab`, add release notes in tr-TR, and add the tester list (email list or Google Group).
5. Fill in the Data safety form from [data-safety.md](data-safety.md), the content rating questionnaire, the target audience (18+) and the privacy policy URL.
6. Roll out to internal testing and share the opt-in link with testers. Internal testing needs no review wait; the closed and production tracks do.
7. Verify on a device that the install comes from Play, push arrives (with `google-services.json`), and the Destekçi purchase shows the test-card sheet for license testers.

Not exercised: every step above, because there is no Play Console account. Also not exercised: Play App Signing re-signing, the upload key reset flow, and the real `PlayBillingClient`, which is a NotSupported stub (README).
