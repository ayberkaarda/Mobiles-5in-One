# Handoff calls → matches 001

- From: open-call, application and venue endpoints (`apps/web/lib/server/calls/**`,
  `apps/web/lib/server/venues/**`, Phase 2)
- To: owner of the match endpoints (`apps/web/app/api/v1/matches/**` except `open-call`,
  `apps/web/lib/server/matches/**`)
- Status: §1 done on the match side (`lib/server/matches/matches.ts` calls `closeOpenCallOfMatch`
  on status change and cancel); §2 and §3 remain as notes. The helper's signature and behaviour
  stay as described below; a change would come with a new handoff.

## 4. Seen while adding a race test (for the match owner, no change made here)

`setRsvp` (`lib/server/matches/rsvp.ts`) enqueues `notifyRsvpChanged` in a separate
`runtime.db.transaction`, not in the RSVP transaction `tx`, so the job can commit while the RSVP
write rolls back (ADR-0028: job and domain write commit together).

## 1. Close the open call when a match leaves `open` (ADR-0037)

ADR-0037: "the match leaves `open` (lock, cancel, played)" moves its `open` call to `closed`, rejects
the remaining `pending` applications in the same transaction and notifies those applicants. The
helper exists:

```ts
import { closeOpenCallOfMatch } from '../calls/lifecycle';
// inside the transaction that changes matches.status away from 'open',
// after lockTeam(tx, teamId) and the match row lock (in that order):
await closeOpenCallOfMatch(tx, runtime.jobs, matchId); // → { ended, rejected } | null
```

It locks the call row (`FOR UPDATE`), sets `status = 'closed'`, rejects pending applications and
enqueues one `application.decided` push per applicant (key `push:decided:<applicationId>`, the same
key as the worker's expiry job). Calling it on a match without an open call is a no-op (`null`).

Until it is called, correctness still holds: listing, applying and accepting re-check
`matches.status = 'open' AND starts_at > now()` themselves (ADR-0003), so a locked or cancelled
match can never gain a player. What is missing without it is the stored call status and the
applicants' notification.

## 2. Lock order

Open-call writes lock: team row → match row → open-call row → application row. Please keep team
before match in every match write (the teams endpoints do the same), so the two families never
deadlock.

## 3. Guests from open calls

An accepted applicant gets `match_rsvps(status = 'in')` and is not a team member. `relations.ts`
treats them as `guest(M)` because an `accepted` application exists on a call of that match. RSVP
changes by such a guest (`out`, then `in` only when slots are free, footnote 14) belong to the
RSVP endpoint.
