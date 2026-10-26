# Authorization matrix (draft)

This draft maps the roles and endpoint families in the product specification. Every decision is enforced by the server, including ownership and resource state. Anonymous browsing is limited to public records. `Trusted` users are volunteers with at least 25 verified feedings. Moderator and admin routes require TOTP step-up.

Legend: **Allow** = generally permitted; **Own** = only the caller's resource or relationship; **Public** = published/public records only; **Moderate** = moderation permissions; **Admin** = administrator only; **—** = not permitted. Resource-specific authorization and validation still apply.

| Endpoint/action | Guest | User | Trusted | Moderator | Admin |
| --- | --- | --- | --- | --- | --- |
| `POST auth/register`, `login`, `apple`, `refresh`, `logout`, `verify-email`, `forgot`, `reset` | Allow | Allow | Allow | Allow | Allow |
| `POST /v1/auth/verify-email/resend` | Allow | Allow | Allow | Allow | Allow |
| `GET me`, `PATCH me`, `DELETE me`, `PUT me/device-token`, `PUT me/urgent-settings` | — | Own | Own | Own | Own |
| `GET /v1/me/follows` | â€” | Own | Own | Own | Own |
| `GET /v1/me/adoption-requests` | â€” | Own | Own | Own | Own |
| `GET /v1/me/urgent-posts` | â€” | Own | Own | Own | Own |
| `GET stations` | Public | Public | Public | Public | Public |
| `POST stations` | — | Allow | Allow | Allow | Allow |
| `GET stations/{id}` | Public | Public | Public | Public | Public |
| `PATCH stations/{id}` | — | Own | Own or any station | Moderate | Admin |
| `POST stations/{id}/feedings`, `needs-refill` | — | Allow | Allow | Allow | Allow |
| `GET animals` | Public | Public | Public | Public | Public |
| `POST animals`, `POST animals/{id}/photos`, `sightings` | — | Allow | Allow | Allow | Allow |
| `GET animals/{id}` | Public | Public | Public | Public | Public |
| `PATCH animals/{id}` | — | Own | Own | Moderate | Admin |
| `PUT|DELETE animals/{id}/follow` | — | Own | Own | Own | Own |
| `GET adoptions` and `GET adoptions/{id}` | Public | Public | Public | Public | Public |
| `POST animals/{id}/adoption` | — | Own animal | Own animal | Moderate | Admin |
| `PATCH adoptions/{id}` (owner close) | — | Own | Own | Moderate | Admin |
| `POST adoptions/{id}/requests` | — | Allow | Allow | Allow | Allow |
| `GET adoptions/{id}/requests` | — | Owner | Owner | Moderate | Admin |
| `PATCH adoptions/{id}/requests/{rid}` | — | Post owner/request owner, permitted fields only | Post owner/request owner, permitted fields only | Moderate | Admin |
| `GET urgent` | Public | Public | Public | Public | Public |
| `POST urgent` | — | Allow | Allow | Allow | Allow |
| `PATCH urgent/{id}` | — | Own, permitted state change | Own, permitted state change | Moderate | Admin |
| `GET care-places` | Public | Public | Public | Public | Public |
| `POST uploads/presign` | — | Allow, quota and ownership checks | Allow, quota and ownership checks | Allow, moderation flow | Allow |
| `POST reports` | — | Allow | Allow | Allow | Allow |
| `POST subscriptions/verify` | — | Own | Own | — | Admin review only |
| `POST webhooks/appstore` | Service signature | Service signature | Service signature | Service signature | Service signature |
| `GET|POST|PATCH admin/**` | — | — | — | Moderate | Admin |

Additional constraints: moderators can review adoption, urgent, photo, and report queues and verify care places; moderators cannot manage user roles, delete users, or read user email addresses. Only admins manage roles, perform care-place imports, and take administrative user actions. A user may only edit owned resources except that `Trusted` users may edit any station under the trusted-station policy. Webhook authorization uses signature and environment validation rather than an interactive role.

## Admin API (P4-D)

### Admin console (Web BFF)

| Web page / action | Guest / User / Trusted | Moderator with MFA | Admin with MFA |
| --- | --- | --- | --- |
| `/admin/giris` | Login form; no console session for User/Trusted | Password then TOTP | Password then TOTP |
| `/admin` queue, decisions, published-content takedown | Deny | Allow | Allow |
| Urgent restore | Deny | Bound step-up | Bound step-up |
| `/admin/csv` preview / commit | Deny | 403 | Allow / bound step-up |
| `/admin/kullanicilar` search | Deny | 403 | Allow; masked email |
| Role, suspend, unsuspend | Deny | 403 | Bound step-up |
| `/admin/denetim` | Deny | 403 | Allow |
| `/admin/cikis` | Login redirect | POST with antiforgery | POST with antiforgery |

Unenrolled Moderator/Admin accounts receive enrolment instructions instead of a console cookie.
Manage navigation is hidden from moderators and server policy still returns 403 for direct URLs.
All writes use antiforgery and the API's current authorization checks; no Web database writes occur.

All paths below start with `/v1`. Anonymous callers get 401; User and Trusted get 403.
Moderator/Admin without MFA get 403 `mfa_required`. The bearer handler reads the current DB role
on every request, making demotion immediate. Every write also re-reads the caller under the admin
advisory lock (role, suspension, deactivation, session version) and answers 403
`admin_access_revoked` if any changed after authorization. All responses use `Cache-Control: no-store`.

| Endpoint | Moderator with MFA | Admin with MFA | Extra requirement |
| --- | --- | --- | --- |
| `GET /admin/queue` | Allow | Allow | type adoption/urgent/photo/report; 25-item keyset page |
| `POST /admin/decisions` | Allow | Allow | Valid transition (incl. takedown Published/Approved to Rejected); reason for Rejected/Hidden; step-up for urgent Restored |
| `POST /admin/step-up` | Allow | Allow | Fresh TOTP, reason 10..300, action and target id; per-user TOTP budget |
| `GET /admin/users` | Deny | Allow | Exact email or id prefix; masked email only |
| `POST /admin/users/{id}/role` | Deny | Allow | Single-use step-up; no own-role change; keep last active Admin; promotion requires target TOTP |
| `POST /admin/users/{id}/suspend` | Deny | Allow | Single-use step-up and reason; suspended accounts cannot sign in/refresh; cannot shorten a running suspension |
| `POST /admin/users/{id}/unsuspend` | Deny | Allow | Single-use step-up and reason; 409 if not suspended |
| `GET /admin/audit` | Deny | Allow | Append-only; 25-item keyset page |
| `POST /admin/care-places/csv/preview` | Deny | Allow | Multipart, 1 MiB, 2000 rows; no writes |
| `POST /admin/care-places/csv/commit` | Deny | Allow | Exact preview hash and single-use step-up |

`POST /me/totp/enrol`, `/confirm`, `/disable` require authentication; enrol requires sign-in
within ten minutes. Moderator/Admin cannot disable TOTP. `/auth/mfa` consumes a five-minute
single-use challenge after TOTP or a single-use recovery code. All verification paths share
the persisted per-user five-failure lockout and the existing per-IP auth policy.

## Play subscriptions

| Route | Anonymous | Signed-in user | Boundary |
| --- | --- | --- | --- |
| POST /v1/subscriptions/verify | Deny | Own token only | Rate limited; server queries Play; foreign or purged owner returns 409 |
| GET /v1/me/entitlement | Deny | Own account only | No caller-selected user id |
| POST /webhooks/play | OIDC required | OIDC required | Google RS256/JWKS, issuer/audience/email/email_verified/exp/iat; 64 KiB; unique message id |
| POST /dev/billing/purchases | Deny | Allow only Development+Fake | Absent otherwise; rate limited; test purchase only |

Worker re-queries the provider; notification types never decide entitlement. Canceled keeps
access until expiry. Purged subscriptions retain hashes with user_id=null and cannot be reclaimed.
