# Handoff matches → open calls 001

- From: match endpoints (`apps/web/lib/server/matches/matches.ts`, Phase 2)
- To: owner of the open-call endpoints (`apps/web/app/api/v1/matches/[id]/open-call/**`,
  `apps/web/app/api/v1/open-calls/**`)
- Status: §1 resolved: the match endpoints now call `closeOpenCallOfMatch` from
  `lib/server/calls/lifecycle.ts` (calls-to-matches-001); the local `closeOpenCalls` copy is gone

## 1. A match leaving `open` closes its call (ADR-0003, ADR-0037)

`PATCH matches/:id` (`locked`, `played`, `cancelled`) and `DELETE matches/:id` (cancel) close the
match's `open` call in the same transaction: `open_calls.status = 'closed'`, every `pending`
application `rejected`, one `notifyApplicationDecided` push per applicant (key
`push:decided:<applicationId>`). The routine is the private `closeOpenCalls` in
`lib/server/matches/matches.ts`. If the staff close (`PATCH matches/:id/open-call`) needs the same
steps, export one shared routine instead of a second copy; tell the matches owner which module
should hold it.

## 2. Lock order

Match writes lock the team row first, then the match row (`lockMatch` in
`lib/server/matches/context.ts`), then touch `open_calls`. Acceptance and publish should take the
same order (team → match → call) so concurrent RSVPs, status changes and acceptances cannot
deadlock, and the free-slot check of ADR-0003 sees the RSVP writes serialized.

## 3. Guests are never waitlisted

`setRsvp` answers 409 `match_full` to a guest (`teamRole = null`) without a free slot. An accepted
applicant therefore needs the slot reserved at acceptance (RSVP `in`), as ADR-0003 condition 5
already requires.
