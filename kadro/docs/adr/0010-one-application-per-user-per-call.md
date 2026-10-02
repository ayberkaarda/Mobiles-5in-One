# ADR-0010: One application per user per open call

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §3.5 footnote 20; threat model T-OC-03

## Context

Without a uniqueness rule a free player can flood a captain with repeated applications to the same
call, and two concurrent requests can bypass an application-level "already applied" check.

## Decision

- `open_call_applications` has a unique constraint on `(open_call_id, user_id)`.
- A second application by the same user to the same call returns 409 `already_applied`, regardless
  of the first application's status (`pending`, `accepted`, `rejected` or `withdrawn`). A withdrawn
  or rejected applicant cannot re-apply to the same call; they can apply to any other call.
- The handler relies on the constraint (insert, map unique violation to 409) rather than a
  read-then-write check.

## Consequences

- Application flooding per call is bounded at one row; rate limit O bounds flooding across calls.
- `packages/db` adds the constraint in the Phase 1 schema.
