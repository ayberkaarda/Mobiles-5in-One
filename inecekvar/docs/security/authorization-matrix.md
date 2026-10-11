# Authorization matrix draft

Roles are anonymous, user (signed in without contribution privileges), contributor, moderator and admin. Decisions are required API policy, with implementation status recorded separately. Unknown actions are denied. API services enforce roles and stored ownership; interface guards do not grant access.

Paths are relative to `/v1` and follow specification section 5. Active accounts are required for signed-in access. Cookie-mode mutations require a valid CSRF header. Input validation, quotas and audit controls apply to every allowed request.

| API resource and action | Anonymous | User | Contributor | Moderator | Admin | Implementation status |
| --- | --- | --- | --- | --- | --- | --- |
| POST auth/register; POST auth/login; POST auth/magic-link | allow | allow | allow | allow | allow | planned: phase 1 |
| POST auth/magic-link/verify | allow-if:valid-single-use-link | allow-if:valid-single-use-link | allow-if:valid-single-use-link | allow-if:valid-single-use-link | allow-if:valid-single-use-link | planned: phase 1 |
| POST auth/refresh | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | allow-if:valid-unused-refresh-token | planned: phase 1 |
| POST auth/logout | deny | allow-if:own-session | allow-if:own-session | allow-if:own-session | allow-if:own-session | planned: phase 1 |
| POST auth/csrf (web) | allow-if:cookie-mode | allow-if:cookie-mode | allow-if:cookie-mode | allow-if:cookie-mode | allow-if:cookie-mode | planned: phase 1 |
| GET me; PATCH me | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | planned: phase 1 |
| DELETE me | deny | allow-if:owner-and-reauthenticated | allow-if:owner-and-reauthenticated | allow-if:owner-and-reauthenticated | allow-if:owner-and-reauthenticated | planned: phase 2 |
| POST me/licence-accept | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | planned: phase 1 |
| GET cities; GET cities/{slug} | allow | allow | allow | allow | allow | planned: phase 2 |
| GET cities/{slug}/pack | allow-if:first-city-and-download-quota | allow-if:pack-entitled-and-download-quota | allow-if:pack-entitled-and-download-quota | allow-if:pack-entitled-and-download-quota | allow-if:pack-entitled-and-download-quota | planned: phase 5 |
| GET cities/{slug}/tiles.pmtiles | allow | allow | allow | allow | allow | planned: phase 2 |
| GET lines?city=&q=; GET lines/{slug}; GET lines/{slug}/versions | allow | allow | allow | allow | allow | planned: phase 2 |
| GET stops/{slug}; GET stops/near?lat=&lng=&radius= | allow | allow | allow | allow | allow | planned: phase 2 |
| POST plan | allow | allow | allow | allow | allow | planned: phase 2 |
| POST traces | deny | deny | allow-if:licence-accepted | allow-if:licence-accepted | allow-if:licence-accepted | planned: phase 2 |
| GET traces/{id} | deny | allow-if:owner | allow-if:owner | allow | allow | planned: phase 2 |
| DELETE traces/{id} | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | planned: phase 2 |
| POST edits; POST media/presign | deny | deny | allow-if:licence-accepted | allow-if:licence-accepted | allow-if:licence-accepted | planned: phase 2 |
| GET edits (mine) | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | planned: phase 2 |
| GET edits/{id} | deny | allow-if:owner | allow-if:owner | allow | allow | planned: phase 2 |
| GET me/favorites/{lineId}; PUT me/favorites/{lineId}; DELETE me/favorites/{lineId} | deny | allow-if:owner | allow-if:owner | allow-if:owner | allow-if:owner | planned: phase 2 |
| GET moderation/edits?state=pending | deny | deny | deny | allow | allow | planned: phase 2 |
| POST moderation/edits/{id}/approve; POST moderation/edits/{id}/reject | deny | deny | deny | allow-if:not-own-proposal | allow-if:not-own-proposal | planned: phase 2 |
| POST moderation/lines/{id}/rollback | deny | deny | deny | allow-if:totp-step-up | allow-if:totp-step-up | planned: phase 2 |
| POST webhooks/revenuecat; POST webhooks/resend | deny | deny | deny | deny | deny | planned: phase 5 |
| GET export/{city}/latest.geojson | allow | allow | allow | allow | allow | planned: phase 2 |
| GET admin/**; POST admin/** (user management and administrative export included) | deny | deny | deny | deny | allow-if:totp-step-up | planned: phase 4 |

Conditions:

- `owner`: authenticated identity matches the stored owner, never a client-supplied identity. Trace owners retain read and deletion access after a role change to user; those two user cells therefore require ownership as well.
- `licence-accepted`: contribution licence acceptance is recorded before submission.
- `not-own-proposal`: the reviewer differs from the stored author. Linked identities and reciprocal approvals require independent conflict review before publication.
- `totp-step-up`: successful TOTP verification within the previous 15 minutes. Moderator or admin is still required for rollback; admin is required for administrative routes. Retirement has the same destructive-moderation policy in section 6, but no dedicated route is listed in section 5.
- `pack-entitled-and-download-quota`: the city is the first downloaded city or the server verifies active Plus access, and the quota is satisfied in either case. Anonymous first-city checks use the anonymous download record. Pack delivery begins in phase 2; entitlement enforcement completes in phase 5.
- `valid-unused-refresh-token`: an unexpired stored token hash matches and rotation consumes the token atomically; reuse revokes its family.
- `valid-single-use-link`: a matching unexpired link hash is consumed atomically.
- `own-session`: logout affects only the caller's authenticated session.
- `cookie-mode`: issue a CSRF value for the web cookie context; this grants no resource access.

Webhook routes deny all human roles. Provider authentication is separate: RevenueCat requires its configured shared secret and a known subscriber; Resend requires a valid Svix signature and timestamp. Both require idempotent event identifiers.

No public response returns raw trace fields, points, bodies or private trace links, including versions, planner results, packs, tiles and GeoJSON exports. Private trace reads are limited to the owner or moderation roles. Administrative export does not override this privacy rule. All moderation and administrative actions record actor, action, target and diff hash.

Planned tests cover every role/action cell, substituted ownership, missing or expired step-up, provider authentication and nested public responses for private trace fields. Policy tests begin in phase 1, domain tests in phase 2, administrative tests in phase 4 and provider/entitlement tests in phase 5; phase 6 repeats the complete suite.
