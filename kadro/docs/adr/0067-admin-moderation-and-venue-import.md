# ADR-0067: Admin moderation actions and the venue import job

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §3 story 7, §6 item 18; authorization matrix §3.8 (footnote 27), §4.5,
  §6, §9.3; threat model T-VEN-06; ADR-0007, ADR-0009, ADR-0028, ADR-0033, ADR-0037, ADR-0038,
  ADR-0039, ADR-0064, ADR-0066; `apps/web/lib/server/admin/*.ts`,
  `apps/worker/src/venues/*.ts`

## Context

ADR-0064 fixed the admin surface (15 operations under `/api/v1/admin/**`), the request and
response shapes and the `venue_imports` table; ADR-0066 implemented step-up and the per-action
TOTP check. The twelve moderation, user and import operations had contracts but no handlers, and
the `venue.import` queue existed without a handler. This record settles the behaviour the
contracts leave open.

## Decision

1. **Policy order.** Every handler calls the gate before it reads a resource, so a non-staff
   caller gets 403 and staff without a window get 401 `step_up_required` without learning whether
   an id exists. Lists use `admin.read` (`admin.audit.read` for the audit log).
2. **Role change and deactivation.** The order of footnote 27 is checked without spending the
   code: the policy is first evaluated as if the code were valid (staff role, step-up, admin tier,
   own account). A request refused there never consumes a TOTP step. Then an unknown or tombstone
   target answers 404, then the code is verified with `verifyFreshStaffTotp`. A wrong, reused or
   missing code answers 401 `totp_invalid` (the contract code; `DELETE me` keeps
   `step_up_required` for staff). Only then is the policy decided with the real fact.
3. **Last admin.** The transaction locks every active admin row in id order (the order of
   `DELETE me`) and the target row, then re-checks that the actor is still an active admin. Two
   admins demoting or deactivating each other serialize on these locks and the second answers
   403, so the platform always keeps an active admin. Demoting or deactivating the last active
   admin answers 409 `last_admin`; because the actor is never the target, the check is a guard
   that the API cannot normally reach.
4. **Deactivation.** `deactivated: true` sets `deactivated_at` (kept when already set) and
   revokes every refresh family and web session, so the account answers 401
   `account_deactivated` on its next request. This is the platform ban; there is no separate ban
   state. `false` lifts it unless a self-initiated deletion is pending (409 `deletion_pending`).
   Push tokens are kept, because a deactivated account gets no notifications anyway and a lifted
   ban should not lose its devices.
5. **Venue corrections.** `PATCH admin/venues/:id` locks the venue row; a rename or a district
   change locks the target district row (the lock `POST venues` takes) and refuses a venue with
   the same folded name there (409 `venue_exists` with its slug, since staff may read every
   venue). The slug never changes. A sample venue keeps its `[ÖRNEK] ` prefix and no other venue
   may take it (400). The price range is checked after merging with the stored values (400).
6. **Removals.** `DELETE admin/reviews/:id` deletes the row (the rating is computed on read).
   `DELETE admin/open-calls/:id` takes the call chain locks of ADR-0037 (team, match, call), sets
   `removed` from any status, rejects pending applications and enqueues one
   `application.decided` push per applicant, all in one transaction.
7. **Audit.** Every allowed admin mutation writes exactly one row, also when it changed nothing
   (metadata `changed: false`): `venue.verified`, `venue.unverified`, `venue.corrected` (field
   names only), `review.removed`, `opencall.removed`, `user.roleChanged`, `user.deactivated`,
   `user.reactivated`, `venue.importRequested`; the worker writes `venue.imported` with counts.
   Metadata holds ids, roles, flags and counts, never names, email, phone or address. The audit
   list never selects `ip_hash`, shows a tombstone or system actor as `null`, and drops metadata
   entries that do not fit the response schema.
8. **Lists.** Newest first by `(created_at, id)` with the signed cursors of ADR-0039. User search
   is a case-insensitive substring of the display name; venue search uses the folded name. Users
   show a masked email only; tombstones and reviews of tombstones are not listed.
9. **Import request.** The web handler stores the CSV, enqueues `venue.import` with key
   `venue-import:<importId>` and writes the audit row in one transaction, then answers 202. The CSV
   is never returned. Moderators may read an import's state (`admin.read`), only admins start one.
10. **Import job.** The worker claims the import (`queued` → `processing`) and then, in one
    transaction holding the import row with a bounded lock wait:
    - reads the CSV (RFC 4180: quotes, escaped quotes, line breaks inside quotes, CRLF, BOM),
      stopping after 5 000 data rows (`failed`, `too_many_rows`);
    - checks the header: every required column, no unknown or repeated column (`failed`);
    - validates each row with the schemas of `POST venues` and reports the first problem per row
      as `{ line, column, issue }`, up to 50 issues; names and addresses that start with `=`, `+`,
      `-`, `@`, a tab or a carriage return are refused (`formula_like`, T-VEN-06), and the
      `[ÖRNEK]` prefix is reserved;
    - resolves `il` / `ilce` slugs to districts (`unknown_district`), locks those district rows in
      id order and skips a row whose folded name already exists in its district, in the
      directory or earlier in the file;
    - unless `dry_run`, inserts the rest as verified, non-sample venues without a creator, with
      the slug scheme of `POST venues` (a savepoint per slug attempt);
    - stores the counters, issues and `completed` or `failed`, and writes the audit row.

    A crashed run rolls back everything, so a retry starts over. A finished import is never run
    again. When the last retry fails, the import is set to `failed` (`internal_error`) so it never
    stays `processing`. The slug function is duplicated in the worker because the worker cannot
    import the web app; both follow ADR-0038.

## Consequences

- No schema change: migration 0015 (`venue_imports`) and the existing grants cover the web role
  (insert and read imports) and the worker (read, progress columns, venue inserts, district row
  locks). Migration 0017 was not needed.
- The admin lists sort by `created_at` without a dedicated index; acceptable at the expected
  volume, and an index can be added later without an API change.
- Programmatic SEO pages pick up verification changes within their 5-minute cache window; no tag
  is revalidated from the admin handlers.
- Content reports (user flags on reviews or calls) have no contract; staff moderate from the
  lists. A report queue needs its own contract first.
