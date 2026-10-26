# Threat model (outline)

## Scope and assets

The system includes the .NET MAUI mobile client, Minimal API, Razor Pages site and admin area, PostgreSQL/PostGIS, media storage, worker jobs, email and push providers, and app-store transaction callbacks. Protected assets include account credentials and tokens, volunteer-created content, station and animal locations, private adoption requests, device tokens, media, subscription entitlements, moderation controls, and backups.

## Trust boundaries

- Mobile and browser clients to public API and web endpoints.
- Public endpoints to authenticated and resource-authorized operations.
- Public web traffic to the separately protected admin area.
- API and worker to PostgreSQL, Redis when enabled, MinIO/R2, Resend, FCM, and future APNs.
- App-store callback traffic to webhook validation and entitlement processing.
- Production services to backup storage and operational logs.

## STRIDE outline

| Category | Threat examples | Main controls and evidence |
| --- | --- | --- |
| Spoofing | Stolen credentials or refresh tokens; forged subscription callback; fake feeding or urgent post; takeover by linking a recycled or third-party Google address | Argon2id password hashing, verified identity tokens, rotated refresh tokens, signed webhook validation, rate limits, account/device controls, moderation and abuse reports; no automatic Google linking, matching-email sign-in returns 409 `link_required`, and linking requires password sign-in within 10 minutes (`amr=pwd`, `auth_time`); forwarded `X-Forwarded-For` is ignored without a configured trusted proxy, one hop is honoured, and IPv6 addresses are keyed per /64 |
| Tampering | Modified request identifiers or ownership fields; altered media; replayed notification | Server-side resource authorization, request validation, media re-encoding and magic-byte checks, webhook signature verification and idempotency keys |
| Repudiation | User disputes a moderation action, role change, or deletion | Audited administrative actions, request identifiers, privacy-masked logs, deletion state and confirmation records without retaining unnecessary PII |
| Information disclosure | Volunteer location leaks through image metadata, logs, API responses, or adoption requests; IDOR exposing private requests; account enumeration | Strip photo EXIF/GPS, never persist volunteer positions, round logged coordinates, minimize response DTOs, enforce ownership checks, test IDOR paths, restrict moderator access to email; registration returns the same 202 for every address and pays password-hash cost on both paths, login returns one generic 401 for unknown, unverified, or wrong-password accounts, with per-email and per-IP limits; residual timing differences from database insert and email send |
| Denial of service | Login floods, oversized uploads, broad spatial queries, urgent-post fan-out abuse; forwarded-header spoofing to bypass rate limits | Per-IP and per-account limits, body and upload caps, bounded bbox/radius, pagination, per-user urgent caps and 500-device fan-out cap, worker backpressure and cost guard; `X-Forwarded-For` is ignored unless a trusted proxy is configured, one hop is honoured, and IPv6 addresses are keyed per /64 |
| Elevation of privilege | Moderator gains admin functions; missing TOTP step-up; insecure direct object reference; takeover by linking a recycled or third-party Google address | Central role and resource policies, admin-only actions, TOTP for admin area and destructive step-up, audit logging, role-matrix and IDOR security tests; no automatic Google linking, matching-email sign-in returns 409 `link_required`, and linking requires password sign-in within 10 minutes (`amr=pwd`, `auth_time`); a pre-registered victim address cannot be recovered until a password reset flow exists |

## Abuse and attack scenarios

- Fake feeding/check-in spam or coordinated station manipulation.
- Volunteer location disclosure through photo metadata or overly precise logs.
- IDOR against another user's adoption post, request, station, or animal.
- Adoption scams, abusive content, and malicious reports.
- Subscription forgery, webhook replay, or sandbox/production confusion.
- Refresh-token theft and reuse, including on a compromised mobile device.
- Moderation privilege escalation or unauthorized care-place changes.
- MFA replay and parallel guesses: user-row locking, monotonic accepted steps, persisted five-failure
  lockout across all TOTP paths, and single-use recovery-code hashes. MFA and step-up challenge hashes
  expire in five minutes and bind to the user and session; a step-up token also binds to one action and
  one target id, and action transactions consume it once. TOTP routes have a per-user budget (20 per
  15 minutes) apart from the per-IP login bucket, so admins behind the Web BFF do not share one bucket.
- Stolen privileged password: enrolled Moderator/Admin sign-in returns only a challenge; admin policies
  require MFA. Unenrolled elevated users can only enrol. Current DB role is checked on every bearer
  request; role changes/suspensions revoke refresh families and increment session versions. Each admin
  write re-reads the caller under the admin advisory lock, so a request admitted before a demotion,
  suspension or sign-out cannot write afterwards. The last active admin cannot be demoted, suspended
  or self-deleted.
- Credential-stuffing role disclosure: a correct password for an enrolled Moderator/Admin returns 202
  instead of 200, which reveals elevation to whoever holds the password. Accepted; the second factor
  still stands.
- Administrative repudiation and CSV tampering: entity change, moderation decision and audit commit
  atomically; SaveChanges refuses audit modifications/deletions. Step-up reasons are preserved in audit.
  CSV commit revalidates the byte hash, rejects erroneous/formula cells, and deduplicates exact files.
- Queue disclosure: keyed opaque author ids, account age/rejection count only, no moderator emails;
  admin email search is exact and results are masked. Pending-photo links expire after two minutes
  and require processed media. Hidden urgent rows are visible only in explicit management queries.
- Oversized or misleading media upload and resource exhaustion through map queries.

## Admin console

The Web console is a BFF: API access/refresh tokens stay inside an encrypted Data Protection
authentication ticket (`PatikaAdmin`, HttpOnly, Secure, SameSite Strict, `/admin`). Thirty-minute
sliding sessions have an independently checked eight-hour absolute lifetime; refresh failures and
`admin_access_revoked` end the local session. Deployments must persist the Web key ring. Pending
MFA challenges live in server memory for five minutes behind random browser handles.

Web policies require Moderator/Admin and MFA; users, audit and CSV additionally require Admin.
The API remains authoritative for current role, session version and every write. All POSTs require
antiforgery. Sensitive forms send TOTP and a reason to the BFF, which obtains action/target-bound
step-up and uses it only server-side in the same request. Re-uploaded CSV bytes must match the
preview hash and are revalidated by the API; no temporary uploads are retained.

All admin responses are no-store, noindex/nofollow and frame-denied; output caching excludes the
path. A self-only CSP and Razor encoding prevent stored content from becoming executable markup.
No API data uses raw HTML. Private photos are HTTPS links with noreferrer. Existing robots rules
exclude `/admin`; admin pages are never sitemap entries. BFF-originated TOTP traffic shares the
API's per-IP ceiling unless a separately reviewed trusted proxy configuration forwards client IPs.

## Required verification

Cover authorization and IDOR cells, rate-limit proxy-header spoofing, JWT tampering, refresh reuse, oversized bodies, MIME spoofing, EXIF removal, webhook forgery/replay, admin CSRF, and admin access without TOTP in the security test suite. Run web and API security scans and record findings, fixes, and retest evidence in the security verification matrix and penetration-test report. Revisit this outline when endpoints, data classes, integrations, or trust boundaries change.
