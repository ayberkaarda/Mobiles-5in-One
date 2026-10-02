# Handoff matches → docs 001

- From: match endpoints (`apps/web/lib/server/matches/**`, Phase 2)
- To: owner of `docs/adr` (ADR-0035 amendment)
- Status: open

## Waitlist promotion on match updates (decision taken, please record)

ADR-0035 covers promotion after an RSVP leaves `in` and after a slot increase before lock; it is
silent on combined updates and on reopening. Implemented in `updateMatch`:

1. Whenever the match is `open` after a `PATCH matches/:id` (slot increase, reopen
   `locked → open`, any other edit), free slots are filled from the waitlist, oldest
   `waitlisted_at` first, with `rsvp.promoted` pushes, in the same transaction.
2. A request that adds slots and locks at once (`{ slots: 6, status: 'locked' }`, allowed because
   the terms are still writable) promotes first and then locks, so the first lock (ADR-0004)
   freezes a full roster.
3. A `locked` match without new slots gains no confirmed player through `PATCH` (a lock means the
   roster is agreed); drop-outs in `locked` still promote through the RSVP endpoint as ADR-0035
   already says.

Reason: without (1) and (2) waiting players kept their place in the queue while later
newcomers could take the freed slots, which contradicts the oldest-first rule.

Also recorded: slot reductions answer 409 `slots_below_confirmed` (below the `in` count) and
409 `slots_below_lineup` (one stored side above `ceil(slots / 2)`).
