# ADR-0079: Required profile entitlements and the match id in application notifications

- Status: Proposed
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0031, ADR-0052, ADR-0063, ADR-0065, ADR-0075, ADR-0077; handoff
  `wp3-8-to-contracts`; `packages/contracts/src/users.ts`, `packages/contracts/src/jobs.ts`,
  `apps/worker/src/push/recipients.ts`, `apps/mobile/src/notifications/routing.ts`

## Context

Two contract items were left open by earlier work packages:

1. ADR-0065 made the server send `entitlements` on every profile response (`GET me`, `PATCH me`
   and the `user` of the sign-in responses), but the contract member stayed optional because the
   mobile test fixtures built profiles without it. The app treated a missing member as "no Pro".
2. ADR-0031 puts only `{ type, applicationId }` in the `data` of `application.received` and
   `application.decided`. The app has no screen keyed by an application id and the API has no
   read that turns one into its call or match, so ADR-0075 opened a tab for both types. The
   handoff `wp3-8-to-contracts` offered two ways out: the match id in the notification data, or a
   new read `GET me/applications/:id`.

## Decision

### `me.entitlements` is required

- `meResponseSchema.entitlements` is required; `null` and a missing member are rejected. The
  OpenAPI `Me` schema lists it as required.
- The mobile fixtures that build a profile use the contracts constant `NO_ENTITLEMENTS`. The app's
  "missing means free" fallback is removed (`isPro` reads `me.entitlements.pro`; the settings
  screen reads the status directly). A profile that is not loaded yet still means no Pro.

### Match id in application notifications (handoff option 1)

- The `data` of both application types is `{ type, applicationId, matchId }`, where `matchId` is
  the match of the application's open call. Every other type keeps its single reference key.
- The `push.send` job is unchanged (`refId` stays the application id). The worker's recipient
  resolution already joins the application, its call and the match to check access and fill the
  template; it returns the match id from that same row, and the handler adds it to `data`. The id
  is read at send time like the rest of the payload, so it cannot disagree with the access check.
- The contracts describe the full shape as `pushNotificationDataSchema` (a closed union per type
  group) and the OpenAPI document lists it as the component `PushNotificationData`. It is not an
  HTTP body; it documents what a client may find in a notification.
- Routing in the app:
  - `application.received` (captain and co-captains) opens the staff view of that match's call,
    `/ilan/mac/<matchId>`, which lists the applications;
  - `application.decided` (applicant) opens the match through `GET matches/:id`; an accepted
    applicant reads it as a guest (ADR-0052), a rejected one is refused and the Eksik Var tab opens.
- The app requires `matchId` on application types and ignores a payload without it, the same as
  any other payload outside the contract. The app is not released, so no older notification
  without the key reaches an installed client; non-reminder notifications are dropped after 6 h
  anyway (ADR-0031).
- No new endpoint is added. The match id discloses nothing new to the recipient: the captain
  already reads the match, and the applicant reaches it only through the guest projection, where
  authorization applies.

## Consequences

- The type every client reads matches what the server sends; a server change that dropped
  `entitlements` would fail contract and web tests instead of silently showing "free".
- A tap on an application notification opens the call or match instead of a tab. The routing
  decision is unit tested (`parseNotificationData`, `notificationHref`, compared with the contracts
  schema); the device path stays with the end-to-end flows.
- Notification `data` grows by one id for two types; no names or text are added, so the content
  rules of ADR-0031 hold.

## Rejected alternatives

- **`GET me/applications/:id`.** Needs a new route, policy rows and tests, and one more request on
  every tap, for an id the worker already has at send time.
- **A second id on the `push.send` job.** Producers would have to load the match id and the job
  would carry a value that can go stale before sending; reading it in the handler keeps one source.
- **Keeping `entitlements` optional.** Leaves dead fallback code in the app and lets a server
  regression pass the type checks.
