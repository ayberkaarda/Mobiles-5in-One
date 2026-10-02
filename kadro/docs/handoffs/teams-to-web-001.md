# Handoff teams → web 001

- From: team, invite and member endpoints (`apps/web/app/api/v1/teams/**`, `invites/**`,
  `apps/web/lib/server/teams/**`, Phase 2)
- To: owner of the `apps/web` API core (`lib/server/http.ts`, `tests/route-coverage.test.ts`,
  `tests/security/idor.test.ts`) and the domain endpoint owners (matches, open calls, venues,
  uploads, me)
- Status: open

## 1. Endpoint-group rate limits are not in `route()` yet

`route()` wires only group A. The team endpoints enforce their groups themselves through
`lib/server/teams/rate-limit.ts` (`enforceGroupLimit(runtime, ctx, group)`): limits and key kinds
come from `RATE_LIMIT_GROUPS`, keys are `group:<G>:user:<keyed hash>` / `group:<G>:ip:<keyed hash>`,
and a `user+ip` group charges both counters together (`hitAll`). Group G is one budget per user
across **all** authenticated mutations, so every domain endpoint must charge the same key.

Request: move `enforceGroupLimit` into `lib/server` and apply it in `route()` after validation
(matrix §2 step 3) from the registry's `rateLimit` field, then drop the explicit calls from
`lib/server/teams/*`. Until then, other domain endpoints should import the helper rather than
build their own keys.

Acceptance: one G counter per user across endpoints; group I keyed by IP for anonymous preview and
by user + IP for signed-in callers; existing tests in `tests/teams` stay green.

## 2. Shared test files touched minimally

- `tests/route-coverage.test.ts`: `PUBLIC_AUTH` lists `/api/v1/invites/[code]` with `optional`
  (registry `previewInvite`, matrix footnote 28). `GET open-calls`, `GET venues` and
  `GET venues/[slug]` need the same when they land.
- `tests/security/idor.test.ts`: the negative coverage example used `DELETE /api/v1/teams/[id]` as an
  unregistered route; it now uses `DELETE /api/v1/teams/[id]/badge`. Team, invite and member rows
  were added with their own fixtures (`victimTeam(world)`), `World` is unchanged.

## 3. Waitlist promotion on member removal (ADR-0005, ADR-0035)

`removeMember` deletes the leaver's RSVPs on `draft` / `open` / `locked` matches under row locks on
those matches (lock order: team row, then matches by id) and promotes the oldest waitlisted RSVPs
while confirmed players are below `slots`. When the RSVP endpoints add a shared promotion routine,
removal should call it instead of its local copy. Notifications (captain on a `locked` match,
`rsvp.promoted`, `team.member_joined`) are not sent: there is no job enqueue helper yet
(handoff `decisions-to-web-001` §1).

## 4. Media URLs

`badgeUrl` (teams, invite preview) and `avatarUrl` (roster) are `null`: `WebEnv` has no public
media origin (ADR-0030, handoff `decisions-to-config-001`). `lib/server/teams/projections.ts`
`publicMediaUrl()` is the single place to fill once the setting exists.
