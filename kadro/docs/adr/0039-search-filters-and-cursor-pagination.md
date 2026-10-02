# ADR-0039: District filters, text search and cursor pagination

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §5 (list endpoints); `packages/contracts/src/pagination.ts`; threat model
  T-OC-04, T-PLT-18

## Context

`GET open-calls`, `GET venues`, `GET teams`, `GET teams/:id/matches` and the application lists
return lists. `packages/contracts` already defines an opaque cursor (base64url, ≤ 512 chars) and a
page size of 1..100, default 20. Filters by district and a text query for venues must work with
Turkish characters (`İ/i`, `I/ı`, `ş`, `ğ`) and must not allow expensive or unbounded queries.

## Decision

### Filters

- `district` is a district id (UUIDv7) and must exist (400 otherwise). `province` (il slug) is
  accepted by `GET venues` and `GET open-calls` as an alternative; both together → 400.
- `GET open-calls` also accepts `level` (enum), `position` (enum), and `from` / `to` (ISO date
  times, range ≤ 31 days).
- `GET venues?q=`: 2..60 characters, matched as a substring of `venues.search_name`, a column the
  application fills with the name folded by one shared function (`foldTr` in `packages/contracts`):
  Turkish lower-casing, diacritics removed, whitespace collapsed. The query is folded the same way
  and `%`, `_`, `\` are escaped before `LIKE`. A `pg_trgm` GIN index backs the substring match.

### Cursor pagination

- Keyset pagination only, never `OFFSET`. Each list has a fixed sort with a unique tie-breaker:
  open calls `(starts_at, id)`, venues `(search_name, id)`, a team's matches `(starts_at DESC, id)`,
  teams `(joined_at, team_id)`, applications `(created_at, id)`.
- The cursor encodes `{ v: 1, s: <sort key values>, f: <filter fingerprint> }` as base64url JSON.
  It is not signed: it only positions the actor inside results they may already read, and every
  query keeps its authorization scope. The server validates its shape strictly; a malformed cursor
  or a cursor reused with different filters (fingerprint mismatch) → 400 `invalid_cursor`.
- Response envelope `{ items, nextCursor }` (contracts `paginatedResponseSchema`); `nextCursor` is
  `null` on the last page. Items inserted behind the cursor during paging are skipped, which is
  accepted for these lists.

## Consequences

- Every list query is an index range scan with a bound limit; no deep `OFFSET` scans.
- Search behaves the same for "Kadıköy", "KADIKÖY" and "kadikoy".
- Schema: `venues.search_name text NOT NULL` with a `pg_trgm` GIN index; migration enables
  `pg_trgm` (handoff `decisions-to-db-001`). Contracts: `foldTr`, `invalid_cursor`, filter schemas
  (handoff `decisions-to-contracts-001`).

## Rejected alternatives

- **`OFFSET` pagination.** Cost grows with depth and pages shift under concurrent inserts.
- **`ILIKE` on the raw name.** PostgreSQL case folding does not handle Turkish dotted and dotless
  `i` correctly and ignores diacritics only with `unaccent`, which still misses `ı`.
- **Signed (HMAC) cursors.** No authorization depends on the cursor, so signing adds a key without
  adding protection.

## Amendment

The cursor format is signed with an HMAC-SHA256 keyed hash using the `page-cursor` purpose. The tag is bound to the list name, canonical filter set and cursor position. This prevents cursor tampering and reuse with another list or query; malformed or mismatched cursors return 400 `invalid_cursor`. Cursors normally carry `{ v, s, f }`; when sort values would exceed the 512-character limit, they carry only the last row id as `{ v, r, f }`. This replaces the unsigned cursor decision above.
