# Staff account recovery: lockout and TOTP loss

Runbook for the staff (`moderator`, `admin`) accounts of the admin API and panel
([`../web/admin-panel.md`](../web/admin-panel.md)). It records what the system supports today and
what is left to an operator. Decisions: [ADR-0009](../adr/0009-admin-bootstrap-and-last-admin.md),
[ADR-0064](../adr/0064-admin-api-and-totp-enrollment.md),
[ADR-0066](../adr/0066-staff-totp-verification-and-step-up.md),
[ADR-0067](../adr/0067-admin-moderation-and-venue-import.md),
[ADR-0068](../adr/0068-admin-web-panel.md). Threat model rows: T-ADM-02, T-ADM-03, T-ADM-08.

**Status of this document: written, never executed.** Nothing here was run against a database. The
SQL below is documentation for an operator who has database access to the target environment; read
every statement before running it and test it on a copy first.

Legend: **supported** means an API route or panel screen exists on `main`. **not implemented**
means there is no code for it; the step is either an operator action in the database or does not
exist at all. Do not assume a "not implemented" step can be done through the API.

## What the system supports today

| Situation                                                 | Supported path                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Staff forgot the password                                 | Supported: the normal password reset (`POST /api/v1/auth/forgot`, `POST /api/v1/auth/reset`), see section 2.  |
| Staff never enrolled TOTP                                 | Supported: `/admin/totp-kurulum` (password as proof), see section 1.                                          |
| Staff lost the authenticator device (TOTP already active) | **No API or panel path.** Enrollment answers 409 `totp_already_enrolled`. Operator reset only, see section 3. |
| Another admin resets a colleague's TOTP                   | **Not implemented.** No route does this; the admin API has no TOTP reset.                                     |
| Admin deactivated by another admin                        | Supported: another admin lifts it, see section 4.                                                             |
| The only admin is locked out or deactivated               | **No API path.** Operator action, see sections 3 and 5.                                                       |
| First admin of a new environment                          | Operator only (ADR-0009). The operator script is **not implemented**, see section 6.                          |

Who can do what, as enforced by the API (each call is decided again server side):

- `moderator`: read lists and verify venues, with a step-up window. Cannot change roles, deactivate,
  import venues or read the audit log.
- `admin`: everything a moderator can, plus role changes, deactivation and reactivation, venue
  import and the audit log. A role change or deactivation needs the step-up window and a fresh TOTP
  code in the request body.
- Nobody can change their own role or deactivate themselves through the API (403).
- Nobody, including an admin, can enroll or reset TOTP for another account through the API.

## 1. TOTP not enrolled yet (supported)

1. Sign in at `/admin/giris` with e-mail and password. Apple- or Google-only accounts have no
   password and cannot use the panel sign-in or enroll on the web (ADR-0068 decision 6); their
   enrollment is an operator task.
2. Open `/admin/totp-kurulum`, enter the password, scan the QR code (or type the key), confirm
   with the first code within 10 minutes. A newer enrollment call replaces an unconfirmed secret.
3. Server prerequisite: `TOTP_ENCRYPTION_KEY` must be set (outside local it is required). Without it
   enrollment and step-up answer 503 `service_unavailable` by design (fail closed). Fix the
   environment, not the data.

Wrong codes: every code check of an account shares one budget of 5 attempts per 15 minutes
(ADR-0066 decision 4). When spent, the API answers 429 with `Retry-After`. There is **no** command
or screen to clear the budget; wait for the window to pass.

## 2. Forgotten staff password (supported)

1. The staff member requests a reset at `/sifremi-unuttum` (API: `POST /api/v1/auth/forgot`). The
   answer is the same whether or not the account exists; a link is sent by e-mail.
2. `/sifre-sifirla` (API: `POST /api/v1/auth/reset`) sets the new password, revokes every refresh
   token and web session of the user, and marks the e-mail verified if it was not.
3. The reset does **not** touch TOTP. The staff member still needs the authenticator code for the
   step-up. If the device is gone as well, continue with section 3.

Limits: the reset needs a password account that is not deactivated (a social-only or deactivated
account gets no reset mail, `account-flows.ts`). A deactivated staff account must be reactivated
first (section 4). The reset flow is rate limited per IP and per e-mail (5 per 15 minutes).
An admin cannot set or reset another person's password; there is no admin-initiated password reset
(**not implemented**).

## 3. TOTP device lost, secret already active (operator action)

What the API does: `POST admin/totp/enroll` and `POST admin/totp/confirm` answer 409
`totp_already_enrolled` while `users.totp_secret_enc` is set. ADR-0064 decision 2 reserves the
reset for an operator, "like the first-admin bootstrap". There is **no script and no route** for it
(**not implemented**), so the reset is a documented database change.

Prerequisites and rules:

- An operator with database credentials that may write `users` and `audit_logs` (the credentials
  used for migrations; the `kadro_app` and `kadro_worker` roles have `INSERT, SELECT` on
  `audit_logs` but they are not meant for manual work). The operator is not the staff member being
  reset, or a second person approves the request.
- Verify the person first, outside the product: a request from the account's known e-mail address is
  not enough on its own for an admin account. Record who approved it and how it was verified in the
  audit metadata below.
- Take a backup or at least `pg_dump --table=users` first. The statements are scoped by `WHERE` on
  one user id; run them in one transaction and check the row counts.
- Every operator change must leave an `audit_logs` row (`actor_id` NULL, `metadata.source =
'operator_script'`, ADR-0009). The action name below (`admin.totpResetByOperator`) is **proposed**:
  no code writes it today and no test or panel filter knows it.

```sql
-- psql -v target_id='<uuid of the staff user>' -v approved_by='<name or ticket>'

-- 1. Look first. Expect exactly one row, role moderator or admin, is_tombstone = false.
SELECT id, role, deactivated_at, is_tombstone,
       totp_secret_enc IS NOT NULL AS totp_active,
       totp_pending_secret_enc IS NOT NULL AS totp_pending
FROM users
WHERE id = :'target_id';

BEGIN;

-- 2. Clear the active and the pending secret and the replay marker. Expect UPDATE 1.
UPDATE users
SET totp_secret_enc = NULL,
    totp_pending_secret_enc = NULL,
    totp_pending_created_at = NULL,
    totp_last_used_step = NULL,
    updated_at = now()
WHERE id = :'target_id'
  AND role IN ('moderator', 'admin')
  AND is_tombstone = false;

-- 3. Close every open step-up window of the account. Expect the count of live windows.
UPDATE refresh_tokens
SET step_up_until = NULL
WHERE user_id = :'target_id'
  AND step_up_until IS NOT NULL;

-- 4. Audit entry (required). One row, actor NULL.
INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata)
VALUES (gen_random_uuid(), NULL, 'admin.totpResetByOperator', 'user', :'target_id',
        jsonb_build_object('source', 'operator_script', 'approvedBy', :'approved_by'));

-- 5. Check "UPDATE 1" for step 2 and "INSERT 0 1" for step 4, then COMMIT; otherwise ROLLBACK.
COMMIT;
```

Notes:

- Ids in this schema are UUIDv7 created by the application; `gen_random_uuid()` (v4) is accepted
  for a manual row because nothing depends on the version (ids are not secret, ADR-0016).
- `audit_logs.metadata` is read by the audit viewer, which drops entries that do not fit its
  response schema; keep values to short scalars (ADR-0064 decision 5). Never put a secret or an
  e-mail address in it.
- After the commit the staff member signs in, goes to `/admin/totp-kurulum` and enrolls again
  (section 1). The old authenticator entry is dead and should be deleted from the device.
- Should the staff member also have lost the password, finish section 2 first so the reset link goes
  to their mailbox, then enroll TOTP.
- A staff account without a password (Apple or Google only) can neither sign in to the panel nor
  enroll on the web today, and no route gives it a password (**not implemented**). Such an account
  cannot use the panel until that gap is closed; clearing its TOTP secret does not change that.

### Rotating or losing `TOTP_ENCRYPTION_KEY`

Secrets are AES-256-GCM encrypted under this key (ADR-0066 decision 3). A changed or lost key makes
every stored secret unreadable: step-up and per-action codes answer 500 for every staff account.
Restore the old key if you still have it. Otherwise run the section 3 reset for each staff account,
changing the `WHERE` clause deliberately (for example `WHERE role IN ('moderator','admin')` plus a
reviewed list of ids, never an unscoped statement) and write one audit row per account. There is no
key-versioned format or re-encryption job (**not implemented**; a `v2` prefix is mentioned as a
possible future step).

## 4. Deactivated admin or moderator (supported when another admin exists)

Deactivation (`PATCH /api/v1/admin/users/:id/deactivate`) sets `users.deactivated_at`, revokes
every refresh family and web session, and makes the account answer 401 `account_deactivated`
(ADR-0067 decision 4). It leaves TOTP untouched.

1. Another active admin signs in, opens the step-up, then lifts it in `/admin/kullanicilar` or with
   `PATCH /api/v1/admin/users/:id/deactivate` and `{ "deactivated": false, "totpCode": "<fresh code>" }`.
   One audit row (`user.reactivated`) is written.
2. If the target is in a self-initiated account-deletion grace period, the answer is 409
   `deletion_pending`. Only the user can cancel it, by signing in during the grace period
   (ADR-0012, ADR-0032); an admin cannot.
3. The reactivated person signs in again; all their old sessions are gone, their TOTP still works.

If no active admin remains, there is no API path. See section 5.

## 5. Last-admin protection and when no admin can act

Rules in force (ADR-0009, ADR-0067 decision 3):

- Demotion, deactivation and own-account deletion of an admin are refused with 409 `last_admin` when
  no other active admin (`role = 'admin' AND deactivated_at IS NULL`) would remain. The check runs
  after locking all admin rows (`SELECT ... FOR UPDATE`).
- An admin cannot change their own role or deactivate themselves (403), regardless of the count.
- Two admins acting on each other serialize on the locks; the second request answers 403.

The platform therefore cannot reach zero active admins through the API. It can still be left with
an admin nobody can use: the only admin lost the TOTP device (section 3), forgot the password and
the mailbox (section 2), or the only admin was deactivated by a row-level change in the database.
Those cases are operator work. To check the state:

```sql
-- Read-only: who can act as admin right now?
SELECT id, role, deactivated_at, totp_secret_enc IS NOT NULL AS totp_active
FROM users
WHERE role = 'admin'
  AND is_tombstone = false;
```

Restoring access to a deactivated admin with no other admin (operator action, same rules as
section 3: one id, one transaction, one audit row; the action name is **proposed**):

```sql
-- psql -v target_id='<uuid>' -v approved_by='<name or ticket>'
BEGIN;

-- Expect UPDATE 1. Not for accounts in a deletion grace period: check deletion_requests first.
UPDATE users
SET deactivated_at = NULL,
    updated_at = now()
WHERE id = :'target_id'
  AND role = 'admin'
  AND is_tombstone = false
  AND deactivated_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM deletion_requests d
    WHERE d.user_id = users.id AND d.completed_at IS NULL
  );

INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata)
VALUES (gen_random_uuid(), NULL, 'admin.reactivatedByOperator', 'user', :'target_id',
        jsonb_build_object('source', 'operator_script', 'approvedBy', :'approved_by'));

COMMIT;
```

Do not change `role` or bypass the last-admin rule with other ad hoc SQL. Promoting a further admin
is a normal API call (`PATCH /api/v1/admin/users/:id/role`) while an active admin who can step up
exists; with none, the only way back is section 6.

## 6. First admin, or an environment with no usable admin (operator only)

ADR-0009: the first admin is created by an operator script in `packages/db`, run with database
credentials, that sets `role = 'admin'` on an existing, e-mail-verified account and writes an
`audit_logs` row with `actor_id = NULL` and `metadata = { source: 'operator_script' }`. No API
route, environment flag or seed grants the admin role.

**The script is not implemented.** `packages/db/src/cli/` holds only `migrate.ts` and `seed.ts`.
Until it exists, the equivalent database change is documented here; it needs the same operator
conditions as section 3. The new admin must then enroll TOTP before any step-up-protected action.

```sql
-- psql -v target_id='<uuid of an existing, e-mail-verified, active account>' -v approved_by='<name or ticket>'
BEGIN;

-- Expect UPDATE 1.
UPDATE users
SET role = 'admin',
    updated_at = now()
WHERE id = :'target_id'
  AND email_verified_at IS NOT NULL
  AND deactivated_at IS NULL
  AND is_tombstone = false;

INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, metadata)
VALUES (gen_random_uuid(), NULL, 'admin.bootstrapByOperator', 'user', :'target_id',
        jsonb_build_object('source', 'operator_script', 'approvedBy', :'approved_by'));

COMMIT;
```

## Gaps summary

| Missing piece                                                    | Where it is referenced                     |
| ---------------------------------------------------------------- | ------------------------------------------ |
| Operator script for the first admin                              | ADR-0009 (not in `packages/db/src/cli/`)   |
| Operator command or route for a TOTP reset                       | ADR-0064 decision 2, ADR-0066 consequences |
| Admin-initiated password reset or TOTP reset for another account | none (not designed)                        |
| Enrollment for Apple or Google only staff on the web             | ADR-0068 decision 6                        |
| Key-versioned TOTP storage and re-encryption after a key change  | ADR-0066 consequences                      |
| A way to clear the 5-attempt TOTP budget before the window ends  | none                                       |
| Audit action names for operator changes (proposed above)         | none; add them to the code with the script |
| Tested procedure: the SQL on this page has never been run        | this document                              |
