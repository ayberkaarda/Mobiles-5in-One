# ADR-0008: Team role changes and atomic captaincy transfer

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §1.2, §3.3 footnotes 8–9, §7; threat model T-TEAM-02

## Context

Teams have three roles: `captain` (owner), `co_captain` and `player`. If co-captains could change
roles, two co-captains could promote each other or demote the captain. `teams.owner_id` duplicates
the captain relation and must never drift from `team_members`.

## Decision

1. Only the captain changes roles (`PATCH teams/:id/members/:userId`). Co-captains and players
   receive 403. Allowed target roles: `co_captain`, `player`, or `captain` (transfer).
2. Setting `role = captain` is a captaincy transfer, executed in one transaction that locks the
   `teams` row (`SELECT … FOR UPDATE`):
   - target becomes `captain`, the previous captain becomes `co_captain`;
   - `teams.owner_id` is set to the target's user id;
   - one `audit_logs` row `team.captaincyTransfer` is written (audit action names are dotted
     lower-camel segments).
3. The target must already be a member. If the target is on the free tier and already owns a team,
   the transfer is refused with 403 `entitlement_required` (ADR-0013).
4. The captain cannot change their own role except through a transfer and cannot leave or be
   removed (409 `captain_must_transfer`); deleting the team is the alternative.
5. A database constraint enforces exactly one captain per team (partial unique index on
   `team_members(team_id) WHERE role = 'captain'`).

## Consequences

- No intermediate state with zero or two captains is observable, even under concurrent requests.
- The account-deletion flow reuses the same transfer routine (oldest co-captain, else oldest
  member).
- `packages/db` adds the partial unique index; policy tests cover co-captain → 403 on every target
  role.

## Amendment: deleting a team with played history (2026-10-02)

Decision 4 names team deletion as the captain's alternative to leaving. That alternative is now
limited: `DELETE teams/:id` answers 409 `team_has_history` while the team has at least one
`played` match **and** any member besides the captain (matrix §3.3 footnote 34). The captain then
transfers captaincy (decision 2) and leaves; the remaining members keep the team and its history. A
team whose only member is the captain is deleted as before. The check runs inside the delete
transaction after the `teams` row lock, so a member joining or a match becoming `played` in parallel
cannot slip past it.

Known limits:

- The captain may remove every other member (footnote 9) and then delete the now solo team; the
  rule prevents deletion by a single request, not by a deliberate sequence.
- A transfer to a free-tier member who already owns a team is refused with 403
  `entitlement_required` (decision 3), so such a member cannot take over. The account-deletion
  transfer (ADR-0032 step 3) ignores the limit and sets `is_pro_locked` instead.
