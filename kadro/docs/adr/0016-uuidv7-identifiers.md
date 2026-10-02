# ADR-0016: UUIDv7 for all primary keys

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §5; authorization matrix §5; threat model §6.1

## Context

The data model specifies `id` = UUIDv7. Alternatives were serial integers (enumerable, leak row
counts, collide across environments) and UUIDv4 (random, poor B-tree locality on insert-heavy
tables such as `audit_logs`, `match_rsvps` and `rate_limit_buckets`).

## Decision

- Every table's primary key is a UUIDv7 generated in the application with the `uuid` package
  (`v7()`) in `packages/db`, not by a database default, so ids are known before insert and are
  identical in tests and production.
- Path and body ids are validated as UUIDv7 in `packages/contracts`; any other format → 400.
- Ids are not secrets. Authorization never relies on unguessability (matrix §5); every lookup is
  scoped by relationship.
- Bearer secrets (refresh and session tokens, email tokens, invite codes) are never UUIDs; they are
  256-bit or 128-bit CSPRNG values stored as SHA-256 hashes.

## Consequences

- Index locality is close to a sequence; ids sort by creation time.
- A UUIDv7 reveals its creation time to the millisecond. This is accepted: creation times of teams,
  matches and accounts are not sensitive in Kadro, and no secret is derived from an id.
