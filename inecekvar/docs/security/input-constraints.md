# Input constraints (security checklist item 6, with item 7 upload bounds)

Every bound that section 6 item 6 (and item 7 for uploads) asks for, where the API enforces it and the negative test that proves the refusal. The API is the enforcement point; the Angular validators of the app mirror the rules for UX only (ADR-0035). All tests run with `INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest` in `inecekvar/api`; `AS` means `tests/security/test_attack_suite.py`, `BOUNDS[id]` means `AS::test_field_bounds_are_refused[id]` (one parametrized case per bound, each asserts `422 validation.failed`).

Text fields share `clean_text` (`app/edits/schemas.py`): a string is required, any Unicode category C character (control, format such as bidi overrides and zero-width characters, NUL) is refused, the value is stripped and must not be empty. Line and paragraph separators (U+2028, U+2029, category Z) are accepted and rendered as text (see `xss-sweep.md`).

## Geometry and coordinates

| Bound | Constraint (code) | Negative tests |
| --- | --- | --- |
| Coordinate range and finiteness (lng -180..180, lat -90..90, no NaN/Inf) | `geo.validate_coordinate`; planner `PointInput` `Field(ge, le, allow_inf_nan=False)`; trace `TraceNumber` `Field(strict=True, allow_inf_nan=False)`; `stops/near` `Query(ge, le)` | `AS::test_poisoned_proposals_are_refused_without_publication` (`[200, 95]`, NaN literal), `AS::test_planner_refuses_outside_bbox_and_absurd_parameters[latitude-91]`, `[longitude-181]`, `[huge-coordinates]`, `AS::test_planner_rejects_non_finite_numbers_and_floods`, `BOUNDS[near-latitude-91]`, `tests/traces/test_traces.py::test_trace_invalid_rules` (NaN, Inf) |
| Coordinates inside the city bbox | `edits.service.validate_city_data` (`edit.outside_bbox`, re-checked at approval), traces router (`trace.outside_bbox`), planner router (`plan.outside_city`) | `AS::test_coordinates_outside_the_city_are_refused_on_every_write` (trace, new stop, new line, line update, stop move), `AS::test_planner_refuses_outside_bbox_and_absurd_parameters[from-outside-bbox]`, `[to-outside-bbox]`, `tests/domain/test_validation.py::test_outside_bbox`, `tests/planner/test_api.py::test_plan_outside_bbox_is_422` |
| Two-dimensional coordinates in proposals | `Coordinate = tuple[float, float]` | `AS::test_poisoned_proposals_are_refused_without_publication` (3D points) |
| Polyline 2..5 000 points, at least two distinct | `GeometryInput` `Field(min_length=2, max_length=5000)` + `validate_polyline` | `tests/domain/test_validation.py::test_too_many_points`, `test_two_distinct_points_required`, `BOUNDS[geometry-one-point]` |
| Polyline at most 150 km | `validate_polyline` (geodesic length) | `tests/domain/test_validation.py::test_too_long_polyline` |
| Valid geometry, no self-intersection | `validate_polyline` (`is_valid`, `is_simple`; a simple closed ring is allowed) | `tests/domain/test_validation.py::test_self_intersection`, `AS::test_poisoned_proposals_are_refused_without_publication` (bowtie), `test_simple_closed_loop_is_accepted` (the allowed case) |
| Trace 2..5 000 points | `TraceInput.points` `Field(min_length=2, max_length=5000)` | `tests/traces/test_traces.py::test_trace_invalid_rules`, `BOUNDS[trace-one-point]` |
| Trace at most 150 km, valid line | `TraceInput.valid` | `BOUNDS[trace-over-150km]`, `tests/traces/test_traces.py::test_trace_invalid_rules` |
| Trace numbers are JSON numbers | `TraceNumber` strict | `BOUNDS[trace-string-number]` |
| Trace time: aware, start before end, at most 12 h, end at most 5 min in the future | `TraceInput` (`AwareDatetime`, validator), router (`trace.future_end`) | `tests/traces/test_traces.py::test_trace_time_rules` (order, future, duration), `BOUNDS[trace-naive-time]`, `BOUNDS[trace-span-13h]` |

## Numbers and identifiers

| Bound | Constraint (code) | Negative tests |
| --- | --- | --- |
| Fare 0..10 000 000 minor units | `Fare = Annotated[int, Field(ge=0, le=10000000)]` | `tests/domain/test_validation.py::test_fare_bounds[-1]`, `[10000001]` |
| Version numbers 1..2 147 483 647 | `base_version_no`, `RollbackInput.version_no` | `BOUNDS[base-version-zero]`, `BOUNDS[rollback-version-zero]` |
| Stops of a line: 2..200, unique, active, same city | `StopIds` `Field(min_length=2, max_length=200)` + `unique_stops`; `validate_city_data` | `BOUNDS[stop-ids-one]`, `BOUNDS[stop-ids-201]`, `tests/domain/test_validation.py::test_duplicate_stops_and_payments`, `test_unknown_stop`, `test_stop_of_another_city` |
| Payment methods: at most 3, unique, enum | `Payments` `Field(max_length=3)` + `unique_payments` | `BOUNDS[payments-four]`, `tests/domain/test_validation.py::test_duplicate_stops_and_payments`, `AS::test_enum_fuzzing_is_refused` |
| Planner transfers 0..2, strict integer | `PlanInput.max_transfers` `Field(strict=True, ge=0, le=2)` | `AS::test_planner_refuses_outside_bbox_and_absurd_parameters[three-transfers]`, `[absurd-transfers]`, `[negative-transfers]`, `[string-transfers]`, `[float-transfers]`, `[bool-transfers]` |
| Paging: `limit` 1..100 (stops 1..50), `offset` 0..100 000; `stops/near` radius 1..2 000 m | `Limit`, `Offset`, `Query(ge, le)` | `BOUNDS[lines-limit-101]`, `BOUNDS[lines-offset-negative]`, `BOUNDS[stops-limit-51]`, `BOUNDS[near-radius-2001]`, `tests/domain/test_stop_search.py::test_search_bounds`, `tests/security/test_admin_routes.py::test_user_query_bounds`, `test_audit_query_bounds` |

## Strings

| Bound | Constraint (code) | Negative tests |
| --- | --- | --- |
| Line and stop name 1..160, `clean_text` | `Name` | `BOUNDS[name-161]`, `BOUNDS[blank-name]`, `tests/domain/test_validation.py::test_control_characters` |
| Line code 1..32, letters, digits, space, `.-/` | `NewLine.code` pattern | `BOUNDS[code-33]`, `BOUNDS[code-pattern]` |
| City slug in proposals and traces 1..80; planner slug pattern | `CitySlug`, `TraceInput.city`, `PlanInput.city` pattern | `BOUNDS[city-slug-81]`, `BOUNDS[trace-city-81]`, `AS::test_planner_refuses_outside_bbox_and_absurd_parameters[slug-injection]`, `[long-slug]` |
| Hours text at most 500 | `Hours` | `BOUNDS[hours-501]` |
| Hailing notes at most 1 000 | `HailNotes` | `BOUNDS[notes-1001]` |
| Retirement reason 1..500 | `Retire.reason` | `BOUNDS[retire-reason-501]` |
| Rejection reason 1..1 000 | `RejectInput.reason` | `BOUNDS[reject-reason-1001]`, `BOUNDS[reject-reason-blank]` |
| Display name 1..60, no category C | `clean_display_name` | `BOUNDS[display-name-61]`, `BOUNDS[display-name-control]` |
| Email: valid address, at most 320 | `Email = Annotated[EmailStr, Field(max_length=320)]` | `BOUNDS[email-321]`, `AS::test_forced_errors_and_validation_failures_echo_nothing` |
| Password at most 1 024; policy at least 10 and not breached | `Password` `Field(max_length=1024)`; `check_password_policy` | `BOUNDS[password-1025]`, `tests/auth/test_links_login.py::test_register_rejects_weak_passwords` |
| Opaque tokens 16..256 of `[A-Za-z0-9_-]` | `OpaqueToken` | `BOUNDS[token-short]`, `BOUNDS[token-charset]` |
| TOTP code exactly six ASCII digits | `TotpCodeIn.code` | `BOUNDS[totp-code-five]`, `BOUNDS[totp-code-letters]`, `tests/auth/test_totp_helpers.py::test_counter_requires_exactly_six_ascii_digits` |
| Search terms: lines `q` 1..80, stops `q` 1..64, wildcards literal | `Query(min_length, max_length)`; escaped `ILIKE` | `AS::test_search_wildcards_injection_and_sort_parameters_are_inert`, `tests/domain/test_public.py::test_line_search_escapes_wildcards`, `tests/domain/test_stop_search.py::test_search_treats_sql_and_wildcards_literally` |
| Admin filters: audit `action`/`target_type` `^[a-z_.]{1,64}$`, export slug `^[a-z0-9-]+$` at most 120, suppression email at most 320 | `AuditFilter`, `create_export` `Path`, `SuppressionRemovalIn` | `tests/security/test_admin_routes.py::test_audit_query_bounds`, `test_export_slug_bounds`, `tests/security/test_admin_suppressions.py::test_body_is_bounded` |

## Enums and unknown fields

| Bound | Constraint (code) | Negative tests |
| --- | --- | --- |
| Enums: line mode, stop kind, payment, edit kind, auth mode, photo kind and type, role, queue state, role filter | `LineMode`, `StopKind`, `Payment`, discriminated `EditInput`, `AuthMode`, `PresignInput`, `UserRole`, `Literal` query | `AS::test_enum_fuzzing_is_refused`, `AS::test_upload_type_size_spoof_and_metadata_attacks` |
| Unknown fields refused on every body | `ConfigDict(extra="forbid")` on every request model, nested models included | `AS::test_every_body_route_is_listed_and_forbids_extra_fields` (route table and recursive model check), `AS::test_mass_assignment_is_refused_on_every_body_route` (19 routes, one privileged field each), `tests/domain/test_validation.py::test_unknown_field` |

## Request bodies

| Bound | Constraint (code) | Negative tests |
| --- | --- | --- |
| Body at most 1 MiB (declared and streamed) | `BodyLimitMiddleware`, `Settings.max_body_bytes` | `AS::test_body_limits_refuse_declared_streamed_and_oversized_traces`, `tests/core/test_body_limit.py::test_body_limit_1mb` |
| Trace body at most 2 MiB | `Settings.max_trace_body_bytes` | `AS::test_body_limits_refuse_declared_streamed_and_oversized_traces` (streamed and declared above 2 MiB; 1.3 MB accepted past the general limit), `tests/core/test_body_limit.py::test_trace_body_limit_2mb`, `tests/traces/test_traces.py::test_trace_body_limit` |
| Webhook body at most 64 KiB, length required | `Settings.max_webhook_body_bytes`, `LENGTH_REQUIRED` | `tests/webhooks/test_resend_webhook.py::test_resend_rejections` (oversized), `tests/webhooks/test_revenuecat_webhook.py::test_revenuecat_rejections` |
| JSON only; malformed `Content-Length` refused | `BodyLimitMiddleware` (415, 400) | `AS::test_body_limits_refuse_declared_streamed_and_oversized_traces` (`text/plain` 415, `Content-Length: abc`), `tests/core/test_body_limit.py::test_non_json_body_rejected` |

## Uploads (item 7)

| Bound | Constraint (code) | Negative tests |
| --- | --- | --- |
| Photo types `image/jpeg`, `image/webp` | `PresignInput.content_type` `Literal` | `AS::test_upload_type_size_spoof_and_metadata_attacks` (SVG, PNG, HTML, parameterised type) |
| Size 1 byte..4 MiB, bound into the presigned PUT | `PresignInput.byte_size`, `Settings.media_max_bytes`, presigned `Content-Length` | `AS::test_upload_type_size_spoof_and_metadata_attacks` (0 and 4 MiB + 1), `tests/media/test_media.py::test_oversize_rejected_at_presign`, `test_upload_longer_than_presigned_length_refused`, `tests/core/test_storage.py::test_presigned_put_rejects_other_length_or_type` |
| Magic bytes and decodability; quarantine on failure | `workers/media.process_photo` | `AS::test_upload_type_size_spoof_and_metadata_attacks` (JPEG header with HTML body, SVG declared as WebP), `tests/media/test_media.py::test_mime_spoof_is_quarantined`, `test_decompression_bomb_quarantined` |
| Re-encode to WebP at most 1 600 px without metadata | `workers/media.process_photo` | `AS::test_upload_type_size_spoof_and_metadata_attacks` (WebP with GPS EXIF), `tests/media/test_media.py::test_presign_put_and_process_strips_exif` |
| Quota 20 per day per user | `media.presign` rate rule | `tests/media/test_media.py::test_presign_quota_20_per_day` |
| Traces are validated JSON, never files | `TraceInput` | `tests/traces/test_traces.py::test_trace_invalid_rules` |
