# Deep links and push notifications

Decisions: ADR-0045 (link paths), ADR-0034 (invites), ADR-0075 (link and push handling), ADR-0031
(push), ADR-0079 (application push carries the match id). Code: `apps/mobile/src/links/`,
`apps/mobile/src/notifications/`, `apps/mobile/src/settings/push*.ts`, `apps/mobile/app/+native-intent.tsx`
and `apps/mobile/app.config.ts`.

## Schemes and registered links

- Custom scheme `kadro://` (`APP_SCHEME`). It is always registered: an Android `VIEW` intent filter
  for the scheme, and `scheme: 'kadro'` for iOS.
- Universal links (iOS `applinks:<host>` associated domain) and verified Android app links
  (`autoVerify`, `https`) are registered only when `EXPO_PUBLIC_WEB_ORIGIN` is a bare https origin
  (no path, query, fragment or credentials). `universalLinkHost` returns `null` otherwise, so a
  misconfigured value never produces an association. The `.env.example` value
  `http://localhost:3000` therefore registers the custom scheme only.
- Registered path prefixes (`UNIVERSAL_LINK_PATHS` in `app.config.ts`): `/mac`, `/saha`,
  `/eksik-var`, `/e-posta-dogrula`, `/sifre-sifirla`.
- https links are accepted only on the configured web origin (`allowedLinkOrigins`).

## Link kinds

`parseLink` in `src/links/deep-links.ts` mirrors `parseDeepLink` in
`packages/contracts/src/deep-links.ts` (a test runs both over the same links). Anything not listed
is not a link: another origin, an unknown path, a malformed code, slug or token.

| Link (scheme or web origin)      | Kind            | Opens                                  | Session needed |
| -------------------------------- | --------------- | -------------------------------------- | -------------- |
| `/mac/<code>`                    | `teamInvite`    | `app/mac/[code].tsx`                   | Yes            |
| `/saha/<slug>`                   | `venue`         | `app/saha/[slug].tsx`                  | Yes            |
| `/eksik-var/<il>/<ilce>`         | `openCalls`     | `/eksik-var?il=<il>&ilce=<ilce>` (tab) | Yes            |
| `/e-posta-dogrula#token=<token>` | `verifyEmail`   | `app/e-posta-dogrula.tsx`              | No             |
| `/sifre-sifirla#token=<token>`   | `resetPassword` | `app/sifre-sifirla.tsx`                | No             |

Rules: invite codes must pass `isInviteCode`; slugs are 1 to 80 lower-case ASCII words joined by
single dashes; tokens come from exactly one `token` key of the fragment and must be opaque
(`isOpaqueToken`), and are never decoded. The email screens also accept a router parameter or a
query value for the custom scheme (`src/auth/link-token.ts`, fragment first). A link only navigates:
joining a team, applying, or redeeming an email token always needs an explicit tap or submit on the
screen it opens (threat model T-MOB-03).

## Routing decision (`app/+native-intent.tsx`)

Every link the operating system hands to the app (cold start and while running) passes through
`redirectSystemPath`, which calls `routeIncomingLink(path, status, linkOrigins())`:

- A recognized session target returns its route. When the user is not known to be signed in it is
  also stored as pending.
- An email link, and a malformed link under one of the five paths, is left unchanged: the screen
  reads the token itself or shows its "link invalid" state.
- Any other path on the app scheme or the web origin opens `/` (for example `kadro://match/<code>`,
  which ADR-0045 says is not a link). The Maestro flow `deep-links` checks this.
- Links of other schemes (development client, sign-in redirects) and other origins are not touched.
- A parser error never crashes the app: the link is handed to the router unchanged.

## Pending link across the sign-in

- State: `pendingLink` (`src/links/instance.ts`, store in `src/links/pending.ts`). Memory only and
  never persisted, because an invite code is a bearer value for joining a team. A newer link
  replaces an older one; quitting the app drops it.
- The welcome screen shows `welcome-invite-pending` while an invite is held. After registration the
  user still signs in (the API issues no session on register); the held link survives that while
  the app runs.
- `usePendingLink` (root layout) waits until the status is `signedIn`, then opens the link with
  `router.push` and clears it. If the router already shows that route (a signed-in cold start where
  the status was still `unknown` when the link arrived) it only clears it; the district link is
  always opened again because the tab path does not carry the district.
- Opening the held link performs no action: the invite screen still needs the "join" tap.
- Invite screen (`src/teams/InviteJoin.tsx`): `GET invites/:code` preview (name, badge, member
  count; invalid, expired, revoked and exhausted codes all look like a 404 and are final),
  `POST invites/:code/accept` on the tap; a team that was joined already shows `invite-member`.
- District link: the Eksik Var tab looks the district up in `GET districts` by province and
  district slug and sets the filter once per link (`src/links/district.ts`); an unknown district
  shows `district-link-missing` and the unfiltered list. The device location is never read.

## Push registration

Code: `src/settings/push.ts` (logic and port), `src/settings/push-native.ts` (`expo-notifications`),
`src/notifications/` (prompt, start-up refresh, tap routing).

- Port: `PushPort` has `platform`, `permission()`, `requestPermission()` and `expoToken()`.
  `createNativePushPort` reports `platform: null` (push unavailable) when there is no EAS project id
  (`extra.eas.projectId` or `Constants.easConfig`), so local builds without an EAS project show push
  as unavailable and never fail at start-up. On Android the `default` channel is created before the
  permission prompt (Android 13+).
- `registerDevice`: asks for permission if needed (`denied` returns `'denied'`, an undecided prompt
  returns `null`), reads the Expo push token, checks it against the contract pattern
  (`ExponentPushToken[...]`, at most 256 characters) and sends `POST /api/v1/me/push-tokens` with
  `{ expoToken, platform }`. Results: `unavailable`, `denied`, `registered`, `failed`.
- The explanatory card on the matches tab (`PushPrompt`, `push-prompt`) shows only while the
  permission is undecided and the user has not chosen "not now" (`kadro.pushPrompt` in AsyncStorage,
  kept across sign-outs). The system prompt starts only on the "turn on" tap
  (`push-prompt-enable`). The same action exists in Settings (`push-enable`, `push-open-settings`).
- Start-up refresh (`usePushRefresh`, ADR-0031): once per sign-in, when the permission is already
  granted, the token is registered again silently (it refreshes `last_seen_at`). It never shows the
  system prompt, and a failure only leaves Settings showing "register this device".
- The registered flag (`pushStore`) is memory only and reset at every sign-out.

## Receiving and tapping notifications

- Foreground: a notification shows as a banner and in the list, without sound or badge
  (`configureForegroundNotifications`).
- Tap, including a tap that started the app (`useNotificationRouting` with
  `Notifications.useLastNotificationResponse`): each response id is handled once per process. A tap
  while signed out is dropped, as is any action other than the default one, so the next user on the
  device is not routed by another account's notification. While the status is `unknown` the tap
  waits.
- Payload (`src/notifications/routing.ts`): `data` is `{ type, matchId | teamId | applicationId }`
  validated against the closed list of nine types and the type's reference key (UUIDv7). Application
  types also require the call's `matchId` (ADR-0079); a payload without it is ignored. Nothing else in a
  notification is trusted, and the app only navigates; the screen it opens loads the object through
  the API where authorization applies.

| Type                                                                                                            | Reference                  | Opens                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `match.reminder_24h`, `match.reminder_2h`, `match.updated`, `rsvp.changed`, `rsvp.promoted`, `lineup.slot_free` | `matchId`                  | `/takim/<teamId>/mac/<matchId>`; the team id comes from `GET matches/:id`. When that read fails the matches tab `/maclar` opens.              |
| `team.member_joined`                                                                                            | `teamId`                   | `/takim/<teamId>`                                                                                                                             |
| `application.received`                                                                                          | `applicationId`, `matchId` | Staff view of the call, `/ilan/mac/<matchId>`                                                                                                 |
| `application.decided`                                                                                           | `applicationId`, `matchId` | The match through `GET matches/:id` (an accepted applicant can read it as a guest); when that read is refused, the Eksik Var tab `/eksik-var` |

A notification for an object the user lost access to therefore ends on that screen's "not found"
state or on a tab.

## Not verified

Push delivery needs a device build, an EAS project id and FCM / APNs credentials; verified https
links need a public domain with the association files. Neither is exercised by the unit tests (they
use fakes for the port and parse links as strings) or by the Maestro flows, which cover the
`kadro://` scheme only. See `running-and-testing.md`.
