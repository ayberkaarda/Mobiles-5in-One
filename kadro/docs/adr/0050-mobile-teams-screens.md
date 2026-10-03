# ADR-0050: Mobile teams: screens, invites and roster writes

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 2, §5 (teams endpoints), §8 (i18n); ADR-0005, ADR-0008, ADR-0011,
  ADR-0013, ADR-0034, ADR-0047, ADR-0048; authorization matrix §3.3; threat model T-MOB-04

## Context

The mobile foundation (ADR-0047) lists the user's teams in the Takımlar tab. Users also need to
create a team, see its roster, invite players by link or QR code, join with a code, leave, and,
as captain or co-captain, change roles and remove members. The API for all of this exists
(`packages/contracts` endpoints `createTeam` .. `removeMember`). Three things shape the client:

- invite codes are credentials: shown once, stored only as a hash on the server (ADR-0011);
- what a role may do is decided by the server (matrix §3.3, ADR-0008); the app must not offer
  controls the server will refuse, and must not depend on hiding them;
- the app must stay usable on a poor connection, with saved lists shown offline (ADR-0047).

## Decision

### Routes

- `takim/yeni` (create), `takim/katil` (join with a code), `takim/[id]` (team and roster),
  `takim/[id]/davet` (invites), `takim/[id]/uye/[userId]` (one member) and `mac/[code]` (invite
  link target). They sit in the root stack inside the signed-in guard, above the tabs, so they keep
  the tab bar's state and are never reachable signed out.
- `mac/[code]` matches the invite URL the API returns (`https://<web origin>/mac/<code>`, already
  in the app's universal-link paths) and `kadro://mac/<code>`. A code that is not 22 base64url
  characters is rejected on the device without a request.
- A code typed or pasted on `takim/katil` (bare code or any link carrying `/mac/<code>`) stays in
  that screen's state and is not put into the route.

### Data

- All calls go through the shared API client: bearer token, single-flight refresh, problem
  details, GET retries only. A teams API module wraps the contract paths; ids are URL-encoded and
  the client's path check refuses anything that would leave its segment.
- Query keys: the roster lives under the persisted `teams` root (`teams/detail/<id>`) and is shown
  from the saved cache when the network fails, with the "showing saved data" notice. Invite
  metadata (`team-invites`) and the invite preview (`invite-preview`, whose key carries the code)
  use roots outside the persisted allow-list and are memory only; the preview is dropped as soon as
  no screen shows it.
- A created invite (code and link) is kept only in the invites screen's state: not in a query, not
  in the mutation cache after the screen closes, never on disk. Mutations are never persisted
  (ADR-0047).

### Writes and optimistic updates

- Optimistic only where the effect is one field the server is about to confirm and a rollback is
  exact: a role change between co-captain and player, and removing another member. On failure the
  previous roster is put back and the catalog copy is shown, unless a refetch has replaced the
  optimistic roster meanwhile (that data is newer and is kept).
- After every write the affected queries are invalidated and refetched in the background; a write
  never waits for that refetch, so a screen navigates as soon as the server confirmed the write,
  even when a GET on a weak connection runs through its retries.
- Not optimistic: captaincy transfer (two rows change and the actor's own role), leaving (the team
  disappears from every list), creating and joining (server-assigned ids), creating and revoking
  invites.
- Roster writes of one team share a mutation key; roster controls are disabled while one runs, so
  two optimistic writes never overlap and a rollback never undoes another write. Every submit goes
  through the single-flight action of the auth screens, so a double press sends one request.
- Transfer, removal, leaving and revoking ask for confirmation in place (the question is announced
  as an alert); nothing is sent before "confirm".
- After leaving, the team's roster, matches and invites are dropped from the cache and the team is
  removed from the saved list before the screen returns to the tab.

### Roles in the UI

- Controls follow matrix §3.3: only the captain changes roles and never their own; `captain` on
  another member is the transfer; the captain removes anyone else, a co-captain removes players
  only; the captain cannot leave and is told to transfer first; captain and co-captain manage
  invites; a read-only (`isProLocked`) team offers no new invite. The server stays the authority
  and its refusal is shown with the catalog copy.

### Copy, accessibility

- New `teams` namespace (tr first, en). Failures use the error catalog (ADR-0048); copy that
  depends on the screen stays in `teams`: an invalid invite (the uniform 404 of ADR-0034, final,
  no retry), "already on this team" (409 `already_participant`), a team that is gone (404).
- Every control is at least 44 pt with a spoken name; roster rows are one element each; the QR code
  is one image with a label and the link and code are also shown as selectable text.

### Things not available in this branch

- There is no district list endpoint here, so a new team uses the district of the user's profile;
  without one, the screen sends the user to the profile. A district picker follows once
  `GET districts` is available to the app.
- No clipboard module: sharing uses the system share sheet (which offers copy), and the code and
  link are selectable.
- The QR code uses `react-native-qrcode-svg` (already a dependency); team badge upload, renaming
  and deleting the team are not part of these screens.

## Consequences

- A user can create, join, manage and leave teams from the phone; a role-dependent control appears
  only where the server would allow it.
- Invite codes never reach device storage through the query cache.
- The roster can look updated for a moment before the server refuses; the rollback and the error
  message follow within the same request.

## Rejected alternatives

- **Optimistic captaincy transfer.** The actor's own role changes too; a refused transfer (for
  example 403 `entitlement_required`) would briefly show controls the user does not have.
- **Keeping created invites in the query cache.** The cache under an allowed root is written to
  AsyncStorage; the code would outlive the screen on disk.
- **Native alert dialogs for confirmation.** In-place confirmation keeps focus order predictable
  for screen readers and can be tested without a device.
