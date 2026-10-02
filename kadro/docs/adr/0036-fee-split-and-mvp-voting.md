# ADR-0036: Fee split computation and MVP voting window

- Status: Accepted; complements [ADR-0006](0006-payment-marking-and-audit.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 stories 5, 9; ADR-0004, ADR-0006; authorization matrix §3.4
  footnotes 12, 16, 17; threat model T-MATCH-02..05

## Context

Story 5 computes each player's share from confirmed players; ADR-0006 fixes who marks payments.
Story 9 adds a 24-hour MVP vote after the match and simple profile stats. The share rounding, the
moment the window opens, and when results become visible were not decided.

## Decision

### Fee split

- `share = floor(fee_total_minor / n)` with `n` = RSVPs `in`; the remainder `fee_total_minor mod n`
  is added as 1 kuruş to the first players ordered by RSVP creation time (ties by id). The sum of
  shares always equals the fee. `n = 0` → no shares.
- Computed on read, never stored; it follows the current confirmed count, while `fee_total_minor`
  itself is frozen after the first lock (ADR-0004).
- `paid` is writable only on RSVPs with `status = 'in'` in `locked` and `played` matches
  (ADR-0006 rules unchanged). A player who leaves keeps no share; their `paid` flag is cleared with
  the RSVP status change and the clearing is audited like a mark (`payment.mark`, `paid = false`,
  `metadata.reason = 'rsvp_left'`).

### MVP voting

- The window opens when staff set the match `played` (allowed only after `starts_at`) and closes at
  `mvp_vote_closes_at`, which the server sets to the transition time + 24 h.
- Voter and votee must both be RSVP `in` on the match; no self-vote; one vote per voter, final
  (second vote → 409 `already_voted`). After the window → 409 `mvp_vote_closed`.
- Results are hidden while the window is open (the response confirms only the actor's own vote).
  After closing, the MVP is the votee with the most votes; ties produce several MVPs. Matches with
  no votes have no MVP.
- Profile stats: matches played = RSVPs `in` on `played` matches; MVP count = matches where the
  user is among the MVPs. Tombstones (ADR-0033) are counted in match totals but have no profile.

## Consequences

- Shares are exact to the kuruş and reproducible from the RSVP list.
- Hidden tallies avoid bandwagon voting; stats are derived, so no counter can drift.
- Error codes `already_voted` and `mvp_vote_closed` already exist in `packages/contracts`.
- The profile statistics response (matches played, MVP count) ships with the Phase 3 profile
  screens; Phase 2 leaves `GET me` unchanged and only guarantees that the data needed to derive
  the statistics is stored.

## Rejected alternatives

- **Round shares up.** Players would together pay more than the fee.
- **Store shares at lock.** Drop-outs after lock would leave stale amounts that someone must edit.
- **Live vote counts.** Encourages pile-on voting and makes the last voter decisive by design.
