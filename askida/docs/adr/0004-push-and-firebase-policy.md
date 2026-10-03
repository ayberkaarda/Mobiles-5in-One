# ADR-0004: Push notifications and Firebase configuration policy

- Status: Accepted
- Date: 2026-10-03
- Deciders: Ayberk (owner)

## Context

Push notifications ("new item hung near you", "your item was taken", merchant alerts) are delivered
through Firebase Cloud Messaging on Android and APNs on iOS. The client needs a Firebase client
configuration file per platform (`google-services.json` on Android and `GoogleService-Info.plist`
on iOS). Server-side delivery needs a service account credential.

The client configuration files are public by design: they identify the Firebase project to the SDK
and are shipped inside every app binary; access is governed by Firebase security rules and server
credentials, not by hiding them. The service account credential and the Apple APNs key are secrets
and must never be committed. The project also forbids placeholder strings in tracked files, and a
secret scanner runs over the full history.

## Options considered

1. Commit real client configuration files for a real Firebase project: simple builds, but ties the
   public repository to an account and invites key-restriction mistakes.
2. Commit placeholder configuration files: breaks the no-placeholder rule and the secret scanner.
3. Keep client configuration files out of the repository, document where they live, and make the
   app and server work without them through a transport abstraction (chosen).

## Decision

- Client configuration files are not committed. Their local paths are
  `app/android/app/google-services.json` and `app/ios/Runner/GoogleService-Info.plist`; both are
  listed in the ignore rules, and a maintainer who owns a Firebase project places them there for a
  real build.
- Server secrets (the Firebase service account JSON, the Apple team and key identifiers, the APNs
  key) are read only from server environment through `config/*.php`, never committed.
- Push delivery sits behind a `PushTransport` interface on the server and an optional
  initialisation hook in the app. Transports: `fcm` (real adapter) and `log` (writes the payload
  shape to the application log with no network call, selected in `local` and test environments;
  configuration validation rejects it elsewhere). This follows the pattern of the push transport in
  the sibling Kadro project: a real adapter in the code, a local simulated transport, and a
  configuration schema that rejects the simulated one outside local and test.
- The app builds and runs without Firebase configuration: when the files are absent, push
  registration is skipped and the device token endpoint is not called.
- Payload rules (checked by tests in a later phase): donor pushes never contain a recipient
  identifier; payloads carry ids and a short Turkish text only; fan-out is capped by the cost guard.

## Consequences

- A clean clone builds and tests without any Firebase account.
- Real delivery over FCM or APNs is not exercised in this repository (see ADR-0006, gate G4).
- Enabling real push is a documented manual step: place the two client files, set the server
  environment values, switch the transport.
- Whether the client configuration of a real project is ever committed is a separate owner
  decision; this record keeps them out by default.

## Not verified

- Current FCM HTTP v1 and APNs token requirements were not checked against provider documentation
  for this record.
