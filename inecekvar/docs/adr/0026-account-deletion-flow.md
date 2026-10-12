# ADR-0026: Account deletion, grace period and hard delete

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, package 2D (immediate part from phase 1, ADR-0007)

## Context

Section 6.21: re-authentication, then immediate deactivation (tokens revoked, favorites
deleted, private traces deleted now, pending edits withdrawn), a 7-day grace period in which a
login cancels, then a worker removes personal rows and photos; approved contributions stay
under the licence with `author_id = NULL` and the attribution "silinmiş katkıcı"; the RevenueCat
subscriber is deleted; a confirmation mail; an audit row without personal data.

## Decision

- Immediate part (`DELETE me`, phase 1, unchanged): re-authentication, `deactivated_at`, a
  `deletion_requests` row 7 days ahead, tokens and sessions revoked, favorites and traces deleted,
  pending edits withdrawn. Domain writes (traces, edits, favorites, photo presign) lock the user
  row and recheck deactivation, so a request authenticated just before the deletion cannot add
  rows after it.
- Grace: `cancel_scheduled_deletion` (`app/me/deletion.py`) runs inside password login (after a
  correct password only) and magic-link login; with a scheduled request still in its grace period
  it cancels the request, clears `deactivated_at` and audits `account.delete_cancelled`. Other
  deactivated accounts are refused exactly as before.
- Hard delete (`app/workers/deletion.py`, hourly): per due request, with the user row locked:
  subscribers are removed through `Services.subscriber_deleter` first (no deleter or a failure
  defers the user); photo rows are locked and their objects (`photos/`, `incoming/`,
  `quarantine/`) deleted (no store defers); a Turkish confirmation mail goes to the stored
  address (a failure is logged without the address); sessions, refresh tokens, magic links (by
  user id and by email), favorites, traces, non-approved edits and photo rows are deleted, then
  the user row. Approved edits keep `author_id = NULL` and published versions keep
  `published_by = NULL` through the foreign keys; moderation views show "silinmiş katkıcı".
  Audit rows that targeted the user lose their target id and one `account.deleted` row without
  any identifier is added.
- Production has no subscriber deleter until phase 5: users with a subscription row are deferred,
  never erased while their provider record would remain.

## Consequences

- Rate-limit keys are keyed digests that expire within a day; database backups age out on their
  own schedule (phase 6 documents it).
- Favorites and traces deleted at request time are not restored by a cancellation.

## Evidence

Command: `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/deletion tests/auth tests/review` (12, 56 and 3 tests, all passed).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Immediate deletion | `tests/deletion/test_deletion.py::test_private_trace_deleted_immediately`, `tests/auth/test_accounts.py::test_delete_me_deactivates_and_revokes` | passed |
| 2 | Grace period | `test_login_during_grace_cancels_deletion` (password and magic link), `test_login_after_grace_is_refused`, `test_wrong_password_does_not_cancel_deletion`, `test_hard_delete_skips_cancelled_request` | passed |
| 3 | No residue | `test_hard_delete_leaves_no_pii_residue`: every text-castable column of every public table scanned for the user id, email and display name after the run, no match; approved edit kept with author NULL, version kept with publisher NULL, photo objects gone from MinIO, mail recorded, subscriber double called with the app user id | passed |
| 4 | Deferral | `test_hard_delete_defers_when_subscriber_deletion_fails`, `test_photo_storage_deferral_and_mail_failure_retry` | passed |
| 5 | Writes after deactivation | `tests/review/test_review_fixes.py::test_deactivated_account_cannot_write` | passed |
| 6 | Mutation M7a | `DELETE me` no longer deletes traces | 2 failed (`test_private_trace_deleted_immediately`, `test_delete_me_deactivates_and_revokes`); restored |
| 7 | Mutation M7b | hard delete no longer deletes traces | 0 failed: equivalent mutant, the `ON DELETE CASCADE` of `traces.author_id` removes them with the user row and the immediate step already did; recorded, restored |

Not exercised:

- `not exercised: RevenueCat REST deletion` (phase 5; recording double in tests).
- `not exercised: web /hesap-silme page and in-app flow` (phases 3 and 4).
- `not exercised: backup expiry of deleted data` (phase 6).
