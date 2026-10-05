# Çetele — Authorization Matrix

|                |                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | **Role by action table is implemented (end of Phase 0); endpoint rows are a draft.** `PermissionMatrix.kt` holds the grants of section 2 and `PermissionMatrixTest` checks every cell (52 role by action cells plus 3 consistency tests). The endpoint rows (section 4) describe intended rules; no endpoint exists yet and no `PermissionEvaluator` bean exists yet (`not exercised: endpoint enforcement, Phase 1`). |
| Source         | Product spec section 3 (personas), section 5 (API surface and tables), section 6 items 3, 4, 5, 17, 18 and 21.                                                                                                                                                                                                                                                                                                         |
| Normative for  | `server/src/main/kotlin/app/cetele/server/security/Permissions.kt`, the `PermissionEvaluator` bean (`@PreAuthorize("@perm.can(#shopId, 'LEDGER_WRITE')")`) and the table-driven `PermissionMatrixTest` over every role by action cell (spec section 6 item 3).                                                                                                                                                         |
| Change rule    | A change to a cell here ships together with the matching change in `Permissions.kt` and its test row. Document and code must never disagree. A row for a new endpoint is added here first.                                                                                                                                                                                                                             |
| Companion docs | [threat-model.md](threat-model.md) (outline), [verification-matrix.md](verification-matrix.md) (23 items), [ADR-0004](../adr/0004-portfolio-delivery-scope.md) (evidence limits).                                                                                                                                                                                                                                      |

---

## 1. Principals

| Principal | Where it lives               | Identity carried                                                                                   | Intended use                                                           |
| --------- | ---------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `OWNER`   | `memberships.role = OWNER`   | ES256 access JWT of a `users` row plus a membership row for the shop in the path                   | Everything in a shop, including members, export and billing            |
| `STAFF`   | `memberships.role = STAFF`   | Same token kind plus a `STAFF` membership row for the shop in the path                             | Day-to-day work: customers, entries, reminders, statements             |
| `ADMIN`   | `admin_users.role = ADMIN`   | Admin console session (`__Host-CETELE_ADMIN` cookie, TOTP at login); never a `/v1` token           | Support views, account actions on users, administration of admin users |
| `SUPPORT` | `admin_users.role = SUPPORT` | Same session mechanism as `ADMIN`                                                                  | Read-only support views                                                |
| `guest`   | none (not a role)            | No identity; some endpoints carry a credential of their own (signed link token, webhook signature) | Login endpoints, the public statement page, provider webhooks          |

Rules that apply to every row:

- **`shop_id` always comes from the caller's membership** and never from the request body (spec
  item 4). A path `{id}` is checked against the memberships of the caller before any action check.
- **Roles are looked up on every request** in the database, not read from token claims, so removing
  a member or deactivating a user takes effect at once (draft default, see D-1).
- **Admin identities never travel on `/v1`** and a `/v1` token never opens `/admin/**`. `ADMIN` and
  `SUPPORT` have no `memberships` row, so they cannot pass any tenant check on the API.
- **Deactivated users** (`users.deactivated_at` not null) are rejected on every request.
- Every `/admin/**` action writes an `audit_logs` row (spec item 18).

## 2. Role by action

These names are exactly the `code` values of the objects of the sealed class `Permission` in `Permissions.kt`.

Cell vocabulary: `Y` allowed, `-` denied. `SHOP_READ` for `ADMIN` and `SUPPORT` is shop metadata and
counts in the admin console only, never ledger notes, photos, customer names or customer phones. The
other admin capabilities (section 5) are separate admin-console rules, not members of `Permissions.kt`.

| Action                  | OWNER | STAFF | ADMIN | SUPPORT | guest | Meaning                                                                                       |
| ----------------------- | ----- | ----- | ----- | ------- | ----- | --------------------------------------------------------------------------------------------- |
| `SHOP_READ`             | Y     | Y     | Y     | Y       | -     | Read the shop record; for `ADMIN` and `SUPPORT` only metadata and counts in the admin console |
| `SHOP_MANAGE`           | Y     | -     | -     | -       | -     | Change shop name, type, il and ilçe                                                           |
| `MEMBERS_MANAGE`        | Y     | -     | -     | -       | -     | Invite, list and remove members                                                               |
| `CUSTOMER_READ`         | Y     | Y     | -     | -       | -     | Read customers and their balances                                                             |
| `CUSTOMER_WRITE`        | Y     | Y     | -     | -       | -     | Create and update customers (name, phone, note, tag, SMS consent)                             |
| `CUSTOMER_DELETE`       | Y     | -     | -     | -       | -     | Delete (tombstone) a customer                                                                 |
| `LEDGER_READ`           | Y     | Y     | -     | -       | -     | Read entries and statements                                                                   |
| `LEDGER_WRITE`          | Y     | Y     | -     | -       | -     | Create `DEBT` and `PAYMENT` entries and reversing entries                                     |
| `REMINDER_SEND`         | Y     | Y     | -     | -       | -     | Request an SMS reminder (consent and quota still apply)                                       |
| `EXPORT_ALL`            | Y     | -     | -     | -       | -     | Export all entries of the shop                                                                |
| `STATEMENT_LINK_CREATE` | Y     | Y     | -     | -       | -     | Create a signed statement link (needed by the WhatsApp share, see D-3)                        |
| `MEDIA_PRESIGN`         | Y     | Y     | -     | -       | -     | Obtain a presigned upload URL for an entry photo (see D-4)                                    |
| `BILLING_MANAGE`        | Y     | -     | -     | -       | -     | Link a purchase and manage the subscription                                                   |

Notes:

- No `ledger` write exists for `ADMIN` or `SUPPORT` in any form, and neither role can read ledger
  notes or photos (spec item 18). The `SHOP_READ` cell of the admin roles means counts and metadata only.
- `STAFF` has no `CUSTOMER_DELETE`, `EXPORT_ALL`, `MEMBERS_MANAGE` or `BILLING_MANAGE`, as the spec
  states (item 3). `SHOP_MANAGE` is also withheld from `STAFF`, as `PermissionMatrix.kt` does.
- `guest` holds no action. Endpoints open to a guest are listed with their own credential in
  section 4.
- `EXPORT_ALL` has no server endpoint in the Phase 0 API surface. The CSV export reads the local
  database on the device, so for `STAFF` the restriction is a UI gate until a server export exists
  (see D-5).

## 3. Denial convention

| Situation                                                                         | Status                | Problem `code` (draft) | Rationale                                                                           |
| --------------------------------------------------------------------------------- | --------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| No token, expired token, revoked token, deactivated user                          | 401                   | `auth.unauthenticated` | Standard.                                                                           |
| Caller is a member of the shop but the role lacks the action                      | 403                   | `forbidden`            | The caller already knows the shop exists; the role is the only missing piece.       |
| Caller is not a member of the shop in the path, or the shop or resource is absent | 404                   | `not_found`            | A shop or customer of another tenant looks identical to a missing id (spec item 4). |
| Validation failure                                                                | 422                   | `validation_failed`    | Field errors as codes only, never values (spec items 6 and 13).                     |
| State forbids the action (expired invitation, already used code)                  | 404 or 409            | endpoint specific      | Invitation and statement tokens return a uniform 404 so they cannot be probed.      |
| Rate limit                                                                        | 429                   | `rate_limited`         | `Retry-After` always present (spec item 5).                                         |
| Missing integrity token on `otp/request`                                          | 403                   | `integrity_required`   | Spec item 5.                                                                        |
| Webhook with a missing or invalid signature                                       | 401                   | `unauthorized`         | Empty detail; nothing about the expected signature is revealed (spec item 17).      |
| Admin console without a valid session or TOTP                                     | 302 to the login page | n/a                    | Console is HTML, not JSON. Role mismatch on a console page is 403.                  |

Bodies are RFC 9457 Problem Details with a generic `title`, a machine `code` and a `traceId` only
(spec item 13). The `code` strings above are draft names; they are fixed in the Phase 1 error
contract ADR and this table is updated in the same change.

## 4. Endpoint matrix (`/v1`)

Columns: **Needs** is the action from section 2, or the credential for endpoints without one. Cells
`OWNER` and `STAFF` say whether a member of that role may call the endpoint. `guest` is a caller
without a token. `any user` means any authenticated user, with no shop role involved.

### 4.1 Authentication and account

| Method | Path               | guest | any user | Needs                         | Notes                                                                                                                                    |
| ------ | ------------------ | ----- | -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `auth/otp/request` | Y     | Y        | Play Integrity token          | 3 per 10 min per phone and 10 per 10 min per IP; missing integrity token is 403; client IP from the trusted proxy header only.           |
| POST   | `auth/otp/verify`  | Y     | Y        | OTP code                      | 5 attempts per code, then the code is invalidated; code is single use with a 5 minute TTL.                                               |
| POST   | `auth/refresh`     | Y     | Y        | refresh token                 | 30 per minute per device; rotation with reuse detection revokes the token family.                                                        |
| POST   | `auth/logout`      | -     | Y        | own session                   | Revokes the refresh token of the calling device only.                                                                                    |
| GET    | `me`               | -     | Y        | own account                   | Returns the caller's own record and memberships.                                                                                         |
| PATCH  | `me`               | -     | Y        | own account                   | Display name only; the phone number is not editable here.                                                                                |
| DELETE | `me`               | -     | Y        | own account and OTP re-verify | Starts the 14 day deletion grace (spec item 21). An owner of a shop with other members must transfer ownership or delete the shop (D-7). |

### 4.2 Shops and members

| Method | Path                          | guest | OWNER    | STAFF    | Needs              | Notes                                                                                                                                                                              |
| ------ | ----------------------------- | ----- | -------- | -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `shops`                       | -     | any user | any user | authenticated user | Creates the shop and an `OWNER` membership for the caller. No prior shop role exists, so no action is checked. Plan limits apply (Free 100 customers).                             |
| GET    | `shops/{id}`                  | -     | Y        | Y        | `SHOP_READ`        | Non-member gets 404.                                                                                                                                                               |
| PATCH  | `shops/{id}`                  | -     | Y        | -        | `SHOP_MANAGE`      | `plan` is never writable by the client; it follows the subscription.                                                                                                               |
| POST   | `shops/{id}/invitations`      | -     | Y        | -        | `MEMBERS_MANAGE`   | Phone-bound invitation, code stored as a hash, 24 hour validity.                                                                                                                   |
| POST   | `invitations/{code}/accept`   | -     | any user | any user | the code itself    | Not shop-scoped in the path: the code selects the shop. The caller's phone must match the invited phone. Invalid, expired, used or mismatched code is a uniform 404. Rate limited. |
| GET    | `shops/{id}/members`          | -     | Y        | -        | `MEMBERS_MANAGE`   | Draft default: staff do not list members (D-2).                                                                                                                                    |
| DELETE | `shops/{id}/members/{userId}` | -     | Y        | -        | `MEMBERS_MANAGE`   | The owner cannot remove their own membership through this call (D-6). An unknown `userId` in the shop is 404.                                                                      |

### 4.3 Sync, statements, reminders, media, billing

| Method | Path                                              | guest | OWNER | STAFF | Needs                                                              | Notes                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------- | ----- | ----- | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `shops/{id}/sync/push`                            | -     | Y     | Y     | per operation: `CUSTOMER_WRITE`, `CUSTOMER_DELETE`, `LEDGER_WRITE` | Member check at the endpoint, action check per operation: a customer create or update needs `CUSTOMER_WRITE`, a customer tombstone `CUSTOMER_DELETE`, a ledger entry or reversal `LEDGER_WRITE`. Batch of at most 500 operations, idempotent by `client_id` (D-8). |
| GET    | `shops/{id}/sync/pull?since={seq}&limit=500`      | -     | Y     | Y     | `CUSTOMER_READ` and `LEDGER_READ`                                  | Cursor is per shop; a cursor from another shop is meaningless and cannot widen access.                                                                                                                                                                             |
| GET    | `shops/{id}/customers/{customerId}/statement.pdf` | -     | Y     | Y     | `CUSTOMER_READ` and `LEDGER_READ`                                  | Server-rendered fallback. Customer of another shop is 404.                                                                                                                                                                                                         |
| POST   | `shops/{id}/statement-links`                      | -     | Y     | Y     | `STATEMENT_LINK_CREATE`                                            | Token is returned once and stored as SHA-256; link has an expiry (D-3).                                                                                                                                                                                            |
| POST   | `shops/{id}/reminders`                            | -     | Y     | Y     | `REMINDER_SEND`                                                    | Channel `SMS` only on the server. Needs recorded `sms_consent`, the shop monthly quota and the global daily cap.                                                                                                                                                   |
| POST   | `shops/{id}/media/presign`                        | -     | Y     | Y     | `MEDIA_PRESIGN`                                                    | `Content-Length` of at most 1 200 000 bytes, `image/jpeg` or `image/webp`, monthly photo quota (D-4).                                                                                                                                                              |
| POST   | `shops/{id}/billing/link`                         | -     | Y     | -     | `BILLING_MANAGE`                                                   | Purchase token stored as a hash; the entitlement is confirmed with the Play Developer API, never from the request alone.                                                                                                                                           |

### 4.4 Public and provider-facing endpoints

| Method | Path                 | guest | Credential             | Notes                                                                                                                                                                        |
| ------ | -------------------- | ----- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `webhooks/play-rtdn` | Y     | Google-signed OIDC JWT | Issuer, audience and service-account email are checked; the purchase is re-verified with the Play Developer API; idempotent by `messageId`. Returns 200 fast (spec item 17). |
| POST   | `webhooks/sms-dlr`   | Y     | HMAC-SHA256 signature  | `X-Cetele-Signature` over the raw body, timestamp within five minutes, replay cache on `provider_msg_id`, source IP allowlist as defence in depth (spec item 17).            |
| GET    | `s/{token}`          | Y     | signed statement token | Public statement page, `noindex`. Unknown, expired or malformed token is a uniform 404. Shows only the one customer's statement. Rate limited per IP.                        |

## 5. Admin console (`/admin/**`, Thymeleaf, not JSON)

Login is email, Argon2id password and TOTP. Both roles use the same session mechanism and the CSRF
protection of Spring. The console reads metadata and counts; it never shows ledger notes, photos,
customer names or customer phones (spec item 18).

| Capability                                                          | ADMIN | SUPPORT | Notes                                          |
| ------------------------------------------------------------------- | ----- | ------- | ---------------------------------------------- |
| Log in (email, password, TOTP)                                      | Y     | Y       | Failed logins are rate limited.                |
| List and open shops (name, type, il, ilçe, plan, dates, counts)     | Y     | Y       | Counts of customers, entries and photos only.  |
| List and open users (masked phone, dates, deactivation, devices)    | Y     | Y       | Phone is masked as `+90*******12`.             |
| View subscription state of a shop                                   | Y     | Y       | Read only.                                     |
| View `audit_logs`                                                   | Y     | -       | Draft default (D-9).                           |
| Deactivate or reactivate a user, revoke devices                     | Y     | -       | Audited; effect on owned shops is open (D-10). |
| Create, change or remove `admin_users`                              | Y     | -       | Audited.                                       |
| Read ledger notes, ledger photos, customer names or customer phones | -     | -       | Never, for either role.                        |
| Create, change or reverse a ledger entry                            | -     | -       | Never, for either role.                        |
| Use any `/v1` endpoint with an admin identity                       | -     | -       | Admin identities are not accepted on the API.  |

## 6. Open decisions that change a cell

Each is a draft default used above. They are listed so the named phase settles them in an ADR and
not in code.

| #    | Question                                                                                                         | Draft default                                                                                                      | Settled in |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| D-1  | Does the access JWT carry roles, or are memberships read on every request?                                       | Read on every request; the JWT carries only user and device ids.                                                   | Phase 1    |
| D-2  | May `STAFF` list the members of the shop?                                                                        | No.                                                                                                                | Phase 1    |
| D-3  | May `STAFF` create statement links? The WhatsApp reminder in spec story 6 needs one.                             | Yes.                                                                                                               | Phase 2    |
| D-4  | May `STAFF` presign photo uploads? Spec story 4 lets staff create entries with an optional photo.                | Yes.                                                                                                               | Phase 2    |
| D-5  | `EXPORT_ALL` has no server endpoint and `STAFF` pulls the whole ledger through sync. Is the restriction UI only? | Yes for now; a future server export needs `EXPORT_ALL`. The gap is recorded in the threat model.                   | Phase 2    |
| D-6  | May an `OWNER` remove their own membership, and is there more than one `OWNER` per shop?                         | No removal through `DELETE members`; one owner per shop.                                                           | Phase 2    |
| D-7  | Ownership transfer is mentioned by spec item 21 but no endpoint exists in the API surface. How is it done?       | Needs a new endpoint and a new action, added to the spec by the owner; until then owner deletion deletes the shop. | Phase 2    |
| D-8  | Does a forbidden operation reject the whole sync batch or only that operation?                                   | Only that operation, reported per operation with `forbidden`; the rest applies.                                    | Phase 2    |
| D-9  | May `SUPPORT` read `audit_logs`?                                                                                 | No.                                                                                                                | Phase 4    |
| D-10 | What happens to a shop when its only `OWNER` is deactivated by an admin?                                         | The shop stays readable by staff; no member management until reactivation.                                         | Phase 4    |
