# ADR-0022: Trace privacy, derived geometry and retention

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, package 2B

## Context

Section 0 item 6: raw GPS traces are private to their owner and moderators, deleted 30 days
after the derived line version is published, never exposed through public endpoints; logs round
coordinates to 3 decimals. The plan adds a privacy measure beyond the specification: the start
and end of a ride usually are a home or a workplace, so trace-derived geometry must not reveal
them. Section 6.6 bounds traces (5000 points, city bbox, 150 km, valid geometry, 2 MiB body).

## Decision

- `POST traces` needs `upload_trace` (licence accepted), the `traces` quota (20 per day per
  user) and validates every bound; the response never echoes points. `GET traces/{id}` is owner
  or moderation role (`view_trace`); `DELETE traces/{id}` is the stored owner only. Trace bodies
  and points are never logged; SQL parameters are hidden from database error messages
  (`hide_parameters=True`), because those messages reach the error log.
- The only way trace data reaches a proposal is `derive_line_geometry`: it cuts the first and
  last 200 m of travelled distance, then removes every part of the line that lies within 200 m of
  the raw start or the raw end anywhere along the path (a ride that passes the start again, a
  closed loop, or one that passes its end early) and keeps the longest remaining stretch,
  simplifies it (about 5 m) and rejects the result (`422 trace.too_short`) when less than
  100 m remain or any densified point is closer than 194 m to a protected end. The edit payload
  stores only the derived coordinates and `geometry_source: trace`, never the trace id or raw
  points; the trace must belong to the author (404 otherwise, no existence signal) and can be
  linked once.
- Retention: a trace gets `delete_after = upload + 30 days`; approving its linked edit sets
  `delete_after = publication + 30 days`; the hourly job `purge_expired_traces` deletes expired
  traces and logs only the count. `DELETE me` deletes the user's traces immediately (ADR-0026).
- A public response scanner (`tests/privacy/test_public_responses.py`) enumerates every route
  of the real app (`tests/support/routes.py` flattens the FastAPI 0.143 router tree), requires
  each to be classified public or private, calls every public route anonymously after a
  trace-derived version has been published and exported, and fails on any `trace`, `traces`,
  `trace_id`, `points`, `linked_edit_id`, `author_id`, `published_by`, `source_edit_id` or
  `email` key or any raw trace coordinate pair in the body.

## Consequences

- A very short or a fully looping ride yields no proposal geometry; the contributor draws the
  line instead.
- A trace attached to a pending edit can still expire before moderation (30 days after upload);
  the derived geometry stays in the edit.

## Evidence

Command: `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/traces tests/privacy tests/review` (29, 3 and 3 tests, all passed).

| # | Check | Test | Result |
| - | ----- | ---- | ------ |
| 1 | Trim | `tests/traces/test_derive_retention.py::test_trim_removes_first_and_last_200m` (200 m +- 1 m at both ends), `test_trim_excludes_every_return_to_the_endpoints` (3 shapes), `test_too_short_trace_rejected` | passed |
| 2 | Derived proposal holds no raw data | `test_trace_derived_edit_stores_only_trimmed_geometry`, `test_cannot_use_other_users_trace`, `test_trace_cannot_be_linked_twice`, `test_new_line_trace_and_geometry_choice` | passed |
| 3 | Retention with a frozen clock | `test_retention_deletes_30_days_after_publication` (kept at T + 29 d 23 h, deleted at T + 30 d), `test_unpublished_trace_expires_30_days_after_upload` | passed |
| 4 | Input bounds | `tests/traces/test_traces.py::test_trace_invalid_rules`, `test_trace_time_rules`, `test_trace_body_limit` (413), `test_trace_rate_limit_20_per_day` | passed |
| 5 | Access | `test_trace_read_permissions`, `test_trace_delete_owner_only`, `test_trace_read_other_contributor_and_anonymous_denied`, IDOR rows for traces | passed |
| 6 | Logs | `test_trace_body_not_logged`, `tests/review/test_review_fixes.py::test_engine_hides_parameters` | passed |
| 7 | Public scanner | `tests/privacy/test_public_responses.py::test_every_route_is_classified`, `test_public_responses_have_no_trace_data` (18 public probes incl. plan, pack, sitemap, latest.geojson; 22 private routes classified) | passed |
| 8 | Mutation M3 | `TRIM_METRES = 0` | 4 failed (`test_trim_removes_first_and_last_200m`, `test_too_short_trace_rejected`, `test_trace_body_not_logged`, `test_public_responses_have_no_trace_data`); restored |
| 9 | Mutation M4 | public line detail returns `source_edit_id` | `test_public_responses_have_no_trace_data` failed; restored |
| 10 | Mutation M9 | endpoint-area exclusion removed (distance trim only) | `test_trim_excludes_every_return_to_the_endpoints[revisits-start]` and `[passes-end-early]` failed; restored |

Not exercised:

- `not exercised: on-device Douglas-Peucker and foreground recording` (phase 3 app).
