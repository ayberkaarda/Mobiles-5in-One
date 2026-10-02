# ADR-0013: Status codes for nested resources and missing entitlements

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §2, §3.4, §3.5, §5, §7

## Context

The Phase 0 matrix had three inconsistencies:

1. `application.decide` returned 403 to team players and guests, who cannot read applications
   (should be 404), and 404 to the applicant, who can read their own application (should be 403).
2. Payment and lineup targets were described by a single staff-scoped query, which would turn a
   player's request into 404 while the endpoint table expected 403. The load and deny order was
   not written down.
3. A missing Pro entitlement was 403 in the response table but 409 for captaincy transfer.

## Decision

- **Base rule:** 404 when the actor has no read relationship to the resource addressed by the URL;
  403 when the actor can read it but may not perform the action.
- **Nested resources** load in this order:
  1. Load the parent through its read-scoped query (match: member or RSVP holder; application:
     applicant or call staff). Not found → 404.
  2. `can()` on the parent relationship. Readable but not allowed → 403.
  3. Load the nested target inside the authorized parent (`match_rsvps` by `match_id` and
     `:userId`; application by `open_call_id` and `:appId`). Not found → 404.
  4. State preconditions on the target → 409.
- Resulting cells: `payment.mark` and `lineup.set` → player 403, guest 403, unrelated user 404.
  `application.decide` → unrelated user, player and guest 404, applicant 403, staff allowed.
  `application.withdraw` → applicant allowed, call staff 403, everyone else 404.
- **Entitlements:** every missing-entitlement case returns 403 `entitlement_required`, including
  captaincy transfer to a free user who already owns a team and writes on a `is_pro_locked` team.
  409 is reserved for state conflicts.

## Consequences

- The table-driven tests in `packages/auth` and the IDOR suite use these cells directly.
- Mobile maps a single `entitlement_required` code to the paywall prompt.
