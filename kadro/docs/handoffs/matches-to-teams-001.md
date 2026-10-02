# Handoff matches → teams 001

- From: match, RSVP, lineup, payment and MVP endpoints (`apps/web/lib/server/matches/**`, Phase 2)
- To: owner of `apps/web/lib/server/teams/**` (member removal, ADR-0005)
- Status: open

## Shared waitlist promotion and drop-out notifications

`lib/server/matches/rsvp.ts` exports `promoteWaitlist(tx, runtime, { id, slots }, now)`: oldest
`waitlisted_at` first (ties by id) while `in < slots`, and one `rsvp.promoted` push per promoted
player in the caller's transaction. `confirmedCount(tx, matchId)` is exported as well.

`removeMember` (`lib/server/teams/members.ts`) still runs its local copy and sends no pushes
(teams-to-web-001 §3). Request:

1. Replace the local `promoteWaitlist` with the shared one (the caller already holds the match row
   locks in the order team → matches by id, which is the order `lockMatch` uses).
2. For a removed / leaving member who was `in` on a `locked` match, enqueue `notifyLineupSlotFree`
   to the captain; when the removed RSVP was `paid`, write the `payment.mark` audit row with
   `reason: 'rsvp_left'` as `setRsvp` does (ADR-0036).

Acceptance: `tests/teams/members.test.ts` ADR-0005 case asserts the `rsvp.promoted` and
`lineup.slot_free` jobs; promotion order unchanged.
