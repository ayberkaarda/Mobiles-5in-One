# ADR-0007: Platform staff have no override on the regular API

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §1.1, §3.8; threat model T-ADM-01..04

## Context

Users with `role = 'moderator'` or `'admin'` need moderation powers (verify venues, remove reviews
and open calls, manage roles). Giving them implicit access on the regular team, match and profile
endpoints would add a "god mode" branch to every policy, make the matrix harder to test, and let a
stolen staff password act without TOTP and without an audit row.

## Decision

- On every endpoint outside `/api/v1/admin/**` (and web `/admin/**`), moderators and admins are
  evaluated exactly like a `user` with their actual team relationships. They get no extra read
  projection and no write override.
- Staff powers exist only under `/admin/**`. Each admin route requires `role ∈ {moderator, admin}`
  and a valid TOTP step-up (15 minutes, bound to the session or refresh-token family). The only
  routes exempt from the step-up requirement are the two that establish it:
  `POST admin/step-up` and `POST admin/totp/enroll` (which requires re-authentication instead).
- Every admin mutation writes one `audit_logs` row in the same transaction.
- Role changes and user deactivation additionally require a fresh TOTP code in the request.

## Consequences

- `can()` has no staff branch for regular actions; the `modPlyA` fixture proves a moderator who is
  a player gets player results.
- Moderation work needs dedicated admin endpoints; they are proposed to the contracts owner in the
  matrix §3.8.
- A compromised staff password without the TOTP secret cannot perform any staff action.
