# Handoff matches → contracts 001

- From: match, RSVP, lineup, payment and MVP endpoints (`apps/web/app/api/v1/matches/**` except
  `open-call`, `apps/web/app/api/v1/teams/[id]/matches/**`, `apps/web/lib/server/matches/**`,
  Phase 2)
- To: owner of `packages/contracts` (endpoint registry) and `docs/api/openapi.json`
- Status: item 1 resolved (contracts added `slots_below_confirmed` / `slots_below_lineup`; the
  handler answers them with 409); item 2 open

## 1. Slot reduction below the confirmed count has no registry code

`PATCH matches/:id` with `slots` lower than the number of `in` RSVPs would over-book the match
(ADR-0035 keeps `in ≤ slots`). The registry lists only `not_found`, `forbidden`,
`match_terms_frozen` and `invalid_status_transition` for `updateMatch`, so the handler answers
400 `validation_failed` with the field error `{ path: 'body.slots', issue: 'below_confirmed' }`.

Request: decide whether this is a state conflict; if so, add a 409 code (for example
`match_state_conflict`, already used by `deleteMatch` / `setLineup`) to `updateMatch.errors` and
regenerate the OpenAPI document. The handler switches in the same change.

Acceptance: registry, OpenAPI and handler agree; `tests/matches/matches.test.ts` ("more slots
promote the waitlist…") asserts the chosen code.

## 2. `voteMvp` on a match that is not `played`

The registry has no `match_state_conflict` for `voteMvp`; a vote on an `open`, `locked` or
`cancelled` match answers 409 `mvp_vote_closed` (the window is not open). If a distinct code is
wanted, add it to `voteMvp.errors`.
