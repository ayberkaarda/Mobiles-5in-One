# Handoff MobSF → mobile 001

- From: MobSF static scan (`docs/security/mobsf-report.md`, finding P1)
- To: owner of `apps/mobile`
- Status: open

## Finding

The Android release APK requests three dangerous permissions the app does not use. They come from
the default manifest of the Expo prebuild template, not from a module the app needs:

| Permission               | In APK                   | Used by the app |
| ------------------------ | ------------------------ | --------------- |
| `READ_EXTERNAL_STORAGE`  | yes (`maxSdkVersion=32`) | no              |
| `WRITE_EXTERNAL_STORAGE` | yes (`maxSdkVersion=32`) | no              |
| `SYSTEM_ALERT_WINDOW`    | yes                      | no              |

`POST_NOTIFICATIONS` (also flagged as dangerous) is needed for push and stays.

## Requested change

1. In `apps/mobile/app.config.ts`, add
   `android.blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.SYSTEM_ALERT_WINDOW']`
   (Expo writes them with `tools:node="remove"`, which also strips copies merged from libraries).
2. Extend `apps/mobile/tests/build-config.test.ts` to assert the three permissions are removed in
   the prebuilt manifest.
3. Check that image picking / sharing flows, if added later, use the system photo picker rather
   than storage permissions.

## Acceptance

- A release APK built from the changed config lists none of the three permissions
  (`aapt2 dump permissions app-release.apk`).
- Re-run `ops/mobsf-scan.sh` and update the P1 row of `docs/security/mobsf-report.md`.
