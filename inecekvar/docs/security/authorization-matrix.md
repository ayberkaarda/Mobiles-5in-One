# Authorization matrix

All authorization is enforced by the service using stored roles and ownership.
Interface guards grant no access. Unknown roles and actions fail closed.

## Policy table

The total table in `app/security/policy.py` implements specification section 6.3.

| Action | anonymous | user | contributor | moderator | admin |
| --- | --- | --- | --- | --- | --- |
| propose_edit | deny | deny | allow-if:licence_accepted | allow-if:licence_accepted | allow-if:licence_accepted |
| edit_own_pending | deny | allow-if:edit_author+edit_pending | allow-if:edit_author+edit_pending | allow-if:edit_author+edit_pending | allow-if:edit_author+edit_pending |
| upload_trace | deny | deny | allow-if:licence_accepted | allow-if:licence_accepted | allow-if:licence_accepted |
| view_trace | deny | allow-if:trace_owner | allow-if:trace_owner | allow | allow |
| approve_edit | deny | deny | deny | allow-if:edit_pending+not_own_proposal | allow-if:edit_pending+not_own_proposal |
| reject_edit | deny | deny | deny | allow-if:edit_pending+not_own_proposal | allow-if:edit_pending+not_own_proposal |
| publish_version | deny | deny | deny | allow-if:edit_pending+not_own_proposal | allow-if:edit_pending+not_own_proposal |
| rollback | deny | deny | deny | allow-if:totp_step_up | allow-if:totp_step_up |
| retire_line | deny | deny | deny | allow-if:totp_step_up | allow-if:totp_step_up |
| manage_users | deny | deny | deny | deny | allow-if:totp_step_up |
| export_admin | deny | deny | deny | deny | allow-if:totp_step_up |

Conditions (all conditions in a cell must hold):

- `licence_accepted`: the stored licence acceptance timestamp is present.
- `trace_owner`: actor and stored trace owner ids are present and equal.
- `edit_author`: actor and stored edit author ids are present and equal.
- `edit_pending`: the stored edit state equals `pending`.
- `not_own_proposal`: actor and stored edit author ids are present and different.
- `totp_step_up`: the account has TOTP enrolled, and a verified step-up of the current session (cookie session id or bearer refresh family id) and server time are present; age is 0 through 15 minutes inclusive. Future timestamps are denied.

Enforcement points:

- `authorize` replaces the context actor id with the principal identity. Anonymous denied cells raise 401; authenticated denials raise 403.
- `require_permission` checks resource-free actions. Proposal and trace upload checks load licence acceptance from the principal's stored user row.
- `load_actor_context` loads licence acceptance and server time.
- `step_up_context` (phase 4, ADR-0037) loads the stored `users.totp_enabled_at` and the `session_step_ups.verified_at` row keyed by the principal's session id and user id through the production `SessionStepUpSource`; `require_step_up(action)` applies it to the admin routes and `moderation.service.context_for` to rollback and retire approval. A step-up of another session of the same account never counts.
- When only `totp_step_up` fails in an otherwise satisfied cell, `authorize` answers 403 `auth.totp_enrolment_required` (no TOTP enrolled) or 403 `auth.step_up_required` (enrolled, no fresh step-up of this session); every other denial stays 403 `auth.forbidden` (401 `auth.required` for anonymous).
- Resource services load owner, author and state from stored rows before calling `authorize`. Request input cannot establish ownership or step-up.
- `app/core/deps.py` checks cookie origins against the web allowlist and verifies the session-bound CSRF header on methods other than GET, HEAD and OPTIONS. Absent Origin passes. Foreign and Capacitor origins cannot use cookie authentication. Bearer authentication takes precedence and does not require CSRF.
- Route-level `can_read_edit(principal, author_id)` permits moderator or admin, or an authenticated caller matching the present stored author id. Anonymous callers cannot read edits. This rule has no section 6.3 action.
- Trace deletion remains a route-level stored-owner rule for every signed-in role; moderation read permission does not grant deletion.

Tests: `api/tests/security/test_policy_matrix.py` checks all 55 cells, table completeness, every conditional cell with each required predicate broken separately, every denied cell, unknown inputs, step-up boundaries, actor replacement, error statuses, absent context, edit reads and this document. Author and non-author predicates cannot hold simultaneously; denied cells are tested with both context variants.
`api/tests/security/test_idor.py` registers 19 real-account bearer cases against the real trace, edit and moderation routes (reads, deletion, approval, rejection, self-review and anonymous access) and 3 admin cases (a moderator or a not stepped-up admin cannot change another account's role; a stepped-up contributor cannot list users). `api/tests/security/test_admin_routes.py` enumerates every mounted `/v1/admin` route, fails when one is missing from its table, and runs each route against anonymous, user, contributor and moderator (each with a fresh step-up), and admin without TOTP, enrolled without step-up, with a step-up older than 15 minutes, with the step-up of another session and with a fresh step-up. Table-driven step-up cases in `test_policy_matrix.py` cover every `totp_step_up` cell: not enrolled answers `auth.totp_enrolment_required`, enrolled but stale `auth.step_up_required`, fresh allowed.

## API routes

Paths are relative to `/v1`. Signed-in access requires an active account.
Cookie mutations require CSRF, except the dedicated authenticated CSRF bootstrap.
Input validation, quotas and audit controls apply independently of authorization.
Phase 1 auth evidence below names existing test modules.

| API resource and action | Anonymous | User | Contributor | Moderator | Admin | Implementation status |
| --- | --- | --- | --- | --- | --- | --- |
| POST auth/register; POST auth/login; POST auth/magic-link | allow | allow | allow | allow | allow | implemented: phase 1; api/tests/auth/test_links_login.py |
| POST auth/magic-link/verify | allow-if:valid-single-use-link | allow-if:valid-single-use-link | allow-if:valid-single-use-link | allow-if:valid-single-use-link | allow-if:valid-single-use-link | implemented: phase 1; api/tests/auth/test_links_login.py |
| POST auth/refresh | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | implemented: phase 1; api/tests/auth/test_refresh_jwt.py |
| POST auth/logout | deny | allow-if:own-session | allow-if:own-session | allow-if:own-session | allow-if:own-session | implemented: phase 1; api/tests/auth/test_sessions.py |
| POST auth/logout-all | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | implemented: phase 1; api/tests/auth/test_sessions.py |
| POST auth/csrf (web) | deny | allow-if:own-cookie-session | allow-if:own-cookie-session | allow-if:own-cookie-session | allow-if:own-cookie-session | implemented: phase 1; api/tests/auth/test_sessions.py |
| GET me; PATCH me | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | implemented: phase 1; api/tests/auth/test_accounts.py |
| GET me/totp | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | implemented: phase 4; api/tests/totp/test_totp_step_up.py |
| POST me/totp/enrol | deny | allow-if:owner-and-recent-login | allow-if:owner-and-recent-login | allow-if:owner-and-recent-login | allow-if:owner-and-recent-login | implemented: phase 4; api/tests/totp/test_totp_step_up.py |
| POST me/totp/confirm; POST auth/step-up | deny | allow-if:owner-and-valid-totp-code | allow-if:owner-and-valid-totp-code | allow-if:owner-and-valid-totp-code | allow-if:owner-and-valid-totp-code | implemented: phase 4 (5 per 15 minutes per user and per IP); api/tests/totp/test_totp_step_up.py |
| DELETE me/totp | deny | allow-if:owner+totp_step_up | allow-if:owner+totp_step_up | allow-if:owner+totp_step_up | allow-if:owner+totp_step_up | implemented: phase 4; api/tests/totp/test_totp_step_up.py |
| DELETE me | deny | allow-if:owner-and-reauthenticated | allow-if:owner-and-reauthenticated | allow-if:owner-and-reauthenticated | allow-if:owner-and-reauthenticated | implemented: phase 1 deletion request, phase 2 grace and hard delete; api/tests/auth/test_accounts.py, api/tests/deletion/test_deletion.py |
| POST me/licence-accept | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | implemented: phase 1; api/tests/auth/test_accounts.py |
| GET cities; GET cities/{slug} | allow | allow | allow | allow | allow | implemented: phase 2; api/tests/domain/test_public.py |
| GET cities/{slug}/pack | allow-if:first-city-and-download-quota | allow-if:pack-entitled-and-download-quota | allow-if:pack-entitled-and-download-quota | allow-if:pack-entitled-and-download-quota | allow-if:pack-entitled-and-download-quota | implemented: phase 2 (first city, quota, header), phase 5 (Plus from the `subscriptions` rows kept by the RevenueCat webhook and the nightly reconciliation, ADR-0050); api/tests/export/test_packs.py, api/tests/billing/test_entitlement_matrix.py |
| GET cities/{slug}/tiles.pmtiles | allow | allow | allow | allow | allow | implemented: phase 2 (redirect only when configured); api/tests/export/test_packs.py |
| GET lines?city=&q=; GET lines/{slug}; GET lines/{slug}/versions | allow | allow | allow | allow | allow | implemented: phase 2; api/tests/domain/test_public.py |
| GET stops/{slug}; GET stops/near?lat=&lng=&radius= | allow | allow | allow | allow | allow | implemented: phase 2; api/tests/domain/test_public.py |
| GET stops?city=&q= | allow | allow | allow | allow | allow | implemented: phase 4 (city required, q at most 64 characters, bound ILIKE pattern, at most 50 results); api/tests/domain/test_stop_search.py |
| GET cities/{slug}/stop-pairs?limit=; GET sitemap | allow | allow | allow | allow | allow | implemented: phase 4 (public page data, no personal values); api/tests/domain/test_public_pages.py |
| POST plan | allow | allow | allow | allow | allow | implemented: phase 2; api/tests/planner/test_api.py |
| POST traces | deny | deny | allow-if:licence_accepted | allow-if:licence_accepted | allow-if:licence_accepted | implemented: phase 2; api/tests/traces/test_traces.py |
| GET traces/{id} | deny | allow-if:trace_owner | allow-if:trace_owner | allow | allow | implemented: phase 2; api/tests/security/test_idor.py, api/tests/traces/test_traces.py |
| DELETE traces/{id} | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | implemented: phase 2; api/tests/security/test_idor.py |
| POST edits; POST media/presign | deny | deny | allow-if:licence_accepted | allow-if:licence_accepted | allow-if:licence_accepted | implemented: phase 2; api/tests/domain/test_authorization.py, api/tests/media/test_media.py |
| GET edits (mine) | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | implemented: phase 2; api/tests/domain/test_authorization.py |
| GET edits/{id} | deny | allow-if:edit_author | allow-if:edit_author | allow | allow | implemented: phase 2; api/tests/security/test_idor.py |
| GET me/favorites/{lineId}; PUT me/favorites/{lineId}; DELETE me/favorites/{lineId} | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | implemented: phase 2 (plus GET me/favorites); api/tests/domain/test_favorites.py |
| GET moderation/edits?state=pending | deny | deny | deny | allow | allow | implemented: phase 2; api/tests/domain/test_authorization.py |
| POST moderation/edits/{id}/approve; POST moderation/edits/{id}/reject | deny | deny | deny | allow-if:edit_pending+not_own_proposal | allow-if:edit_pending+not_own_proposal | implemented: phase 2 (reciprocal approvals refused); api/tests/security/test_idor.py, api/tests/domain/test_moderation.py |
| POST moderation/lines/{id}/rollback | deny | deny | deny | allow-if:totp_step_up | allow-if:totp_step_up | implemented: phase 2 route, phase 4 production step-up (ADR-0037); api/tests/domain/test_moderation.py, api/tests/totp/test_totp_step_up.py |
| POST webhooks/revenuecat; POST webhooks/resend | deny | deny | deny | deny | deny | implemented: phase 5 (provider credential only: RevenueCat shared secret plus a known account, Resend Svix signature within five minutes; idempotent by event id; outside the public OpenAPI contract, ADR-0050); api/tests/webhooks, api/tests/security/test_webhook_routes.py |
| GET export/{city}/latest.geojson | allow | allow | allow | allow | allow | implemented: phase 2; api/tests/export/test_export.py |
| GET cities/{slug}/sitemap | allow | allow | allow | allow | allow | implemented: phase 2; api/tests/export/test_export.py |
| GET admin/users; PATCH admin/users/{id}/role; GET admin/audit-logs (manage_users) | deny | deny | deny | deny | allow-if:totp_step_up | implemented: phase 4 (last active admin cannot be demoted, role changes audited); api/tests/security/test_admin_routes.py, api/tests/security/test_idor.py |
| POST admin/exports/{city} (export_admin) | deny | deny | deny | deny | allow-if:totp_step_up | implemented: phase 4; api/tests/security/test_admin_routes.py |

Route conditions:

- `owner`: the authenticated identity matches the stored owner, never request input. Trace owners retain deletion access after a role change to user.
- `owner-and-recent-login`: the cookie session or bearer refresh family was created within ten minutes (a fresh password or magic-link sign-in), otherwise 403 `auth.reauth_required`; an enrolled account must disable TOTP (which needs a step-up) before enrolling again.
- `owner-and-valid-totp-code`: a six-digit code of the stored secret within one 30-second step either side whose time step is newer than the last accepted one (replay refused); failures are audited and answer 403 `auth.totp_invalid_code`.
- `owner-and-reauthenticated`: password accounts verify their password; passwordless accounts require a session or bearer family created within ten minutes. DELETE me returns 202, immediately deactivates and revokes tokens, removes favorites and private traces, withdraws pending edits, and schedules deletion after seven days; a login in the grace period cancels it and the hourly hard delete erases the account afterwards (ADR-0026).
- `edit_author`, `trace_owner`, `licence_accepted`, `edit_pending`, `not_own_proposal` and `totp_step_up` have the policy definitions above. Linked identities and reciprocal approvals require independent conflict review before publication.
- `pack-entitled-and-download-quota`: first downloaded city of the account or verified active Plus access, with the account and network quotas satisfied and the `X-Pack-Request: 1` header present. Verified Plus means an `active`, `cancelled` (paid period still running) or `grace` subscription row whose `expires_at` lies in the future, or an `active` row without expiry (non-renewing purchase); `expired` and `refunded` never entitle (ADR-0050).
- `first-city-and-download-quota`: anonymous first-city eligibility and download quota are verified by the server.
- `valid-unused-refresh-token`: an unexpired stored token hash matches and rotation consumes it atomically; reuse revokes its family.
- `valid-single-use-link`: a matching unexpired stored link hash is consumed atomically.
- `own-session`: logout affects only the caller's authenticated session or bearer family.
- `own-cookie-session`: CSRF bootstrap requires an authenticated cookie session and a permitted origin; it grants no resource access.
- Public auth entry points still require valid credentials or link proofs where applicable; allow means no role restriction.
- Reading one's edit list is scoped to stored authorship. Moderation queue access is restricted to moderator and admin.
- Approval, rejection and publication require a pending edit by a different author. Rollback and retirement require fresh step-up for moderator or admin. Retirement and publication have no separate section 5 route.
- User management and administrative export require admin with fresh step-up; moderators cannot manage users.

Webhook routes deny all human roles. Provider authentication is separate: RevenueCat requires its configured shared secret and a known subscriber; Resend requires a valid Svix signature and timestamp. Both require idempotent event identifiers.

No public response returns raw trace fields, points, bodies or private trace links, including versions, planner results, packs, tiles and GeoJSON exports. Private trace reads are limited to the owner or moderation roles. Administrative export does not override this privacy rule. All moderation and administrative actions record actor, action, target and diff hash.

Nested public response privacy is proven by `api/tests/privacy/test_public_responses.py`, which classifies every route and scans every public response for trace fields and raw trace coordinates. Moderation actions write audit rows with a diff hash (`test_approve_creates_immutable_version`, `test_reject_with_reason`). TOTP enrolment, confirmation, step-up (success and failure), TOTP disable, role changes and administrative exports also write audit rows (ADR-0037); the secret, the otpauth URI and submitted codes are never logged or audited. Provider authentication is implemented in phase 5: no human credential (anonymous, any role, bearer or cookie) reaches the webhook routes (`test_no_human_role_reaches_webhooks`), and the route table and the absence from the OpenAPI contract are asserted (`test_webhook_route_table_is_exact`, `test_webhook_routes_stay_out_of_the_public_contract`).
