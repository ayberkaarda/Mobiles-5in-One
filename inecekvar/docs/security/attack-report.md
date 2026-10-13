# Attack report (phase 6, package 6B)

Executed attacks against the API through the real ASGI application (all routers, Testcontainers PostGIS, MinIO and Redis) in `api/tests/security/test_attack_suite.py` (97 tests), storage and log scans in `api/tests/security/test_dump_and_log_scan.py` (2 tests), and the stored-XSS sweep over the web, admin and PWA surfaces against the real local stack (`apps/web-e2e/src/xss-sweep.spec.ts`, `apps/mobile-e2e/src/xss-sweep.spec.ts`, see `xss-sweep.md`). Decisions and evidence: ADR-0052. This report covers what the attack suite and the sweep found; the ZAP, MobSF and pentest steps of item 23 are separate packages.

## Findings

| # | Finding | Severity | Status | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Per-IP quotas counted each IPv6 address separately and an IPv4-mapped IPv6 address (`::ffff:198.51.100.7`) separately from the same IPv4 address. A client holding a /64 (the normal allocation of one subscriber) could rotate addresses and get a fresh login, registration, magic-link, refresh, step-up, plan, stop-pair and pack window per address. | Medium | **Fixed**: `app/core/client_ip.py::rate_limit_key` (IPv6 counted per /64, mapped IPv4 unwrapped), used by the `rate_limit` dependency (`app/core/deps.py`), the registration-link password limit (`app/auth/router.py`), the step-up IP limit (`app/auth/totp_router.py`) and the pack network identity (`app/export/router.py`) | `test_ipv6_rotation_within_one_64_and_mapped_ipv4_share_a_window` was red before the fix (`assert [401, 401, 401, 401, 401, 401] == [401, 401, 401, 401, 401, 429]`) and is green after; reverting the /64 line turns it red again (mutation M8). A neighbouring /64 keeps its own window (same test). |
| 2 | The PWA sets no Content-Security-Policy: neither `apps/mobile/src/index.html` nor the Caddy site block for `app.inecekvar.app` sends one, so stored-XSS defence on the PWA rests on Angular's text binding alone (the sweep found no escaping fault). The build's only inline script is the critical-CSS loader of beasties, which a policy would need to allow by hash. | Low (defence in depth) | **Open, not fixed here**: the fix belongs to `ops/Caddyfile` (lead) and the mobile build (hash of the loader or disabling inline critical CSS); beyond this package's boundary | `xss-sweep.md` "PWA CSP"; the PWA sweep passes with 0 dialogs and a clean DOM on all surfaces |
| 3 | `tests/traces/test_traces.py::test_trace_body_not_logged` matched the log timestamp (`"timestamp": "...:34.963348Z"`) against its coordinate pattern and failed whenever the wall-clock second was 34 or 42 (seen once in the full run). | Test defect | **Fixed** in the test: the timestamp key is excluded, every other logged value is still checked | full run before: `1 failed, 1006 passed`; the test passes now |

No other attack succeeded. Observations that are not defects:

- Markup is stored verbatim by design (item 16: notes are plain text, escaping happens at output). Control and format characters (bidi overrides, isolates, zero-width, NUL) are refused at input (`clean_text`, `clean_display_name`); U+2028 and U+2029 are accepted, escaped in JSON-LD and dropped by the SVG writer.
- No data field holds a URL, so `javascript:` and `data:` payloads can only ever appear as text.
- After finding 1, every IPv6 device behind one /64 shares the anonymous first free city and the daily pack quota; a household already shares one IPv4 address the same way. Accepted.
- Routes without a body (approve, favourites PUT, logout) ignore a JSON body; `test_mass_assignment_is_refused_on_every_body_route` shows that a forged `state`/`reviewer_id` body changes nothing.
- The RevenueCat event row keeps only the fields the job reads: an email in `subscriber_attributes` is not stored (`test_pg_dump_holds_no_plaintext_secret_or_raw_webhook_email`).

## Coverage by threat-model heading

| Heading | Executed attack and expected refusal |
| --- | --- |
| GPS trace privacy | `test_trace_privacy_other_owner_anonymous_and_public_reads`: another contributor 403 and anonymous 401 without points, foreign delete 403, raw points absent from five public endpoints |
| Data poisoning | `test_poisoned_proposals_are_refused_without_publication`: 13 malformed proposals 422, SQL-shaped name stored as text, no line published |
| Sockpuppet approval | `test_sockpuppet_cannot_approve_and_low_reputation_floods_are_capped`: contributor and self approval 403, 11th low-reputation edit 429 |
| Planner denial of service | `test_planner_refuses_outside_bbox_and_absurd_parameters` (16 cases 422), `test_planner_rejects_non_finite_numbers_and_floods` (NaN/Infinity 422, 31st request 429) |
| PMTiles egress | `test_tiles_redirect_ignores_host_and_packs_are_capped`: redirect fixed to the CDN despite hostile Host headers, traversal 404, 11th pack 429 despite spoofed headers |
| Plugin permission bypass | `test_native_origins_cannot_use_or_obtain_cookie_sessions`: Capacitor origin cookie login 403, bearer mode sets no cookie, a web cookie replayed from a native origin 403 |
| SSR cache poisoning | `test_api_answers_are_uncacheable_json_and_never_reflect_host_or_query` (API side), the web XSS sweep (SSR side) |
| Account deletion | `test_deleted_account_tokens_traces_and_favourites_are_gone`: access, refresh and trace reads 401, traces and favourites gone |
| CSRF in cookie mode | `test_csrf_missing_foreign_cross_site_and_tunnelled_requests_are_refused`: 10 forged variants 403 |
| Capacitor and CORS | `test_hostile_origins_get_no_cors_headers` (10 origins), `test_duplicate_origin_headers_and_unlisted_preflight_headers_are_refused` |
| Webhook forgery | phase 5 suites (`tests/webhooks/*`, ADR-0050) are the reference; `test_forged_purchase_event_unlocks_no_second_city` adds forged purchase then second city 403 |
| Pack entitlement bypass | `test_second_city_refused_despite_forged_purchase_flags`: forged headers and query flags, anonymous and signed in, 403 |
| Refresh token reuse | `test_refresh_reuse_kills_the_whole_family`: replay revokes child and access token; concurrent rotation gives one 200 and one 401 |
| Magic link interception | `test_magic_links_are_single_use_expiring_and_unguessable`: tampered, raced, replayed and expired links 401 |
| Moderator collusion | `test_reciprocal_approval_between_two_moderators_is_refused`: 409 `moderation.reciprocal_conflict` |
| Photo upload abuse | `test_upload_type_size_spoof_and_metadata_attacks`: 8 presign refusals, polyglot and SVG quarantined, GPS EXIF stripped |
| Object authorization bypass | `test_favourites_and_edit_lists_are_scoped_to_the_caller` plus `test_idor.py` |
| Rate-limit and token tampering | `test_tampered_access_tokens_are_refused` (13 forged tokens and 4 malformed headers 401, a validly signed role claim ignored), `test_spoofed_forwarding_headers_do_not_reset_the_ip_limit`, `test_trusted_proxy_header_forms_of_one_address_share_a_window`, `test_ipv6_rotation_within_one_64_and_mapped_ipv4_share_a_window`, `test_email_spelling_variants_share_the_victim_window` |
| Secret exposure and recovery failure | `test_forced_errors_and_validation_failures_echo_nothing`, `test_pg_dump_holds_no_plaintext_secret_or_raw_webhook_email`, `test_combined_session_log_has_no_email_token_coordinate_or_secret` |

Section 6 extras: `test_body_limits_refuse_declared_streamed_and_oversized_traces`, `test_coordinates_outside_the_city_are_refused_on_every_write`, `test_field_bounds_are_refused` (35 bounds), `test_every_body_route_is_listed_and_forbids_extra_fields`, `test_mass_assignment_is_refused_on_every_body_route`, `test_enum_fuzzing_is_refused`, `test_search_wildcards_injection_and_sort_parameters_are_inert`, `test_host_header_never_reaches_links_or_responses`, `test_method_override_and_verb_tunnelling_do_nothing`, `test_step_up_replay_other_session_other_account_and_expiry_are_refused`, `test_step_up_code_guessing_is_rate_limited`, `test_register_login_and_magic_link_answer_alike_for_known_and_unknown`.

## Mutations

| # | Mutation | Red test | Restored |
| --- | --- | --- | --- |
| M1 | SVG text unescaped (`libs/ui/src/lib/safe-svg.ts`) | web `OG images, sitemaps and llms-full.txt stay well-formed`: `script-element <script>` | yes |
| M2 | JSON-LD `<` escape removed (`apps/web/src/app/seo/json-ld.ts`) | web `SSR pages without JavaScript render every payload as text`: `line script-element JSON-LD` | yes |
| M3 | Admin queue renders the proposed value via `[innerHTML]` (`queue.page.ts`) | web admin sweep: `admin queue: injected elements ["img src=x", "b element"]` | yes |
| M4 | Trace owner check removed (owner taken from the caller, `traces/router.py`) | `test_trace_privacy_other_owner_anonymous_and_public_reads`: `assert 200 == 403` with the private points in the body | yes |
| M5 | CSRF skipped on `PATCH /v1/me` (`core/deps.py`) | `test_csrf_missing_foreign_cross_site_and_tunnelled_requests_are_refused`: `assert 200 == 403` | yes |
| M6 | Step-up dropped on `GET /v1/admin/users` (plain admin role) | `test_step_up_replay_other_session_other_account_and_expiry_are_refused`: `assert 200 == 403` | yes |
| M7 | General body limit raised to 4 MiB (`core/settings.py`) | `test_body_limits_refuse_declared_streamed_and_oversized_traces`: `assert 422 == 413` | yes |
| M8 | IPv6 /64 grouping reverted (`core/client_ip.py`) | `test_ipv6_rotation_within_one_64_and_mapped_ipv4_share_a_window`: `[401]*6 == [401]*5 + [429]` fails | yes |

## Retest

```
cd inecekvar/api
INECEKVAR_ENV=test INECEKVAR_REQUIRE_DOCKER=1 uv run pytest tests/security -q
```
