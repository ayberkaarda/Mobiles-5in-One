# ADR-0006: Payment marking rules and mandatory audit

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §3.4 footnote 16; threat model T-MATCH-02, T-MATCH-03

## Context

`PATCH matches/:id/payments/:userId` lets captain and co-captain mark a player's share as paid. No
money moves inside the app, so the flag is the only record players use to settle disputes. The
draft let a co-captain mark their own share and left the audit record as a proposal.

## Decision

1. Only the captain may mark their own share. The captain is the person accountable for the pitch
   fee and the counterparty of every share, so there is nobody else to confirm it. A co-captain's
   own share is marked by the captain or another co-captain; a co-captain targeting themselves
   receives 403 `forbidden`. Players and guests never mark payments (403).
2. Every successful `payment.mark` call, setting or clearing `paid`, writes exactly one
   `audit_logs` row in the same transaction as the update: `action = 'payment.mark'`,
   `target_type = 'match_rsvp'`, `target_id` = the RSVP id, `metadata` =
   `{ matchId, targetUserId, paid, selfMark }`. No names or emails in `metadata`.
3. If the audit insert fails, the payment update rolls back.

## Consequences

- Payment disputes can be reconstructed from the audit trail (who, when, which direction).
- `audit_logs` is no longer staff-only in practice: regular team actions write to it. The
  append-only grant model from the threat model (no UPDATE/DELETE for the app role) applies
  unchanged.
- Policy tests add `coA → own payment → 403` and `capA → own payment → 200`; integration tests
  assert one audit row per call.
