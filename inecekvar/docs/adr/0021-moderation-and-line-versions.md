# ADR-0021: Edits, moderation and immutable line versions

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, package 2A

## Context

Section 3 stories 1, 2, 5 and 6 ask for public line and stop reads, diff-based proposals,
a moderation queue with a map diff, approval into an immutable `line_version`, rejection with a
reason, rollback to any version, no self-approval, reputation per accepted proposal and a quota
by reputation. Section 6.6 sets the input bounds; section 6.18 requires an audit row with a diff
hash for every moderation action and a TOTP step-up for rollback and retirement.

## Decision

- Public reads (`app/cities`, `app/lines`, `app/stops`): line and stop slugs are unique per city,
  so `GET lines/{slug}` and `GET stops/{slug}` take a required `city` query parameter. Only
  published lines are listed; a retired line keeps its detail page; drafts are 404. Response
  models are `extra="forbid"` and carry no author, publisher, source edit or trace field.
  `stops/near` uses `ST_DWithin` on the geography column with bound parameters (radius 1 to
  2000 m, at most 50 results) and never logs its coordinates.
- Proposals (`POST edits`, kinds `new_line|update_line|new_stop|update_stop|fare_update|retire`)
  are a discriminated union with the section 6.6 bounds (bbox containment, 150 km, simple
  geometry except a closed loop, 2 to 5000 points, fare 0 to 10 000 000 minor units, bounded
  strings without control characters, existing active stops of the same city). The server
  stores the normalized payload and computes the diff against the current version; an empty
  diff is 422. The quota (`edits.low_reputation` 10 per day below reputation 20, else
  `edits.default` 100 per day) is charged per user before any attachment or geometry work.
- Approval locks the edit, checks `approve_edit` and `publish_version` (and `retire_line` with
  step-up for a retirement) through the policy with stored author and state, refuses a
  reciprocal approval (the author approved one of the reviewer's own edits in the last 30 days,
  409 `moderation.reciprocal_conflict`), checks `base_version_no` (409 on conflict), then in one
  transaction: publishes version `max + 1` with ordered `line_stops`, moves
  `current_version_id`, recounts distinct contributors, sets `last_verified_at`, adds 5
  reputation to the author, bumps `cities.pack_version`, sets linked traces to expire 30 days
  later (ADR-0022) and writes `AuditLog(diff_hash = SHA-256 of the canonical JSON diff)`.
- Rollback requires the `rollback` step-up cell and publishes a new version that copies the
  requested one; old rows are never touched. `line_versions` and `line_stops` are immutable at
  the database layer (phase 1 triggers), so a mutating code path fails loudly.
- Step-up comes from `Services.step_up` (`StepUpSource`); production has none until the TOTP
  work of phase 4, so rollback and retirement are denied there (fail closed).
- Moderation views show the author's display name, or `silinmiş katkıcı` when the author was
  erased (ADR-0026). Favorites are always scoped by the authenticated user.

## Consequences

- Rollback and retirement are unusable in production until phase 4 provides step-up.
- Reciprocal detection covers direct pairs only; linked identities (same device or network)
  need the phase 4 admin tooling.

## Evidence

Command: `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/domain tests/security tests/review` (47, 146 and 3 tests, all passed).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Public reads | `tests/domain/test_public.py::test_public_city_line_stop_reads`, `test_line_search_escapes_wildcards`, `test_draft_line_is_404`, `test_retired_line_is_only_available_in_detail`, `test_stops_near_orders_by_distance_and_bounds_radius`, `test_public_line_has_no_private_fields` | passed |
| 2 | Validation (one negative test per rule) | `tests/domain/test_validation.py` (14 tests: bbox, 150 km, self-intersection, point count, fare, unknown field, unknown stop, other city's stop, control characters, empty diff, distinct points, duplicates, normalization, closed loop accepted) | passed |
| 3 | Immutable versions | `test_approve_creates_immutable_version`, `test_update_line_copies_unchanged_fields`, `test_rollback_copies_old_version` | passed |
| 4 | Separation of duties | `test_self_approval_is_forbidden`, `test_moderator_cannot_reject_own_edit`, `test_contributor_cannot_approve`, `test_reciprocal_approval_needs_independent_reviewer`, IDOR rows `moderator-self-approve`, `admin-self-approve`, `moderator-self-reject` | passed |
| 5 | Step-up | `test_rollback_without_step_up_is_403`, `test_retire_requires_step_up` | passed |
| 6 | Workflow | `test_reject_with_reason`, `test_version_conflict_409`, `test_new_line_approval_and_slug_suffix`, `test_new_and_update_stop`, `test_contributor_count_uses_distinct_authors`, `test_moderation_queue_shows_deleted_contributor_label` | passed |
| 7 | Quotas | `test_edits_rate_limit_low_reputation`, `test_edits_rate_limit_high_reputation`, `tests/review/test_review_fixes.py::test_edit_quota_charged_before_validation` | passed |
| 8 | Favorites | `test_favorites_are_scoped_to_owner`, `test_favorites_idempotency`, `test_favorites_only_accept_published_lines`, `test_anonymous_favorites_are_401` | passed |
| 9 | Mutation M1 | self-approval check bypassed (context author replaced) | `test_self_approval_is_forbidden` failed; restored |
| 10 | Mutation M2 | rollback also rewrites the old version | `test_rollback_copies_old_version` failed (database trigger); restored |
| 11 | Mutation M8 | edit quota moved after validation | `test_edit_quota_charged_before_validation` failed; restored |

Not exercised:

- `not exercised: TOTP step-up in production` (phase 4); tests use a fake `StepUpSource`.
- `not exercised: moderation map diff rendering` (web admin UI, phase 4).
