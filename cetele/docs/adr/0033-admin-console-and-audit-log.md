# ADR-0033: Admin console and audit log

- Status: Accepted
- Date: 2026-10-11
- Deciders: Ayberk (owner)
- Settles D-9 and D-10 of the [authorization matrix](../security/authorization-matrix.md).

## Context

Spec item 18 asks for a console for platform staff that is separate from shop users, requires a
role and TOTP, is read-only for support, records every action, and never shows ledger notes or
photos. Spec item 12 fixes the cookie (`__Host-CETELE_ADMIN`, HttpOnly, Secure, SameSite=Strict,
Path=/), Spring CSRF and a 30-minute idle timeout; item 11 fixes the password hash
(`Argon2PasswordEncoder(16, 32, 1, 65536, 3)`). The authorization matrix section 5 already lists
the capabilities with two open questions. The console is HTML (Thymeleaf) on the same origin as the
API and must fit the strict CSP of [ADR-0010](0010-security-headers-csp-and-https.md).

## Decision

### Identity and storage (`V8__admin.sql`)

```sql
CREATE TABLE admin_users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    totp_secret_enc BYTEA,
    totp_enrolled_at TIMESTAMPTZ,
    totp_last_step BIGINT,
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    created_by UUID REFERENCES admin_users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at TIMESTAMPTZ,
    CONSTRAINT admin_users_role_check CHECK (role IN ('ADMIN', 'SUPPORT')),
    CONSTRAINT admin_users_email_format CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
    CONSTRAINT admin_users_password_hash_argon2 CHECK (password_hash LIKE '$argon2id$%'),
    CONSTRAINT admin_users_totp_pair CHECK ((totp_enrolled_at IS NULL) OR (totp_secret_enc IS NOT NULL)),
    CONSTRAINT admin_users_failed_attempts_nonnegative CHECK (failed_attempts >= 0)
);
CREATE UNIQUE INDEX admin_users_email_key ON admin_users (email);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_type TEXT NOT NULL,
    actor_id UUID,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    ip_hash TEXT,
    trace_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('ADMIN', 'SYSTEM')),
    CONSTRAINT audit_logs_admin_has_actor CHECK (actor_type <> 'ADMIN' OR actor_id IS NOT NULL OR action = 'ADMIN_LOGIN_FAILED'),
    CONSTRAINT audit_logs_action_format CHECK (action ~ '^[A-Z][A-Z_]{2,63}$'),
    CONSTRAINT audit_logs_target_type_check CHECK (target_type IS NULL OR target_type IN ('ADMIN_USER', 'USER', 'SHOP', 'DEVICE')),
    CONSTRAINT audit_logs_target_pair CHECK ((target_type IS NULL) = (target_id IS NULL)),
    CONSTRAINT audit_logs_ip_hash_format CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT audit_logs_metadata_object CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 2048)
);
CREATE INDEX audit_logs_at_idx ON audit_logs (at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, at DESC);
```

- `admin_users` has no link to `users`; an admin identity never passes `/v1` and a `/v1` token
  never opens `/admin/**`. A device id of `DEVICE` targets is the `devices.id` row id.
- `audit_logs` has no foreign key, so a row outlives what it names. It is append-only in code: the
  admin package has no update or delete path except the retention job (rows older than 365 days,
  daily). Anonymising rows of a deleted user or shop belongs to the deletion executor (handoff 002,
  wiring step).
- `ip_hash` is `lowercase_hex(HMAC-SHA256(CETELE_AUDIT_IP_KEY, ip))`; an empty key is the stand-in
  `ephemeral-audit-ip-key` (random per start), local and test only.
- `metadata` holds only the keys listed below. Never a phone, an email, a name, a note, a token, a
  password, a TOTP code or a search term.

### Passwords

`Argon2PasswordEncoder(16, 32, 1, 65536, 3)` (Bouncy Castle provider, added to the server build by
the admin work). Length 12 to 128 characters, no other composition rule. An unknown email is
checked against a fixed dummy hash so both paths cost the same. A new admin gets a one-time
password from the creating `ADMIN` (shown once, out of band) with `must_change_password = true`.

### TOTP

- RFC 6238 through `dev.samstevens.totp`: SHA-1, 6 digits, 30-second step, one step of drift either
  way. The secret is 160 random bits, stored as `totp_secret_enc` with AES-256-GCM (layout
  `0x01 || nonce(12) || ciphertext || tag(16)`, additional data `UTF-8("cetele.admin.totp.v1")`), key
  `CETELE_ADMIN_TOTP_KEY` (standard Base64 of 32 bytes; empty is the stand-in
  `ephemeral-admin-totp-key`, local and test only).
- A code is accepted once: its time step must be greater than `totp_last_step`, which is updated
  in the same transaction.
- Enrollment is forced at the first login and after a reset: the page shows the `otpauth://` URI as
  a QR code (`data:image/png` from the library's ZXing generator, allowed by `img-src data:`) and as
  text, and the secret is stored only when a code from it verifies.
- A TOTP reset also sets a new one-time password, shown once to the resetting `ADMIN` on a
  `no-store` result page, and `must_change_password`, so the old password no longer opens the
  account; the next login goes through enrollment and then the forced password change. The audit
  row `ADMIN_TOTP_RESET` keeps no metadata.

### Login and session

1. `GET /admin/login`, `POST /admin/login` (`email`, `password`). Bucket
   `ADMIN_LOGIN_IP("admin.login.ip", 20, 10 minutes)`. Five consecutive failures (password or TOTP)
   set `locked_until = now + 15 minutes`; a locked or disabled account fails like a wrong password.
   Every failure shows the same Turkish message and is audited.
2. After the password the session id changes and the session holds a pre-authentication marker
   with no role. `GET` and `POST /admin/login/totp` (or `/admin/totp/enroll` when not enrolled) complete
   it; then a forced password change at `/admin/account/password` when `must_change_password`.
3. Only then the session id changes again and the role `ADMIN` or `SUPPORT` is granted.

- Cookie: the servlet session cookie is named `__Host-CETELE_ADMIN`, `HttpOnly`, `Secure` (always,
  also locally), `SameSite=Strict`, `Path=/`, no `Domain`; tracking by cookie only, never URL
  rewriting. The API chain stays stateless, so this is the only session in the server.
- Idle timeout 30 minutes (`maxInactiveInterval`), absolute lifetime 12 hours (checked against the
  session creation time on every request). `POST /admin/logout` invalidates the session.
- CSRF: Spring's session-backed token on every `POST`, sent as the hidden `_csrf` field that
  Thymeleaf adds to `th:action` forms. No state change on `GET`.
- Sessions live in the server's memory; a restart signs every admin out. Accepted for one instance
  ([ADR-0002](0002-hosting.md)).
- A console session is current only while the account is enabled, not locked, keeps its role, is
  enrolled, and neither the password nor the authenticator changed after the session signed in
  (`AdminPrincipal.authenticatedAt`): a reset or a password change ends every other session, and
  the session that changed its own password gets a new session id. A half-finished login carries
  its start time and is refused when the password changed after it. Wrong current passwords on
  the password change form count toward the five-failure lockout and end the session at the lock.
- First admin: when no enabled `ADMIN` exists and `CETELE_ADMIN_BOOTSTRAP_EMAIL` and
  `CETELE_ADMIN_BOOTSTRAP_PASSWORD` are both set, startup creates that `ADMIN` with
  `must_change_password = true` and no TOTP (audited as `ADMIN_BOOTSTRAPPED`, actor `SYSTEM`). The
  operator removes both variables afterwards. Otherwise the variables are ignored. Bootstrap
  recovers an existing row only when its role is `ADMIN`; a `SUPPORT` row with the bootstrap email
  is left unchanged and logged as an error, and startup continues.

### Security chain and pages

`AdminSecurityConfig` in `app.cetele.server.admin` declares `@Order(10)` with `securityMatcher` on
`/admin/**`: session based, form login handled by the console's own controllers, CSRF on, the
header baseline (`SecurityHeadersConfig.apply`, `CspNonceFilter`), the HTTPS rule, plus
`Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow` on every console response. An
unauthenticated request is redirected (302) to `/admin/login`; a role that lacks an action gets the
403 console page. Templates are under `templates/admin/` with `th:text` only, no inline script or
style without the nonce; CSS is `static/assets/admin/admin.css`. Copy is Turkish.

| Route                                                   | ADMIN | SUPPORT | Audited action                              |
| ------------------------------------------------------- | ----- | ------- | ------------------------------------------- |
| `GET /admin` (counts of shops, users, PRO shops)        | Y     | Y       | none (aggregate only)                       |
| `GET /admin/shops?q=` (name contains, at most 50 rows)  | Y     | Y       | `SHOP_SEARCHED`                             |
| `GET /admin/shops/{id}`                                 | Y     | Y       | `SHOP_VIEWED`                               |
| `GET /admin/users?phone=` (exact E.164 match)           | Y     | Y       | `USER_SEARCHED`                             |
| `GET /admin/users/{id}`                                 | Y     | Y       | `USER_VIEWED`                               |
| `POST /admin/users/{id}/deactivate`                     | Y     | -       | `USER_DEACTIVATED`                          |
| `POST /admin/users/{id}/reactivate`                     | Y     | -       | `USER_REACTIVATED`                          |
| `POST /admin/users/{id}/devices/{deviceRowId}/revoke`   | Y     | -       | `DEVICE_REVOKED`                            |
| `GET /admin/audit?page=`                                | Y     | -       | `AUDIT_LOG_VIEWED`                          |
| `GET /admin/admins`; `GET` and `POST /admin/admins/new` | Y     | -       | `ADMIN_USER_CREATED` on post                |
| `POST /admin/admins/{id}/role`                          | Y     | -       | `ADMIN_USER_ROLE_CHANGED`                   |
| `POST /admin/admins/{id}/disable`, `.../enable`         | Y     | -       | `ADMIN_USER_DISABLED`, `ADMIN_USER_ENABLED` |
| `POST /admin/admins/{id}/totp-reset`                    | Y     | -       | `ADMIN_TOTP_RESET`                          |
| `GET` and `POST /admin/account/password`                | Y     | Y       | `ADMIN_PASSWORD_CHANGED`                    |

An `ADMIN` cannot disable, demote or reset themselves, and the last enabled `ADMIN` cannot be
disabled or demoted (409 console message). `AdminManagementTest`:
`self disable demotion and reset return 409 without changing credentials`,
`last enabled admin cannot be disabled or demoted and conflicts map to 409`.

### What the console shows and never shows

- Shop page: name, type, il, ilçe, plan, created and deleted dates, open deletion request, member
  count and roles, counts of live customers, entries and `READY` photos, this month's SMS quota use.
- User page: masked phone (`+90*******12`, [ADR-0011](0011-structured-logging-and-masking.md)),
  display name, dates, deactivation, memberships (shop name and role), devices (model, app version,
  last seen, integrity time, live refresh sessions).
- **Never**, for either role: ledger notes, ledger amounts per entry, photos or photo keys,
  customer names, customer phones, customer notes or tags, statement link tokens, reminder texts,
  purchase tokens, OTP codes, refresh tokens, other admins' TOTP secrets. Counts and metadata only.
- Enforcement: the admin package reads through its own JPQL count and projection queries that
  select only the allowed columns; an ArchUnit test inside the admin tests forbids `..admin..` from
  depending on `MediaStore`, `LedgerEntryRepository`, `CustomerRepository`, `StatementLinkService`
  and the reminder template classes; a rendering test seeds a customer named
  `[ÖRNEK] Gizli Müşteri` with the note `GIZLI-NOT` and a photo, and asserts that no console page
  contains either string or the photo key.

### Audited actions

Every row has `at`, `actor_type`, `actor_id`, `ip_hash`, `trace_id`. The complete list for this
phase:

| Action                    | Actor  | Target     | `metadata` keys                                                                               |
| ------------------------- | ------ | ---------- | --------------------------------------------------------------------------------------------- |
| `ADMIN_BOOTSTRAPPED`      | SYSTEM | ADMIN_USER | `role`                                                                                        |
| `ADMIN_LOGIN_SUCCEEDED`   | ADMIN  | none       | none                                                                                          |
| `ADMIN_LOGIN_FAILED`      | ADMIN  | none       | `stage` (`PASSWORD`, `TOTP`, `LOCKED`); `actor_id` set only when the email matched an account |
| `ADMIN_LOCKED_OUT`        | ADMIN  | ADMIN_USER | `until`                                                                                       |
| `ADMIN_LOGGED_OUT`        | ADMIN  | none       | none                                                                                          |
| `ADMIN_TOTP_ENROLLED`     | ADMIN  | ADMIN_USER | none                                                                                          |
| `ADMIN_TOTP_RESET`        | ADMIN  | ADMIN_USER | none                                                                                          |
| `ADMIN_PASSWORD_CHANGED`  | ADMIN  | ADMIN_USER | `forced` (boolean)                                                                            |
| `ADMIN_USER_CREATED`      | ADMIN  | ADMIN_USER | `role`                                                                                        |
| `ADMIN_USER_ROLE_CHANGED` | ADMIN  | ADMIN_USER | `from`, `to`                                                                                  |
| `ADMIN_USER_DISABLED`     | ADMIN  | ADMIN_USER | none                                                                                          |
| `ADMIN_USER_ENABLED`      | ADMIN  | ADMIN_USER | none                                                                                          |
| `SHOP_SEARCHED`           | ADMIN  | none       | `results`                                                                                     |
| `SHOP_VIEWED`             | ADMIN  | SHOP       | none                                                                                          |
| `USER_SEARCHED`           | ADMIN  | none       | `results`                                                                                     |
| `USER_VIEWED`             | ADMIN  | USER       | none                                                                                          |
| `USER_DEACTIVATED`        | ADMIN  | USER       | `revokedSessions`                                                                             |
| `USER_REACTIVATED`        | ADMIN  | USER       | none                                                                                          |
| `DEVICE_REVOKED`          | ADMIN  | DEVICE     | `revokedSessions`                                                                             |
| `AUDIT_LOG_VIEWED`        | ADMIN  | none       | `page`                                                                                        |

Reserved for the wiring step (actor `SYSTEM`, no target, no PII): `ACCOUNT_DELETION_COMPLETED` and
`SHOP_DELETION_COMPLETED` with `metadata.shops` (count), which close the audit gap noted in
[ADR-0018](0018-account-and-shop-deletion.md). Idle session expiry is not audited (no request
observes it). The audit row is written in the same transaction as the action it records; a failed
write fails the action.

### User actions and D-9, D-10

- Deactivate sets `users.deactivated_at` and revokes every refresh token of the user through the
  auth module's service; the access token stops at the next request, because the API chain checks
  `deactivated_at` on every request. Reactivate clears it; the user signs in again with OTP.
- Device revoke revokes the refresh tokens of that `(user_id, device_id)`.
- **D-9: settled, `SUPPORT` cannot read `audit_logs`.** The log reveals which admin looked at
  whom; that is for `ADMIN` only.
- **D-10: settled as drafted.** When the only `OWNER` of a shop is deactivated, the shop stays as
  it is: staff keep reading and writing, nobody can manage members or billing until the owner is
  reactivated or deletes the account. The console shows the condition on the shop page.

### Configuration

| Key                               | Property                          | Default                  |
| --------------------------------- | --------------------------------- | ------------------------ |
| `CETELE_ADMIN_TOTP_KEY`           | `cetele.admin.totp-key`           | empty (stand-in locally) |
| `CETELE_ADMIN_BOOTSTRAP_EMAIL`    | `cetele.admin.bootstrap-email`    | empty                    |
| `CETELE_ADMIN_BOOTSTRAP_PASSWORD` | `cetele.admin.bootstrap-password` | empty                    |
| `CETELE_AUDIT_IP_KEY`             | `cetele.audit.ip-key`             | empty (stand-in locally) |

Fixed, not configurable: idle 30 minutes, absolute 12 hours, lockout 5 failures for 15 minutes,
audit retention 365 days.

## Consequences

- The console is a narrow support tool. It cannot change ledgers, plans or subscriptions; a
  subscription view is added only after billing exists in the same tree (handoff 002, wiring step).
- Losing the TOTP device needs another `ADMIN`. The last `ADMIN` who loses it is recovered by the
  operator: disable the row in the database and use the bootstrap variables again, which is audited.
- Deactivating a user does not hold that user's pending account deletion
  ([ADR-0018](0018-account-and-shop-deletion.md)); the audit rows of a deleted user stay without
  personal data. A supervised, time-limited hold for fraud review is required before commercial use.
- Required tests: `AdminLoginTest` (`password then totp grants the role`, `totp code is single use`,
  `five failures lock for fifteen minutes`, `unknown email and wrong password look the same`,
  `forced enrollment and password change come before any page`), `AdminSessionTest` (cookie name
  and attributes, `idle thirty minutes ends the session`, `absolute twelve hours`,
  `session id changes at each step`, `post without csrf is 403`), `AdminRoleTest` (every route of
  the table for `ADMIN`, `SUPPORT` and anonymous), `AdminAuditTest` (one row per action of the
  table, no PII in `metadata`), `AdminBoundaryTest` (the ArchUnit rule and the rendering test
  above), `AdminBootstrapTest`, `V8AdminSchemaTest`, `AdminHeadersTest` (CSP nonce on every page,
  `no-store`, `X-Robots-Tag`). Added in the hardening round: `AdminLoginTest`
  (`reset replaces the old password and requires enrollment then password change`,
  `five wrong current passwords lock the account and end the session`), `AdminSessionTest`
  (`password change rotates its session and ends other sessions and pending logins`,
  `totp reset ends authenticated and pending sessions while the operator stays signed in`),
  `AdminBootstrapTest` (`bootstrap never promotes or changes a support account`),
  `AdminManagementTest`.
