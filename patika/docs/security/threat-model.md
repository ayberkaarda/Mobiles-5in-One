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
- Oversized or misleading media upload and resource exhaustion through map queries.

## Required verification

Cover authorization and IDOR cells, rate-limit proxy-header spoofing, JWT tampering, refresh reuse, oversized bodies, MIME spoofing, EXIF removal, webhook forgery/replay, admin CSRF, and admin access without TOTP in the security test suite. Run web and API security scans and record findings, fixes, and retest evidence in the security verification matrix and penetration-test report. Revisit this outline when endpoints, data classes, integrations, or trust boundaries change.
