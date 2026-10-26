# ADR-0009: Admin access and TOTP

- Status: Accepted
- Date: 2026-10-26

## Decision

Use RFC 6238 SHA-1 TOTP, six digits, 30-second steps with a one-step tolerance. Secrets contain
20 random bytes, use base32 in the Patika otpauth URI with a masked-email label, and are encrypted
with ASP.NET Data Protection purpose `Patika.Totp.v1`. The key ring lives in `DataProtection:KeysPath`,
which must be persistent storage shared by every API instance; Production refuses to start without
it, because losing the ring makes enrolled authenticators unusable.
Enrolment requires authentication within ten minutes and only replaces an unconfirmed secret.
Confirmation returns ten random recovery codes once, stored as purpose- and row-bound HMAC-SHA256
digests through the existing server-key hasher. Recovery codes only complete MFA login; case,
spaces and dashes are ignored when they are typed.

Serialize verification on the user row. Persist the greatest accepted TOTP step and reject older
or equal steps. Five failures within fifteen minutes lock all verification paths for fifteen
minutes, across contexts and API instances. Successful verification does not clear the failure
budget. Attempts during a lockout are audited as `totp.failure_locked` without counting; refused MFA
challenges (used, expired, stale session version, suspended or demoted user) are audited as
`totp.mfa_rejected`. TOTP routes (`/auth/mfa`, `/me/totp/*`, `/admin/step-up`) have their own per-user
budget of 20 verifications per 15 minutes, keyed by the bearer subject or, on `/auth/mfa`, by the user
the challenge belongs to, plus a loose ceiling of 100 per 15 minutes per client IP. They no longer
share the 5-per-15-minutes login bucket. The Patika.Web BFF calls the API server-side from one
address, so that ceiling is shared by every admin unless the API trusts the Web host as a proxy
(`Network:KnownProxies`) and Web forwards the browser address in `X-Forwarded-For`; without that,
the per-user budget and the persisted lockout are the effective controls.

Use opaque 256-bit MFA and step-up tokens, storing SHA-256 digests in `admin_access_tokens`.
Both expire in five minutes and carry user, session id and session version bindings. MFA tokens
reserve a session family without issuing a refresh token; completion consumes the challenge and
creates the refresh token atomically. Step-up tokens are conditionally consumed inside the action
transaction, so a failed action rolls consumption back. Each successful sensitive action needs
a distinct token. `POST /admin/step-up {code, reason, action, targetId}` binds the token to one action
(`RoleChange`, `Suspend`, `Unsuspend`, `CsvCommit`, `RestoreUrgent`) and one target (user id, urgent
post id or CSV preview hash); a token is refused for any other action or target. The token's
reason is retained in the step-up audit and in the action audit, separate from the content
moderation reason. An MFA sign-in issues `amr` with the first factor (`pwd`, `fed` or `email`)
plus `mfa`, so existing recent sign-in checks keep working for elevated users. Refresh retains only `mfa` and the original authentication time, never a new time, so a
refreshed token keeps admin access but never passes a recent sign-in check.

`Admin.Moderate` requires Moderator/Admin plus `amr=mfa`; `Admin.Manage` requires Admin plus MFA.
Bearer authentication already reads the current user and role from the database on every request.
Demotion therefore takes effect on the next request without waiting for the session-version cache.
Role changes, suspensions and TOTP disable also increment the session version and revoke refresh
families. Elevated roles cannot disable TOTP. Promotion requires confirmed TOTP on the target.
The last-admin rule counts only active admins (not suspended, not deactivated) and also refuses
account deletion by the last active admin (409 `last_admin_protected`), under the same advisory lock.
Authorization runs before that lock, so every admin write (decisions, role, suspend, unsuspend, CSV
commit, urgent restore) re-reads and locks the caller row inside its transaction and checks the
current role for the route policy, suspension, deactivation and session version against the token
before it consumes a step-up token or changes anything; otherwise it answers 403
`admin_access_revoked` and writes nothing. `POST /admin/users/{id}/unsuspend {reason}` (Admin.Manage
and step-up) ends a suspension and is audited as `user.unsuspend`; `suspend` refuses an `until` in the
past or earlier than a running suspension with 400, so shortening never lifts one silently.

Administrative writes serialize with a PostgreSQL transaction advisory lock, including last-admin
checks and CSV file-hash idempotency. Content changes, moderation decisions and audit entries commit
together. Audit entries have the same SaveChanges append-only guard as moderation decisions; there
is no admin update/delete endpoint. Existing account-deletion foreign keys may anonymize actor ids.

Decision transitions (anything else is 409 `transition_invalid`; Rejected and Hidden need a reason):

| Target | From | Decision | To |
| --- | --- | --- | --- |
| adoption | Pending | Approved / Rejected | Published / Rejected |
| adoption | Published | Rejected (takedown) | Rejected |
| photo | Pending | Approved / Rejected | Approved / Rejected |
| photo | Approved | Rejected (takedown) | Rejected |
| report | Pending | Approved / Rejected | Reviewed / Dismissed |
| urgent | visible | Hidden | hidden |
| urgent | hidden | Restored (step-up) | visible |

The takedown rows let a confirmed report remove live content; the audit records the previous state.
Rejected content never returns to Published through moderation. Urgent Hidden/Restored toggles
visibility independently of its help state. The urgent queue deliberately ignores the public hidden
filter and includes the last 30 days.
Queues and audit pages use descending `(created_at, id)` cursors with 25 items, fetching one lookahead.

The worker deletes raw `incoming/` objects after producing sanitized renditions. Pending photos
therefore use private, two-minute signed GETs of the processed full rendition only when the upload
ledger says Ready; absent/unprocessed photos yield null. They never use the public CDN resolver.

CSV preview accepts one UTF-8 multipart file up to 1 MiB and 2000 rows, reports errors per row and
writes nothing. Commit revalidates those exact bytes and requires `previewHash` plus `X-Step-Up`.
Files containing any error, including formula-like cells, are refused. A phone cell that matches
the phone syntax (digits, spaces, parentheses, dashes, optional leading `+`) is not a formula and is
stored as typed. Website is HTTPS-only, supplied districts must resolve through `IDistrictResolver`,
and commit stores the resolved district id. Exact file
hashes deduplicate commits. The old direct CSV import route is removed to prevent bypassing these gates.

## Consequences

Normal users retain the existing 200 sign-in flow. Elevated users without TOTP can sign in and enrol
but receive `mfa_required` from admin routes. Administrative and authentication responses are no-store.
Suspension without an `until` has no automatic end; it ends through unsuspend. Imports and role checks favor simple serialized
writes over maximum throughput. No authenticator package is added.

Account purge clears the TOTP secret, enrolment, step and lockout counters and the suspension, and
deletes the user's recovery codes and admin access tokens. The hourly maintenance job deletes admin
access tokens (MFA challenges and step-up tokens) that expired more than a day ago.

## Web BFF addendum (P4-D)

Patika.Web serves the Turkish console at `/admin` using Razor Pages and its own layout and CSS.
`Admin:ApiBaseUrl` is the API origin (for example `https://api.patika.app/`); the client adds `/v1`.
The Web read context is never used by the console. Every administrative read and write goes through
the API, including logout, which revokes the refresh token before clearing the local ticket.

The `PatikaAdmin` cookie contains a Data Protection encrypted authentication ticket with the access
and refresh tokens in authentication properties. It is HttpOnly, Secure, SameSite Strict, scoped to
`/admin`, and slides for 30 minutes. An original issued-at claim survives refresh and renewal;
cookie validation rejects it at eight hours using the injected TimeProvider. Access tokens within
one minute of expiry are refreshed server-side; failed refresh clears the session. Concurrent
requests share a refresh rotation through a one-minute in-process cache keyed by the previous
token's SHA-256 digest. Use sticky routing for this cache and pending logins in multi-instance
deployments, or replace both with shared coordination before removing stickiness. Persist and
share the Web host's Data Protection key ring across instances using the hosting platform's key
storage configuration. API and Web keys need not be shared with each other. If the API is unreachable
at logout, the BFF still clears its cookie; remote revocation cannot be confirmed in that case.

The password/MFA interstitial holds the API challenge only in a five-minute server memory entry;
the browser receives a random handle, never that API challenge. Restarting the Web process loses
pending logins; multi-instance hosts need sticky routing for this short flow. Elevated users without
TOTP are refused and directed to enrol in the mobile app. No QR dependency is added.

CSV commit requires re-uploading the original file. The BFF previews those bytes again, checks the
submitted preview hash, obtains step-up for `CsvCommit` and that hash, and sends the same file to
commit. It stores no uploaded file on disk or in a cookie. The API revalidates and deduplicates it.
Role, suspend, unsuspend and urgent restore similarly obtain an action/target-bound step-up and
perform the action within the same browser POST; no step-up token appears in HTML. Native forms
and expandable verification panels work without JavaScript. The API's 2000-row limit takes
precedence over the older 1000-row artboard copy.

All POST forms use antiforgery. The entire `/admin` path, including redirects, failures and unknown
routes, is no-store, noindex/nofollow and frame-denied with a restrictive self-only CSP. Output-cache
base policy excludes the path. Existing robots rules disallow it and the sitemap has no admin pages.
Razor encodes all API content. Private photo URLs open in a separate, noreferrer HTTPS link rather
than expanding the console CSP to arbitrary image origins. Pending-only adoption/photo queues do
not expose published records; the takedown form accepts the reported content id explicitly.

The BFF does not forward browser-controlled proxy headers. The API's per-IP TOTP ceiling of 100
per 15 minutes is consequently shared by this Web host; the API also enforces its per-user
20-per-15-minute budget and persisted lockout. The same applies to the per-IP `auth` bucket
(5 sign-in requests per 15 minutes): every console sign-in uses two of them, so all moderators and
admins together get about two sign-ins per 15 minutes until the Web host is a trusted proxy that
forwards the client address. Proxy trust and forwarding can be configured in a later deployment
change once the proxy chain is known.

The console shows the last 12 hex digits of ids (full id in the title attribute), because
time-ordered ids created close together share their leading digits.

## Known limits

Accepted for now; phase 6 hardening revisits them.

- The append-only audit guard is EF SaveChanges-level only. `ExecuteUpdate`/`ExecuteDelete` or raw SQL
  on `audit_logs` would bypass it; no code path does today. DB-level enforcement (trigger or a
  restricted runtime role) is phase 6 hardening.
- One advisory lock serializes every admin write, so a large CSV commit delays moderation decisions.
- Role changes, suspensions, unsuspensions and CSV commits also write `ModerationDecision` rows
  (target types `user` and `care_place_import`); queries over decisions must filter by target type.
- Queue author ids are opaque, so an admin cannot go from a queue item to the author's account.
- No email is sent on TOTP enrolment/disable, role change or suspension, and there is no admin
  "reset TOTP" action; a privileged user who loses the authenticator and the recovery codes needs
  demotion, re-enrolment and re-promotion. The last admin has only direct database access.
- `/auth/mfa` and `/me/totp/*` are not attached to the `Permission.AuthSession` matrix entry; that
  permission is allowed for every role, so behaviour is the same.
- A correct password for an enrolled Moderator/Admin returns 202 instead of 200, which tells the
  password holder the account is elevated.
