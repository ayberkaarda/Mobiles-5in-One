# ADR-0052: Mobile open calls (Eksik Var): list, apply, publish and decide

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 6, §5 (open-call endpoints), §8 (i18n); ADR-0003, ADR-0010,
  ADR-0013, ADR-0017, ADR-0037, ADR-0041, ADR-0045, ADR-0047, ADR-0048, ADR-0050, ADR-0051;
  authorization matrix §3.5 footnotes 18–22, 30, 33

## Context

The Eksik Var tab of the mobile foundation (ADR-0047) listed open calls without filters, and
nothing opened. Free players need to find calls by district, level and position and apply with
a short note; captains and co-captains need to publish a call from a match, decide the
applications and close the call. The API for this exists (`listOpenCalls`, `publishOpenCall`,
`closeOpenCall`, `createApplication`, `listApplications`, `decideApplication`, plus
`listDistricts`). Four facts of that API shape the client:

- there is no single-call read (`GET open-calls/:id`); the public projection (footnote 18) has no
  match id and no team id;
- the match response does not carry its open call, so the staff view of a call exists only in the
  publish and close answers;
- `GET open-calls/:id/applications` answers staff with every row, an applicant with their own row
  and everyone else with 404 (ADR-0041), which is exactly the relationship the detail screen
  needs;
- every decision depends on state the device cannot see (other applicants, free places, expiry;
  ADR-0003).

## Decision

### Routes

- The tab `(tabs)/eksik-var` lists calls. A call opens at `ilan/[id]`; the call of a match (staff)
  at `ilan/mac/[matchId]`. Both are in the root stack inside the signed-in guard. They are not
  under `eksik-var/`, because `/eksik-var/<il>/<ilce>` is the district link of the app-link set
  (ADR-0045) and a call or match segment there would make those links ambiguous.
- The match screen shows an "Eksik Var ilanı" button inside its staff block (one component from
  the open-call area, so the match screen gains one line).

### List and filters

- Filters: district (searched by name or province from `GET districts`, Turkish letters folded),
  level (ADR-0017) and position; each is sent as its query parameter, "any" sends nothing. Only a
  district id is sent; the device location is never read or sent. If the district list cannot be
  loaded, the list still works without the district filter.
- A row shows the team, start, format, the venue name (verified venues) or the district, the
  position and the missing count. Opening a row keeps that call for the detail screen.
- Map view: not built. `react-native-maps` is a dependency, but its config plugin and Google Maps
  API key are not set up (deps work package note), the public projection carries no coordinates
  (only the district centroid would be available) and a map cannot be tested without a device.
  The list is the only view for now.

### Call detail and the viewer's relationship

- The call comes from the cached lists (newest copy first), else the copy kept when it was
  opened; a call the app has never seen shows a final "not found" without any request.
- The relationship is read from `GET open-calls/:id/applications`: 404 → may apply; own row →
  "applied" with its status (and withdraw while pending, after a confirmation); any other answer
  → the viewer is staff of the call's team and sees the applications to decide. A team member who
  is not staff gets 404 too; their application is refused with `already_participant`, which turns
  the screen into "you are already in this match's team".
- Applying needs a verified email (matrix §3.5 `V`) and an active call (before `expires_at` and
  the start). The note is optional plain text up to 280 characters, checked like
  `createApplicationRequestSchema` (a test compares both); an empty note sends no field.
- An ended call (time passed since the list was read) shows "this call has ended" and no apply
  control.

### Publishing, deciding, closing (staff)

- Publishing is offered per footnote 19: staff, team not read-only, match `open`, at least one
  free place, and a start no earlier than the earliest possible end of a call (now + 15 minutes +
  2 minutes of slack for a form left open and the request's travel time). Missing count
  1..min(29, slots − confirmed); position (or any); level; district optional (default: the
  venue's or the team's, server side); expiry as a choice relative to the start (kick-off, 1 h,
  3 h or 24 h before), offered only when it lies in `[now + 17 min, starts_at]`. The publish gate
  and the expiry choices use the same threshold, so the form is shown only when at least the
  kick-off can be chosen.
- The publish answer (and the close answer) is kept in memory for the match. A kept call counts as
  live only while it is stored `open`, before its end and before the start, and while the match
  itself is still `open` (a lock, cancel or played status closes the call on the server); otherwise
  it is shown as the last call, read-only, without accept or reject.
- A live call this device did not publish (another staff member or device) is recognized when
  publishing answers `open_call_exists`, or when a cached public list holds a call with the
  match's team name and start. The publish form is then hidden; the screen says that the call's
  details and applications cannot be shown here, offers to open the listed call (where staff see
  and decide the applications) and offers to close the call by match id, with a confirmation that
  warns that pending applications not visible here are rejected and cannot apply again.
- Accept and reject are offered on pending applications while the call is active (footnote 21);
  reject asks for a confirmation (a rejected applicant cannot apply again, ADR-0010).

### Data and writes

- Persisted query keys (`open-calls` root): `list/<filters>` and `call/<id>`, both the public
  projection; districts under `districts/list` (stale after a day). The last copies are shown
  offline with the "showing saved data" notice.
- Memory-only keys (`open-call-private` root, not in the persisted allow-list):
  `applications/<id>` (other users' notes and profile cards) and `match/<matchId>` (the staff view
  of the call). They are never written to the device, like the team invites (ADR-0050). Sign-out
  clears every key (ADR-0047).
- Nothing is optimistic. Apply, withdraw, publish, close, accept and reject wait for the server;
  the answer is written into the cache and the related lists refetch in the background (never
  awaited, ADR-0050). An acceptance, on either screen, lowers the missing count of every kept
  staff copy of that call by one, closing it at zero as the server does (footnote 21), since there
  is no read of the call to confirm it. It also marks the match stale: the match id comes from the
  screen or from a kept copy of the call; when neither knows it (staff deciding from the public
  list), every cached match detail is marked stale. Any 409 re-reads the applications.
- Writes on one call share a mutation key, and so do writes on one match's call; the controls are
  disabled while one runs.

### Copy, accessibility

- New `opencalls` namespace (tr first, en); failures use the error catalog (ADR-0048).
- Choices are radio buttons of at least 44 pt; accept buttons carry the applicant's name in their
  spoken label; application notes are rendered as plain text, never as links (ADR-0037).

## Consequences

- Story 6 works on the phone end to end against the existing API: find, apply, decide, close.
- Known limits, recorded as contract handoffs rather than worked around: no single-call read (a
  shared or restored link to a call the app never listed shows "not found"); no open-call field on
  the staff match view (a call published from another device is recognized only through
  `open_call_exists` or a cached list entry, and its applications are reachable only while it is
  listed; the kept copy lasts until the app restarts); no match id
  for an accepted applicant (the guest cannot open the match from the call; ADR-0051 notes the
  same gap); `GET districts` is in the contracts but not yet served by the web app.

## Rejected alternatives

- **Optimistic apply.** The server checks expiry, membership and uniqueness the device cannot
  see; a shown "applied" that is then refused would mislead the player about the match.
- **Reading the call by paging the public list.** Unbounded requests to find one id, and an
  expired or full call would still not be found.
- **Device location for "near me".** Not needed: the API filters by district id, and reading the
  location would add a permission prompt and a privacy label for no extra result.
- **Routes under `eksik-var/`.** Collides with the district link path of ADR-0045.
