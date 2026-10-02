# ADR-0035: RSVP, waitlist promotion and lineup validity

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 stories 3–4; ADR-0003, ADR-0004, ADR-0005; authorization matrix §3.4
  footnotes 14–15; threat model T-MATCH-01, T-MATCH-08, T-MATCH-10

## Context

Story 3 has players answer `in | out | maybe` with an automatically promoted waitlist; story 4 has
the captain split confirmed players into two sides with auto-balance by position. The matrix fixes
who may write; this ADR fixes the state rules the domain service enforces.

## Decision

### RSVP (`PUT matches/:id/rsvp`, body `{ status: 'in' | 'out' | 'maybe' }`)

- Writable by members and guests of the match for their own row only. Allowed while the match is
  `open` and `starts_at > now()`; in `locked` only `out`. `draft`, `played`, `cancelled` → 409
  `match_not_open`.
- All RSVP writes of a match run under `SELECT … FOR UPDATE` on the match row.
- `in` when confirmed (`status = 'in'`) < `slots` → `in`; otherwise → `waitlist` with
  `waitlisted_at = now()`. The response states the resulting status.
- `out` or `maybe` from `in` clears `side`, then promotes: the waitlisted row with the oldest
  `waitlisted_at` (ties by id) becomes `in`, `waitlisted_at = NULL`, push `rsvp.promoted`.
  Promotion repeats while free slots and waitlisted rows exist (a slot increase before lock can
  free several).
- Leaving the waitlist (`out` / `maybe`) clears `waitlisted_at`; re-joining goes to the end.
- A guest (open-call player) who set `out` may return to `in` only when a slot is free; a guest is
  never waitlisted, because the open call they came through promised a slot.
- Removal from the team, account deactivation and hard delete use the same drop-out routine.

### Lineup (`PUT matches/:id/lineup`, captain or co-captain)

- Body `{ sides: [{ userId, side: 'A' | 'B' }] }` replaces the whole lineup. Confirmed players not
  listed get `side = NULL` (bench / unassigned).
- Valid only while the match is `open` or `locked`. Every `userId` must have `status = 'in'` on
  this match (else 409 `lineup_invalid_player`), appear at most once, and each side holds at most
  `ceil(slots / 2)` players (else 409 `lineup_side_full`).
- Auto-balance is a pure function in `packages/contracts` (`suggestLineup`) shared by mobile and
  server tests: it distributes `GK` first, then `DEF`, `MID`, `FWD`, alternating sides, players
  without a position last. The server never auto-assigns; it validates what the captain submits.
- Lineup history (Pro, matrix §7) is the `side` values of `played` matches; no separate table in
  Phase 2.

## Consequences

- Over-booking is impossible under concurrency (match row lock); promotion order is deterministic.
- Schema change: `match_rsvps.waitlisted_at timestamptz NULL` with a check
  `(status = 'waitlist') = (waitlisted_at IS NOT NULL)` (handoff `decisions-to-db-001`). Contracts:
  `lineup_side_full`, `suggestLineup` (handoff `decisions-to-contracts-001`).

## Rejected alternatives

- **Order the waitlist by `updated_at`.** Any unrelated update of the row would reorder the queue.
- **Server-side auto-balance on every RSVP change.** Overwrites the captain's manual choices.
