# ADR-0004: Match lock, reopen and frozen commercial fields

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §3.4 footnote 12, §4.4; threat model T-MATCH-04

## Context

The draft state machine allowed `locked → open` while `fee_total_minor`, `slots` and `format` were
immutable only "while `status ∈ {locked, played, cancelled}`". A captain could reopen a locked
match, change the fee or slot count, and lock it again, shifting what every player owes after the
lineup and shares were agreed.

Two options were weighed:

1. Forbid `locked → open`. Simple, but a late drop-out after lock could never be filled through an
   open call, which needs an `open` match. Late drop-outs are the main reason Eksik Var exists.
2. Keep `locked → open` and make the immutability independent of the current status.

## Decision

Option 2. `matches` gets a server-only column `locked_at timestamptz NULL`, set on the first
`open → locked` transition and never cleared or rewritten.

- `fee_total_minor`, `slots` and `format` are writable only while `locked_at IS NULL` and
  `status ∈ {draft, open}`. Any attempt afterwards returns 409 `match_terms_frozen`, whatever the
  current status.
- Allowed transitions: `draft → open`, `open → locked`, `locked → open`,
  `open | locked → played` (only after `starts_at`), `draft | open | locked → cancelled`.
  `played` and `cancelled` are terminal.
- `starts_at`, `venue_id` and `venue_text` stay editable in `draft`, `open` and `locked`, because
  rescheduling does not change money owed; every change notifies participants.
- Reopening a locked match does not clear lineup sides or `paid` flags.

## Consequences

- `packages/db` adds `matches.locked_at`; `packages/contracts` never exposes it as writable.
- The fee split agreed at first lock is stable for the life of the match; a captain who needs
  different terms cancels and creates a new match, which notifies everyone.
- State-transition tests cover the reopen-then-edit path and expect 409.
