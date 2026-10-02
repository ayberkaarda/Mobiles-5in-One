# ADR-0064: Admin API surface, TOTP enrollment and step-up

- Status: Proposed
- Date: 2026-10-02
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §6 item 18; authorization matrix §3.8 (footnotes 4, 26, 27), §4.1, §4.5,
  §6; ADR-0007, ADR-0009, ADR-0033; `packages/contracts/src/admin.ts`,
  `packages/contracts/src/endpoints.ts`

## Context

Authorization matrix §3.8 proposes the admin mutations and leaves `GET admin/**` open. The admin
TOTP work package, the moderation and import work package and the admin web panel are built in
parallel, so the list endpoints, the enrollment flow and the error codes are fixed here first.
`verifyStaffTotp` is a fail-closed stub today and `users.totp_secret_enc`,
`totp_last_used_step` and the per-family `step_up_until` already exist.

## Decision

1. **Surface.** 15 operations under `/api/v1/admin/**`, all `auth: required` with a `moderator`
   or `admin` session (non-staff → 403 `forbidden`, before any resource is loaded):

   | Operation                           | Action                  | Step-up | Group |
   | ----------------------------------- | ----------------------- | ------- | ----- |
   | `POST admin/step-up`                | `admin.stepUp`          | no      | T     |
   | `POST admin/totp/enroll`            | `admin.totpEnroll`      | no      | T     |
   | `POST admin/totp/confirm`           | `admin.totpEnroll`      | no      | T     |
   | `GET admin/venues`                  | `admin.read`            | yes     | —     |
   | `PATCH admin/venues/:id`            | `venue.verify`          | yes     | G     |
   | `POST admin/venues/import`          | `venue.import`          | yes     | G     |
   | `GET admin/venues/import/:importId` | `admin.read`            | yes     | —     |
   | `GET admin/reviews`                 | `admin.read`            | yes     | —     |
   | `DELETE admin/reviews/:id`          | `review.delete`         | yes     | G     |
   | `GET admin/open-calls`              | `admin.read`            | yes     | —     |
   | `DELETE admin/open-calls/:id`       | `opencall.remove`       | yes     | G     |
   | `GET admin/users`                   | `admin.read`            | yes     | —     |
   | `PATCH admin/users/:id/role`        | `admin.role.manage`     | yes     | G     |
   | `PATCH admin/users/:id/deactivate`  | `admin.user.deactivate` | yes     | G     |
   | `GET admin/audit-logs`              | `admin.audit.read`      | yes     | —     |

   The registry marks step-up routes with `stepUp: true`, which implies 401
   `step_up_required`; the OpenAPI document carries it as `x-kadro-step-up`.

2. **Two-step enrollment.** `POST admin/totp/enroll` takes a single-use re-authentication proof
   (password, or a provider identity token with its nonce for Apple; the same proof shape as
   `DELETE me`) and returns a new base32 secret (160 bits) and its `otpauth://` URI once, with
   fixed parameters SHA-1, 6 digits, 30 seconds. The secret is stored encrypted as **pending**
   and replaced by a new enrollment call. `POST admin/totp/confirm` activates it with a code from
   it within 10 minutes; activation alone does not open a step-up window. An already active
   secret answers 409 `totp_already_enrolled` on both routes; confirm without a pending secret
   answers 409 `totp_not_enrolled`. Resetting an active secret is an operator action, like the
   first-admin bootstrap (ADR-0009).
3. **Codes.** `totp_invalid` (401) for a wrong, reused or out-of-window code, on step-up,
   confirm and the per-action fresh code; `totp_already_enrolled` (409). The mobile app refreshes
   tokens only on `unauthenticated`, so a 401 with these codes never triggers a refresh.
4. **Fresh code per action.** Role changes and deactivation carry `totpCode` in the body
   (footnote 27) in addition to the step-up window; own account → 403, last active admin → 409
   `last_admin`. Lifting a deactivation of an account in its self-initiated deletion grace period
   answers 409 `deletion_pending`, since only the user can cancel by signing in.
5. **Lists.** Cursor pagination as everywhere (ADR-0039), newest first. Users appear with a masked
   email (`a***@d***`, matrix §6), never the address; tombstones are never listed (ADR-0033).
   Audit rows never include `ip_hash`, and `metadata` is restricted to short scalar values.
6. **Venue import.** The CSV travels inline in the JSON body (1 MiB limit, at most 5 000 rows) with
   a fixed column set (`name, il, ilce, latitude, longitude, indoor` required). The handler stores
   it, answers 202 with the import state and enqueues `venue.import`. Imported rows are created
   verified, never as samples; a row whose normalized name already exists in its district is
   skipped. `dryRun` validates without writing. Up to 50 row-level issues are reported.
7. **Encryption key.** `TOTP_ENCRYPTION_KEY` is the canonical base64url form of exactly 32 bytes
   (AES-256-GCM), different from every other secret; required outside local. Locally it may be
   empty, and enrollment and step-up then answer 503 (fail closed).

## Consequences

- Database (Phase 5 migrations): a pending TOTP secret with its creation time on `users` (or a
  side table), and a `venue_imports` table holding the CSV, counters and issues.
- The authorization matrix lists `POST admin/totp/confirm` and the list endpoints through the
  Phase 5 docs work package; `GET admin/**` already covers the reads.
- Admin routes are web-first; the mobile app has no admin screens.

## Schema (migrations 0014 and 0015)

- `users` gains `totp_pending_secret_enc` and `totp_pending_created_at`, a pending secret in the
  same ciphertext format as `totp_secret_enc`. A check keeps the two columns both set or both
  null, requires the active secret to be empty while one is pending, and forbids a pending secret
  on a tombstone. `confirmPendingTotpSecret` promotes it to the active secret in one conditional
  update that compares the verified ciphertext and the confirm window, so a concurrent new
  enrollment or a second confirm cannot both succeed.
- `venue_imports` holds the inline CSV (at most 900 000 characters), the status (`queued`,
  `processing`, `completed`, `failed`), `dry_run`, the row counters and up to 50 issues as JSON.
  `created_by` is set null when the admin account is deleted. The web role inserts and reads rows,
  the worker reads and updates them, and neither role deletes.
