# ADR-0008: Push notifications and Google sign-in in the Android app

- Status: Accepted
- Date: 2026-10-25

## Context

Urgent help depends on push: when someone opens an urgent post, the worker (`urgent.fanout`) sends an FCM message to the volunteers whose saved home area is within their radius. The app must register its FCM token with `PUT /v1/me/device-token` together with an installation id (the API moves a token between accounts only when the same installation presents it), keep the registration fresh, remove it on sign-out, and open the post when a notification is tapped. Sign-in also offers "Google ile devam et" (ADR-0005), verified by the API against the Android OAuth client id. ADR-0004 requires an ADR for every new third-party runtime package.

Two parts of the configuration are owner secrets that do not live in the repository: the Firebase project file `google-services.json` and the Android OAuth client id for Google sign-in.

## Decision

- Push uses `Xamarin.Firebase.Messaging` 124.1.2 (the .NET for Android binding of Firebase Cloud Messaging, published by Microsoft from Google's AAR). It is the only supported way for a MAUI Android app to obtain an FCM registration token and receive FCM messages. Versions 125.x pull AndroidX libraries newer than the ones `Microsoft.Maui.Controls` 10.0.110 pins (NU1608 conflicts on Lifecycle, Fragment and Collection), so 124.1.2 is the newest version that restores cleanly against the MAUI pins; move to 125.x together with the next MAUI update.
- Everything above the platform sits behind `Patika.App.Core.Push.IPushTokenProvider`. The app registers the FCM adapter (`Patika.App/Push/FcmPushTokenProvider`) only when a Firebase app exists at start-up, which happens only when the build included `google-services.json`; otherwise it registers `NoPushTokenProvider` and Settings says notifications are not set up in this build. The csproj picks up `app/Patika.App/google-services.json` only if the file exists, and `app/.gitignore` keeps it out of git.
- The installation id is a random UUID created on first use and kept in SecureStorage. It is not derived from any hardware or advertising identifier. `PushRegistration` registers after every sign-in, when FCM rotates the token and at most every 12 hours on resume (the API ignores devices it has not seen for a while); it removes the token before sign-out, before account deletion and when the user turns notifications off. It is best effort and never blocks sign-in or sign-out.
- Notifications use two channels that the worker names: `urgent` (high importance) and `general`. A tap opens the launcher activity with the data payload (`type=urgent`, `urgentId`); the app routes to the urgent post once the Shell is ready. `POST_NOTIFICATIONS` is declared and asked for only when the user turns urgent alerts or notifications on.
- Google sign-in is wired through `IGoogleSignIn`. Until the owner provides the Android OAuth client id, the app registers `NotConfiguredGoogleSignIn`, and the Google buttons (sign-in and the deletion re-check) explain that it is not available yet. No Google sign-in package is added now. The planned implementation is the AndroidX Credential Manager with the Google ID option (`Xamarin.AndroidX.Credentials` and `Xamarin.GoogleAndroid.Libraries.Identity.GoogleId`), recorded here so adding it needs only the version pins and the client id.

Package review (ADR-0004):

- Purpose: FCM token and message delivery for urgent help. Alternatives: polling the API (battery, delays, no delivery while the app is closed), a third-party push service (another processor of volunteers' device tokens, still FCM underneath on Android), `Plugin.Firebase` (a wider community wrapper around the same bindings with analytics, auth and storage modules the app does not need).
- Maintenance: Microsoft's `dotnet/android-libraries` repository publishes the bindings alongside Google's releases. License: MIT for the bindings; Firebase Android SDK under Apache-2.0 (listed in the app's About screen).
- Data access: Firebase Messaging talks to Google's FCM servers with the Firebase installation id and the registration token. The app sends no profile, location or analytics data to Firebase; Analytics is not added. The API stores the token, the installation id and the environment with the account.
- Update policy: pinned in `Directory.Packages.props`, updated with MAUI releases, checked for vulnerabilities in CI with the other pins.

## Consequences

A build without `google-services.json` runs normally with push off, which keeps CI, forks and contributors' builds free of secrets. The owner adds the file on the release machine (Firebase console, Android app `app.patika.android`, download `google-services.json` into `app/Patika.App/`) and sets the worker's FCM service account. Google sign-in stays disabled until the owner creates the Android OAuth client (package `app.patika.android` with the signing certificate's SHA-1) and the Credential Manager adapter replaces `NotConfiguredGoogleSignIn`; the API's `Google:ClientIds` must then list that client id. The Firebase bindings add their AndroidX and Play services dependencies to the APK. Background notification display relies on Google Play services on the device.
