# ADR-0003: Open-call application acceptance preconditions

- Status: Accepted; amended by [ADR-0037](0037-open-call-lifecycle.md) (expiry job and notification)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §3.5 footnotes 20–21; threat model T-OC-05, T-OC-07

## Context

Accepting an application (`PATCH open-calls/:id/applications/:appId` with `accepted`) creates an
RSVP `in` for a free player. The Phase 0 draft only checked that the application was `pending` and
that a slot remained. A captain could therefore accept an application to an expired or closed call
and add a player to a `cancelled`, `played` or past match, corrupting history, stats and the fee
split.

## Decision

Acceptance succeeds only when all of the following hold, evaluated inside one transaction that
holds `SELECT … FOR UPDATE` on the match row and the open-call row:

1. The application is `pending`.
2. The call has `status = 'open'` and `expires_at > now()`.
3. The match has `status = 'open'` and `starts_at > now()`.
4. The applicant is not a member of the match's team and has no RSVP on the match.
5. Confirmed players are fewer than `slots`.

Failures return 409 with a specific code: `application_not_pending`, `call_closed` (covers
expired), `match_not_open` (covers locked, cancelled, played, past), `already_participant`,
`match_full`.

`rejected` decisions only require conditions 1 and 2, so a captain can still clear the queue
before the call expires.

When a call closes through a write (missing count reaches 0, the match leaves `open`, moderator
removal), the same transaction sets every remaining `pending` application of that call to
`rejected`. Time-based expiry needs no job: conditions 2 and 3 are evaluated at decision time.

Application creation (`POST open-calls/:id/applications`) applies conditions 2–4 as well.

## Consequences

- An expired call can never add a player to a match; the integration suite covers each 409 code.
- Applicants receive one rejection notification when a call closes, not a silent dangling state.
- The state checks live in the open-call domain service, not in `can()`, consistent with the
  matrix rule that `can()` encodes only role and relationship cells.
