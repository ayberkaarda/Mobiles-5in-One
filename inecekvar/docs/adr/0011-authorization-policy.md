# ADR-0011: Declarative authorization policy and the IDOR harness

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 1, package 1D

## Context

Section 6 item 3 asks for `api/app/security/policy.py` with a declarative
`PERMISSIONS[role][action]` over the actions `propose_edit`, `edit_own_pending`,
`upload_trace`, `view_trace`, `approve_edit`, `reject_edit`, `publish_version`, `rollback`,
`retire_line`, `manage_users`, `export_admin`, plus ownership predicates, documented in
`docs/security/authorization-matrix.md` and tested cell by cell. Item 4 keeps all authorization
in the API, forbids self-approval and asks for an IDOR suite; item 18 asks for a TOTP step-up
on destructive moderation and admin routes and forbids moderators from managing users.

## Decision

- The table is total and written out cell by cell (5 roles including `anonymous` x 11 actions,
  no defaults). Cells are `Allow`, `Deny` or `AllowIf(conditions)`; every condition of an
  `AllowIf` must hold. Unknown roles or actions are denied.
- Conditions: `licence_accepted`, `trace_owner`, `edit_author`, `edit_pending`,
  `not_own_proposal` (both ids present and different), `totp_step_up` (verified step-up between
  0 and 15 minutes old; future timestamps denied). Predicates read a `ResourceContext` built
  from stored rows and the server clock; `authorize()` overwrites the actor id with the
  authenticated principal, so a caller cannot pass someone else's identity.
- Notable cells: users keep `view_trace` and `edit_own_pending` on their own items after a role
  change; contributors cannot approve, reject, publish, roll back, retire or administer;
  moderators and admins approve, reject and publish only pending edits that are not their own;
  rollback and retirement need a step-up for both; `manage_users` and `export_admin` are
  admin-only with a step-up. The current table is reproduced in
  `docs/security/authorization-matrix.md`, and a test parses that document and compares every
  cell with the code.
- Reading an edit (`GET edits/{id}`) has no section 6.3 action; the route-level rule
  `can_read_edit` allows moderator or admin, or the stored author.
- An anonymous caller on a denied cell gets `401 auth.required`; an authenticated caller gets
  `403 auth.forbidden`.
- `require_permission(action)` covers resource-free checks (it loads licence acceptance from
  the user row); resource checks call `authorize()` in the service after loading the row. Phase
  1 stores no step-up timestamp, so step-up cells deny until phase 4 supplies one.
- The IDOR harness (`tests/security/test_idor.py`) is a registry of `IdorCase` rows run by one
  parametrized test with real accounts, real bearer sign-in and database rows. Phase 1 has no
  trace or edit endpoints, so the module mounts test-only probe routes that call the real
  policy; phase 2 replaces the probe paths with the real endpoints by editing the registry.

## Consequences

- A new action or role is a code change in one table and fails the matrix tests until the
  document and the expected-cell literal are updated as well.
- The probe routes prove the policy and the harness, not the phase 2 handlers; the IDOR rows of
  item 4 therefore remain partial until the real routes are registered in the harness.

## Evidence

Logs in the owner's job folder (`p1d-gate.log`, `p1d-mutation.log`, `p1-final-gate.log`,
`p1-final-mutation.log`).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Every cell | `tests/security/test_policy_matrix.py::test_every_cell_matches_expected` (55 cases), `test_table_is_total` | passed |
| 2 | Conditions | `test_decide_allow_if_cells` (24), `test_deny_cells_deny_even_with_full_context` (29), `test_step_up_window` (4), `test_missing_context_denies_predicate` (6), `test_can_read_edit` (4), `test_unknown_action_and_role_denied`, `test_authorize_ignores_supplied_actor_id`, `test_authorize_anonymous_is_401_and_forbidden_is_403` | passed |
| 3 | Document equals code | `test_matrix_document_matches_table` | passed |
| 4 | IDOR cases | `tests/security/test_idor.py::test_idor_case` (13): user and contributor reading another's trace 403, owner 200, moderator 200, anonymous 401, unknown id 404, contributor reading another's edit 403, author 200, contributor approving 403, moderator self-approval 403, moderator approving another's pending edit 204, approving an approved edit 403, admin self-approval 403 | passed |
| 5 | Mutation | M1: contributor `approve_edit` flipped to `Allow` | 4 failed (`test_idor_case[contributor-approve]`, `test_every_cell_matches_expected[contributor-approve_edit]`, `test_authorize_anonymous_is_401_and_forbidden_is_403`, `test_matrix_document_matches_table`); restored, hash identical |
| 6 | Package size | `INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/security` | 140 passed |

Not exercised:

- `not exercised: real trace and edit endpoints in the IDOR harness` (phase 2).
- `not exercised: TOTP step-up` (no stored step-up before phase 4; the cells deny).
