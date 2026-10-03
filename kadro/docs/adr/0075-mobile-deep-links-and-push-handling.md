# ADR-0075: Mobile deep links and push notification handling

- Status: Proposed
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 8, §4 (push), §7 (app linking), §8 (i18n); ADR-0031, ADR-0034,
  ADR-0040, ADR-0045, ADR-0047, ADR-0049, ADR-0052, ADR-0053, ADR-0054; threat model T-MOB-01,
  T-MOB-03, T-NOT-02

## Context

ADR-0045 fixed one path set for the web, the `kadro://` scheme and verified https links. The
screens behind those paths exist (invite `mac/[code]`, venue `saha/[slug]`, the Eksik Var tab, the
two email-link screens), and the app config registers the scheme and, with a web origin, the
associated domains and Android intent filters. What was missing:

- every target except the email links sits behind the signed-in guard, so a signed-out user who
  opens an invite link lands on the entry screen and the invite is lost after signing in;
- `/eksik-var/<il>/<ilce>` had no route: the tab's own path is `/eksik-var`, and ADR-0052 keeps
  other routes out of that folder;
- unknown links (the spec's `kadro://match/<code>`) fell through to the router's "unmatched" page;
- ADR-0054 built push registration on a settings tap only; receiving and opening notifications,
  and the start-up token refresh of ADR-0031, were left to this work package.

## Decision

### Incoming links

- `app/+native-intent.tsx` (`redirectSystemPath`) sees every link the operating system hands to
  the app, at cold start and while running. It parses the link with the app's copy of the
  contracts parser (`src/links/deep-links.ts`; the contracts package brings zod and is not bundled,
  so a test runs both parsers over the same links) and returns the route to open:
  - invite, venue and district links open `/mac/<code>`, `/saha/<slug>` and
    `/eksik-var?il=<il>&ilce=<ilce>`;
  - email links, and malformed links under one of the five paths, are left unchanged: the email
    screens read the token from the URL themselves (fragment first, ADR-0040), and the invite and
    venue screens show their "invalid link" state;
  - any other path on the app scheme or the configured web origin opens `/` (the guard then shows
    the entry screen or the tabs), as ADR-0045 asks for `kadro://match/<code>`;
  - links of other schemes (development client, sign-in redirects) and other origins are not
    touched. A future sign-in redirect on the `kadro://` scheme has to be added to the pass-through
    list.
- https links are accepted only on `EXPO_PUBLIC_WEB_ORIGIN` when it is a bare https origin; local
  builds without it accept the custom scheme only.

### Pending link across the sign-in

- When the user is not known to be signed in (signed out, or the stored session is still being
  read at a cold start), a session target is also held in a memory-only store
  (`src/links/pending.ts`). It is never persisted: an invite code is a bearer value for joining a
  team (ADR-0034), so it must not outlive the process or reach AsyncStorage (T-MOB-01). Only the
  latest link is held.
- The entry screen says that an invite waits for the sign-in. After a registration the user still
  signs in (ADR-0049), and the held link survives that while the app runs.
- The root stack opens the held link once the status is `signedIn` and drops it; if the router
  already shows that route (a signed-in cold start), it is only dropped. The district link is
  opened again in that case, because the tab path alone does not carry the district.
- Opening a held link performs no action: the invite screen still needs the "join" tap (T-MOB-03).

### District link

- The Eksik Var tab reads `il` and `ilce` route parameters, looks the district up in
  `GET districts` by province and district slug, and sets the district filter once per link. An
  unknown district shows a notice and the unfiltered list. The location is never read.

### Notifications

- Foreground: a notification that arrives while the app is open shows as a banner and in the list,
  without sound or badge.
- Tap (also when it started the app): `data` is validated against the closed type list and the
  type's reference key (`matchId`, `teamId`, `applicationId`, UUIDv7); anything else is ignored.
  - a match opens under its team; the team comes from `GET matches/:id` (which also primes the
    cache), and the matches tab opens if that read fails;
  - `team.member_joined` opens the team;
  - application types have no route and no read by id in the contracts: `application.received`
    opens the matches tab and `application.decided` the Eksik Var tab (handoff
    `wp3-8-to-contracts`). Update (ADR-0079): their `data` now carries the call's `matchId`;
    `application.received` opens the staff view of that call (`/ilan/mac/<matchId>`) and
    `application.decided` opens the match (the Eksik Var tab when that read is refused).
  - A tap while signed out is dropped: the notification may belong to an account that signed out
    on this device (ADR-0054 open item), and the next user must not be routed by it. Each response
    is handled once per process and then cleared.
- Start-up refresh: once per sign-in, when the permission is already granted, the token is
  registered again (`POST me/push-tokens`, ADR-0031 `last_seen_at`). It never shows the system
  prompt; a failure is silent and leaves the settings action.

### Permission

- The matches tab shows a card while the user has not decided: what Kadro sends (reminders, lineup
  changes, applications) and that other players' names never appear. "Turn on" starts the system
  prompt and registers the token; "Not now" hides the card on this device (AsyncStorage
  `kadro.pushPrompt`, a device preference without account data, like `kadro.language`). The system
  prompt is never shown without a tap (ADR-0054).
- When the user refused in the system settings, the settings screen offers "open phone
  settings", the only way back after a refusal.
- Copy is in the `common`, `auth` and `opencalls` namespaces, Turkish first, English mirrored.

## Consequences

- One parser decides what a link is; the contracts parser and the app copy are compared by test.
- An invite link opened before sign-in is no longer lost while the app runs; quitting the app
  drops it by design.
- Router behaviour on a device (guard plus link, cold start from a notification, the operating
  system opening a verified link) is not covered by unit tests; the pure decisions are
  (`routeIncomingLink`, `pendingLinkStep`, `parseNotificationData`, `notificationHref`), and the
  device paths belong to the Maestro flows. Verified https links need the web origin, Apple team id
  and Android fingerprints (ADR-0045 §4); push needs an EAS project id and FCM configuration in the
  build, which local builds do not have (push reported as unavailable).
- `push-instance.ts` holds the push port and state apart from the settings wiring, so the matches
  tab card and the root layout do not read the build-time web origin.

## Rejected alternatives

- **Persisting the pending invite.** Survives a restart, but stores a bearer code in unencrypted
  storage and could open an invite for a different account later.
- **Opening the invite screen to signed-out users.** The preview and the join both need a session;
  a second, signed-out invite screen would duplicate ADR-0050's flow.
- **A route under `eksik-var/` for the district link.** ADR-0052 keeps that folder to the tab.
- **Routing notification taps for signed-out users after the next sign-in.** Another account
  could sign in on a shared device.
- **Asking for the permission at first launch.** Refused by both stores' guidelines without
  context, and ADR-0054 already rejected an untriggered prompt.
