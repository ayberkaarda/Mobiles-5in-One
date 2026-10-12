# ADR-0029: Phase 2 gate, mutation checks and white-box review

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, gate

## Context

Section 10 phase 2 gate: planner and moderation tests green; export produced for the sample city.
ADR-0005 requires executed evidence for every claim and an explicit list of what was not
exercised. Packages ran in the order 2A, 2B, 2C, 2D, 2E; each was gated, mutation-checked and
committed before the next started.

## Decision

Phase 2 is closed locally on branch `feat/inecekvar-p2` with the evidence below. The open
items are carried into phases 3 to 6 by the ADRs named in the last section.

## Evidence

Final gate in `inecekvar/api` (log `p2-final-gate.log` in the owner's job folder):

| # | Command | Result |
| - | ------- | ------ |
| 1 | `uv sync --locked` | 88 packages, lock unchanged |
| 2 | `uv run ruff check .` | all checks passed |
| 3 | `uv run ruff format --check .` | 177 files formatted |
| 4 | `uv run mypy --strict app tests alembic` | no issues in 177 source files |
| 5 | `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest` | 506 passed (phase 1: 330), Testcontainers PostGIS, Redis and MinIO |
| 6 | Phase gate: planner and moderation | `tests/planner` 27 passed, `tests/domain` 47 passed |
| 7 | Phase gate: sample city export | `exports/ornek-test-sehri/1.geojson`, 3 lines and 20 stops (ADR-0025 row 4) |
| 8 | Workspace | `pnpm nx run-many -t lint test build` success; `pnpm exec prettier --check .` clean (ADR-0027) |

Mutation checks (file copies restored and compared byte for byte; log `p2-mutation.log`):

| # | Mutation | Failing named tests |
| - | -------- | ------------------- |
| M1 | self-approval check bypassed | `test_self_approval_is_forbidden` |
| M2 | rollback rewrites the old version | `test_rollback_copies_old_version` |
| M3 | 200 m trim removed | `test_trim_removes_first_and_last_200m`, `test_too_short_trace_rejected`, `test_trace_body_not_logged`, `test_public_responses_have_no_trace_data` |
| M4 | public line detail leaks `source_edit_id` | `test_public_responses_have_no_trace_data` |
| M5 | entitlement check dropped beyond the first download | `test_second_city_needs_entitlement`, `test_account_history_decides_for_signed_in_downloads` |
| M6 | planner allows one extra transfer | `test_property_never_exceeds_max_transfers`, `test_one_transfer_at_shared_stop`, `test_transfer_through_walking_edge`, `test_plan_respects_max_transfers_zero` |
| M7a | `DELETE me` keeps the private trace | `test_private_trace_deleted_immediately`, `test_delete_me_deactivates_and_revokes` |
| M7b | hard delete keeps a private trace | none: equivalent mutant (cascade and the immediate step remove it) |
| M8 | edit quota charged after validation | `test_edit_quota_charged_before_validation` |
| M9 | endpoint-area exclusion removed | `test_trim_excludes_every_return_to_the_endpoints[revisits-start]`, `[passes-end-early]` |
| M10 | walking spanning forest removed | `test_walking_cap_keeps_walkable_clusters_connected` |
| M11 | database errors logged with their text | `test_database_error_logs_no_row_values` |

White-box review of the phase 2 diff (read only) and one verification round:

| Finding | Severity | Status |
| ------- | -------- | ------ |
| A trace that returns to its start or passes its end kept those points | high | fixed (ADR-0022) |
| Two reviewers approving each other | medium | fixed for direct pairs within 30 days; concurrent first approvals and linked identities remain (phase 4 admin tooling) |
| Planner graph build outside the deadline, dense clusters | medium | capped (12 nearest plus a spanning forest, 20 000 stops, per-city build lock); candidate collection stays quadratic for pathological data, which only moderated edits can create |
| Edit work before the quota | medium | fixed |
| Signing in or out to get another free city | medium | quota shared through the network identity; one anonymous plus one account free city accepted (ADR-0024) |
| Cross-site navigation selecting the free city | medium | fixed (required `X-Pack-Request` header) |
| Photo processing recreating objects after erasure | medium | fixed (photo rows locked) |
| Writes by a request authenticated before deletion | medium | fixed (user row lock and recheck) |
| Database error text with row values in logs | medium | fixed (parameters hidden, class and SQLSTATE only) |
| User and line lock inversion (verification round) | medium | fixed (no line lock on favorites) |
| Walking cap disconnecting clusters (verification round) | medium | fixed |
| Shared network overriding an account's city (verification round) | medium | fixed (account history decides) |
| Optional header in the contract (verification round) | low | fixed (required header) |
| 403 versus 404 existence signal for edits and traces | low | accepted: identifiers are UUIDv7, contents never leak |
| Trim sampling may shorten a safe stretch by up to about 20 m; final clearance check at 194 m | low | accepted and documented (ADR-0022) |

Not exercised (carried forward):

- `not exercised: TOTP step-up` (phase 4; rollback and retirement deny in production).
- `not exercised: RevenueCat entitlement and subscriber deletion` (phase 5; test doubles).
- `not exercised: R2, PMTiles CDN, production hosting` (no account, no host).
- `not exercised: CI on GitHub` (branch not pushed).
- `not exercised: semgrep, bandit, ZAP, attack suite, cost guard` (phase 6).
