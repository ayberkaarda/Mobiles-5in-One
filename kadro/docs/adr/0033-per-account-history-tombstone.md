# ADR-0033: One tombstone row per deleted account instead of a single `deleted_user` sentinel

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 item 21; ADR-0032; threat model T-DEL-03, T-DEL-07

## Context

Item 21 anonymises a deleted user's `match_rsvps` and `mvp_votes` to a `deleted_user` sentinel so
team history stays consistent. The Phase 1 schema has `match_rsvps.user_id`, `mvp_votes.voter_id`
and `mvp_votes.votee_id` as `ON DELETE RESTRICT`, with a comment expecting a re-point to "the
deleted-user sentinel". With **one** shared sentinel row, three existing constraints break:

- `match_rsvps (match_id, user_id)` is unique: two deleted players of the same match collide.
- `mvp_votes (match_id, voter_id)` is unique: two deleted voters of the same match collide.
- `mvp_votes` checks `voter_id <> votee_id`: a deleted voter who voted for another deleted player
  would become a self-vote.

Merging also corrupts history: the share count and MVP tally of a played match would change.

## Decision

- Hard delete (ADR-0032 step 5) inserts **one tombstone user per deleted account** and re-points
  that account's history rows to it. The tombstone has a new UUIDv7 id (no link to the old id),
  `display_name = 'Silinmiş oyuncu'`, `email = 'deleted+<tombstoneId>@deleted.invalid'` (reserved
  TLD, cannot receive mail), no password hash, no provider subjects, no avatar, district, position
  or level, `deactivated_at` set, and `is_tombstone = true`.
- Tombstones can never authenticate: no credentials exist, and the authentication step refuses any
  row with `is_tombstone = true` (defence in depth).
- Tombstones are excluded from every list and search; in match views they render as
  "Silinmiş oyuncu" without avatar or profile link. Stats endpoints do not expose tombstone
  profiles.
- The deleted user's played matches keep their participant count, fee shares and MVP results.

## Consequences

- All unique and check constraints hold without schema relaxation; history is exact.
- A tombstone is one small row per deleted account; it carries no personal data, so it is kept
  indefinitely.
- Schema change (handoff `decisions-to-db-001`): boolean column `users.is_tombstone`, not null,
  default `false`, plus a check that a tombstone has no password hash, provider subjects, avatar or
  district.
  The comment in `packages/db/src/schema/matches.ts` changes to "tombstone of the deleted account".

## Rejected alternatives

- **One shared sentinel.** Violates the constraints above or requires dropping them, which removes
  protections that matter for live data.
- **Nullable `user_id` on history rows.** Same uniqueness problem (several `NULL` rows are allowed,
  but then the vote and lineup queries need special cases everywhere) and loses per-person counts.
- **Scrub the original user row in place.** Keeps the original id, which links the anonymised
  history to logs, audit rows and backups that reference it.

## Amendment: team deletion and tombstone rows (2026-10-02)

Tombstone rows live on `match_rsvps` and `mvp_votes` of the team's matches, so they disappear when
the team is deleted. Since 2026-10-02 a team that has a `played` match and any member besides the
captain cannot be deleted (409 `team_has_history`, ADR-0032 amendment), so tombstone history of a
shared team stays as long as the team does. It is still removed when the team becomes solo and its
captain deletes it (ADR-0008 amendment, known limits), and with any team whose matches are only
`cancelled`; `cancelled` history is not protected.
