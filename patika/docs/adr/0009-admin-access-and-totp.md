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
budget. The existing per-IP auth limiter also covers TOTP routes.

Use opaque 256-bit MFA and step-up tokens, storing SHA-256 digests in `admin_access_tokens`.
Both expire in five minutes and carry user, session id and session version bindings. MFA tokens
reserve a session family without issuing a refresh token; completion consumes the challenge and
creates the refresh token atomically. Step-up tokens are conditionally consumed inside the action
transaction, so a failed action rolls consumption back. Each successful sensitive action needs
a distinct token. The token's reason is retained in the step-up audit and in the action audit,
separate from the content moderation reason. An MFA sign-in issues `amr` with the first factor
(`pwd`, `fed` or `email`) plus `mfa`, so existing recent sign-in checks keep working for elevated
users. Refresh retains only `mfa` and the original authentication time, never a new time, so a
refreshed token keeps admin access but never passes a recent sign-in check.

`Admin.Moderate` requires Moderator/Admin plus `amr=mfa`; `Admin.Manage` requires Admin plus MFA.
Bearer authentication already reads the current user and role from the database on every request.
Demotion therefore takes effect on the next request without waiting for the session-version cache.
Role changes, suspensions and TOTP disable also increment the session version and revoke refresh
families. Elevated roles cannot disable TOTP. Promotion requires confirmed TOTP on the target.
The last-admin rule counts only active admins (not suspended, not deactivated).

Administrative writes serialize with a PostgreSQL transaction advisory lock, including last-admin
checks and CSV file-hash idempotency. Content changes, moderation decisions and audit entries commit
together. Audit entries have the same SaveChanges append-only guard as moderation decisions; there
is no admin update/delete endpoint. Existing account-deletion foreign keys may anonymize actor ids.

Report Approved maps Pending to Reviewed; Rejected maps Pending to Dismissed. Adoption/photo review
only accepts pending records. Urgent Hidden/Restored toggles visibility independently of its help
state. The urgent queue deliberately ignores the public hidden filter and includes the last 30 days.
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
Suspension without an `until` has no automatic end. Imports and role checks favor simple serialized
writes over maximum throughput. No authenticator package is added.
