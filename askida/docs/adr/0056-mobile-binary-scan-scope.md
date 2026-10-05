# ADR-0056: Mobile binary scan scope (MobSF)

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 23 asks for MobSF on the APK and the IPA. There is no macOS machine, no
Apple account, no Play Console account and no release keystore (ADR-0006).

## Decision

- Static analysis only, Android only: MobSF v4.5.4
  (`opensecurity/mobile-security-framework-mobsf:latest`, digest
  `sha256:83bc8aaf940d66344b7c10ebc12e921086bec43369a8259582e6dc258f2924b0`) through its REST API
  (upload, scan, JSON report, scorecard), run locally against
  `flutter build apk --release --flavor prod --dart-define-from-file=env/example.json`.
- The scanned APK is signed with the local Android debug key; this is stated in every report.
  Release signing is documented in `docs/release/signing.md` (ADR-0062), no key material in the
  repository.
- Two runs: before and after the manifest and Gradle changes. Every finding is classified as fix,
  accepted (with reason), false positive or variant (artifact of the debug-signed local build).
- Fixes made: `android:allowBackup="false"`, `fullBackupContent="false"` and
  `dataExtractionRules` excluding every domain from cloud backup and device transfer
  (`res/xml/data_extraction_rules.xml`); the release build type states `isDebuggable = false`,
  `isMinifyEnabled = true`, `isShrinkResources = true` explicitly (same values as the plugin
  defaults).
- MobSF stays a local release step, not a CI job (it needs a release build and a running
  container).

## Consequences

- Score 54/100 in both runs (High 3, Warning 9 then 8). The score does not move because the three
  High findings are the debug certificate (variant), `minSdk 24` (accepted, product decision) and
  the missing `assetlinks.json` on the undeployed domain (accepted until a domain exists). All code
  findings sit in R8-renamed library classes; none is in `app.askida.mobile`. 0 of 432 trackers.
- Open question for the owner: raise `minSdk` from 24 to 29 (reach against older devices).
- A store-signed build must be scanned again before a release.
- Behaviour change: Android backup and device transfer of app data are off.
- not exercised: iOS (no macOS, no IPA), a store-signed APK or AAB, App Link verification, dynamic
  analysis.
