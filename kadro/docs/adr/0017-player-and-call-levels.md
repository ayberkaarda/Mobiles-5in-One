# ADR-0017: Player and open-call levels follow the specification

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 6, §5; authorization matrix §4.1, §4.4

## Context

The specification defines the open-call level as `casual | regular | competitive`, and
`users.level` describes the same thing from the player's side. An earlier schema draft used a
different value set, so filtering open calls by a player's own level would not match.

## Decision

- One enum `player_level` with the values `casual`, `regular`, `competitive` is used for both
  `users.level` and `open_calls.level`.
- `packages/contracts` exports the single source list; `packages/db` derives the PostgreSQL enum
  from the same values. Any other value → 400 `validation_failed`.
- Turkish display labels live in mobile and web i18n files, never in the stored value.

## Consequences

- `GET open-calls?level=` and profile levels share one vocabulary and one validation rule.
- Adding a level later is a contracts change plus an enum migration recorded in a new ADR.
