# ADR-0020: Refresh family lifetime and auth retention

- Status: Accepted
- Date: 2026-10-06
- Deciders: Ayberk (owner)
- Supersedes the "no absolute family lifetime" and "retention is planned" consequences of
  [ADR-0005](0005-session-model.md); the rest of ADR-0005 stands.

## Context

ADR-0005 gave refresh tokens a sliding 60 days and no absolute limit, so a client that refreshes at
least every 60 days can stay signed in forever. A stolen refresh token that is used quietly before
its owner notices has the same property. The threat model recorded this as an open risk (4.10) and
proposed a cap of 180 days. The same ADR noted that expired OTP codes, refresh tokens and invitations
pile up until a retention job exists.

## Decision

### Absolute family lifetime

- A refresh family has a fixed end of 180 days from the sign-in that created it
  (`refresh_tokens.family_expires_at`, `RefreshTokenService.FAMILY_TTL`). The sliding window stays at
  60 days inside it: a token issued by rotation gets `expires_at = min(now + 60 days, family_expires_at)`,
  and the family end is copied unchanged to every token of the family.
- A token presented at or after the family end answers `401 auth.refresh_invalid` and changes
  nothing: the family is not revoked and no row is written, because the family is already past use
  (`RotationResult.Rejected`). The check runs before reuse detection, so an old, already rotated
  token presented after the family end is also a plain 401; every token of that family is dead
  either way. The user signs in again with a phone code.
- Migration `V5__services.sql` adds the column, backfills existing rows with `created_at + 180 days`
  and makes it `NOT NULL`.
- Evidence:
  - `RefreshFamilyLifetimeTest`: `rotations share the fixed family end and shorten the final token`
  - `RefreshFamilyLifetimeTest`: `HTTP refresh after family end is 401 and leaves the family unchanged`
  - `V5ServicesSchemaTest`: `V5 backfills old refresh rows from their creation time`
  - `RefreshRotationTest` and `RefreshRaceTest` are unchanged and still part of the gate.

### Retention

`RetentionSweeper` ([ADR-0018](0018-account-and-shop-deletion.md)) removes, daily at 03:00 in
`Europe/Istanbul`: `otp_codes` older than 1 day; `refresh_tokens` revoked or expired more than 30
days ago; `invitations` expired more than 7 days ago. Before deleting refresh tokens it clears
`rotated_from` on rows that point at them, so the self-reference does not block the delete. The
other tables it covers (statement links, failed media rows) are described in their own ADRs.
Boundary and active rows are kept (`RetentionSweeperTest`).

### Lock and job conventions

All scheduled jobs (`MediaSweeper`, `DeletionExecutor`, `RetentionSweeper`) are enabled by
`cetele.jobs.enabled` (default true, false in the `test` profile) and take
`JobLocks.runExclusive(name)`, a `pg_try_advisory_xact_lock` that skips the run when another
instance holds it. Tests call the job methods directly
(`V5ServicesSchemaTest`: `job locks skip competing transactions and shop locks require a transaction`).

## Consequences

- Every device signs in again at least every 180 days. For a shop phone that is a rare, cheap event;
  it also bounds the usefulness of a silently stolen refresh token.
- The access token lifetime (15 minutes) is unchanged.
- Rows of revoked and expired tokens no longer live forever, which also removes old device and user
  linkage from backups sooner.
- Threat model 4.10 rows for the refresh cap and for retention move to closed.
