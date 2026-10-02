# ADR-0009: First-admin bootstrap and last-admin protection

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: authorization matrix §3.2 footnote 5, §3.8 footnote 27; threat model T-ADM-03, T-ADM-08

## Context

Admins manage roles through the API, but the first admin cannot be created that way without an
unauthenticated escalation path. Conversely, the platform must never end up with zero admins
through demotion, deactivation or account deletion, because nobody could then manage roles.

## Decision

- **Bootstrap:** the first admin is created by an operator script in `packages/db` run with
  database credentials against the target environment. It sets `role = 'admin'` on an existing,
  email-verified account and writes an `audit_logs` row with `actor_id = NULL` and
  `metadata = { source: 'operator_script' }`. No API route, environment flag or seed data grants
  the admin role. The new admin must enroll TOTP before any step-up-protected action.
- **Last admin:** demotion (`PATCH admin/users/:id/role`), deactivation
  (`PATCH admin/users/:id/deactivate`) and account deletion (`DELETE me`) of an admin are refused
  with 409 `last_admin` when no other active admin (`role = 'admin' AND deactivated_at IS NULL`)
  would remain. The count runs in the same transaction after locking all admin rows
  (`SELECT … FOR UPDATE`), so two concurrent demotions cannot both pass.
- **Self-change:** an admin cannot change their own role or deactivate themselves through the API
  (403), independently of the last-admin rule.

## Consequences

- Granting the very first admin requires infrastructure access, which is already the highest trust
  level (adversary AD-7) and leaves an audit row.
- Recovery when the only admin loses their TOTP device is the same operator path (documented in
  `docs/ops/`), never an API bypass.
