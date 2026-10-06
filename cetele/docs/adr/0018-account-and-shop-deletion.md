# ADR-0018: Account and shop deletion

- Status: Accepted
- Date: 2026-10-06
- Deciders: Ayberk (owner)

## Context

Spec section 6 item 21 asks for real deletion: after completion no row may reference the shop or the
user. Two things make that hard. A shop has several members, so deleting the account of its owner
must not destroy other people's data by accident. And deletion is irreversible, so it needs a grace
period, a step-up check and a state the owner can see and cancel. The `audit_logs` table arrives in
Phase 4, so Phase 2 can leave only a structured log line as evidence.

## Decision

### Requests

- `DELETE /v1/me` takes `{code, deleteOwnedShops: false}` where `code` is a `REAUTH` code
  ([ADR-0019](0019-ownership-transfer-and-reauthentication.md)), and answers 202
  `{requestedAt, graceUntil, shopsToDelete}`. The grace period is 14 days. The account stays usable
  during the grace period so the owner can cancel from the app.
- `DELETE /v1/me/deletion` (no code) cancels the open `ACCOUNT` request and the `SHOP` requests that
  were created with it; 204, or 404 when nothing is open. `GET /v1/me` gains
  `deletion: {requestedAt, graceUntil, blocked} | null`.
- `DELETE /v1/shops/{shopId}` (`MEMBERS_MANAGE`, body `{code}`) deletes one shop with the same grace
  and answers 202 `{requestedAt, graceUntil}`; `DELETE /v1/shops/{shopId}/deletion` cancels it. A
  second open request is `409 account.deletion_pending` or `409 shop.deletion_pending`; unique
  partial indexes on `deletion_requests` back that in the database
  (`V5ServicesSchemaTest`: `deletion requests enforce kind grace and only one open request`).
- An owner of a shop with other members gets `409 account.owner_of_shared_shop` unless
  `deleteOwnedShops` is true (every owned shop then gets its own `SHOP` request with the same grace)
  or the owner transfers ownership first. Owned shops without other members are always scheduled.
  If an owned shop already has its own open `SHOP` request, that request is kept with its earlier
  grace and listed in `shopsToDelete`; cancelling the account leaves it open.
  - `DeletionCancelTest`: `account request keeps an earlier shop request and its cancel leaves that request open`
  - `DeletionCancelTest`: `shop cancellation does not cancel an independent account request`
  - `DeletionCancelTest`: `cancelling account cancels linked shops and keeps account usable`
- `deletion_requests` has no foreign keys on purpose: the row must outlive the user and the shop it
  records, and it holds no personal data (ids and timestamps).

### Semantics of a `SHOP` request

A `SHOP` request carries the owner's choice as it stood when it was made, so no shared shop is
deleted without an explicit decision. At completion:

- the shop is already gone: completed;
- the requester no longer owns the shop (ownership was transferred): the request is cancelled
  (`outcome=owner_changed`);
- a member other than the requester joined after the request: the request is blocked and nothing is
  deleted, re-evaluated at every run (it unblocks when that member leaves, or the owner cancels and
  asks again);
- otherwise the shop is deleted.

Members who were present when the request was made are covered by the owner's choice
(`deleteOwnedShops: true` or an explicit shop deletion).

### Account completion and the blocked state

At completion the account request is re-evaluated. An owner who is still `OWNER` of a shop with
other members (one who joined during grace, for example) gets `blocked_at` and nothing else happens;
`GET /v1/me` shows `blocked: true`. A transfer of ownership or the shop emptying of other members
clears the block on the next run. Owned shops that are now solo are deleted like a `SHOP` request
(and an open `SHOP` request of such a shop is completed with it), then the user is removed.

- `DeletionBlockedTest`: `shared shop requires explicit deletion choice`
- `DeletionBlockedTest`: `new shared ownership during grace blocks account and transfer clears block`
- `DeletionBlockedTest`: `scheduled shop that gains a member during grace is kept and blocks the account until transfer`
- `DeletionBlockedTest`: `shop becoming empty of other members clears block on next run`

### Executor

`DeletionExecutor` runs hourly (`cetele.jobs.enabled`, `JobLocks.runExclusive`, one run at a time
across instances), takes due open rows (`grace_until` passed), `SHOP` rows first and `ACCOUNT` rows
after. A shop hard delete takes the shop lock and removes **object storage first**
(`MediaStore.deletePrefix` for `media/<shopId>/` and `uploads/<shopId>/`); a storage failure aborts
that row, which is retried at the next run, so the database never loses the pointer to data that is
still in storage (`AccountDeletionTest`: `storage failure preserves database and request for the next run`).
Then it deletes explicitly, never through cascades, in this order: `reminders`, `statement_links`,
`sync_outbox_receipts`, `change_log`, `ledger_entries`, `customers`, `media_objects`, `sms_quota`,
`invitations`, `shop_sequences`, `memberships`, `shops`. The account part deletes `refresh_tokens`,
`devices`, `otp_codes` of the phone, `memberships` and `users`. The access token of a deleted user
becomes 401 because the authentication filter refuses an unknown user
([ADR-0005](0005-session-model.md)); during grace it keeps working by design.

The gate test, `AccountDeletionTest` (`completion removes all shop data storage and sessions and preserves completion evidence`),
builds a shop with customers, entries, a photo in MinIO, reminders, links, quota, an invitation,
devices and refresh tokens, requests deletion, moves `grace_until` into the past, runs the executor
and then asserts: zero rows for the shop in **every table that has a `shop_id` column**, discovered
from `information_schema` so a future table is covered; no `uuid` column of any public table (except
`deletion_requests`) holds the shop id or the user id; no `phone_e164` column holds the phone; the
MinIO prefixes are empty; the `users` row is gone; the old access token is 401; `completed_at` is
set; a second run changes nothing.

### Completion evidence

The executor writes one log line, `account deletion completed user=<id> shops=<n>` (and
`Shop deletion completed shop=<id>`), with ids and counts only (`AccountLogSampleTest`:
`deletion logs contain outcomes without phone code or token`). The `deletion_requests` row with
`completed_at` stays. `audit_logs` arrive in Phase 4.

### Retention

`RetentionSweeper` runs daily at 03:00 (`Europe/Istanbul`) behind the same job switch and lock and
deletes: `otp_codes` older than 1 day; `refresh_tokens` revoked or expired more than 30 days ago;
`invitations` expired more than 7 days ago; `statement_links` expired or revoked more than 90 days
ago; `media_objects` rows `FAILED` or `EXPIRED` older than 7 days. It returns the counts
(`RetentionSweeperTest`: `retention removes only old eligible records and preserves boundary and active rows`).

### Architecture rules

[ADR-0012](0012-architecture-rules-and-test-strategy.md) left plain `JdbcClient` and `JdbcTemplate`
use outside ArchUnit rule 3 and called it a known gap. Phase 2 turns it into an enforced allowlist
with a new rule in `ArchitectureTest`: **rule 7** (`rule 7 plain JDBC is confined to the allowlist`). No
class may depend on `org.springframework.jdbc.core..` except the package `..account..` and the
classes `auth.AuthLocks`, `auth.UserStore`, `tenancy.UserDirectory`, `config.SecurityConfig` (the
four classes of ADR-0012) plus `config.JobLocks` and `tenancy.ShopLocks` (the advisory locks of this
phase). Rule 3 now allows native queries in `..sync..` (sequence allocation and change-log reads)
and `..account..` (hard delete and retention) only; rule 4 additionally covers `..sync.web..`,
`..statements.web..`, `..reminders.web..`, `..media.web..` and `..account.web..`. Each rule keeps its
fixture proving it is not vacuous (`archfixtures/jdbc/RawJdbcCaller` is flagged,
`archfixtures/account/AccountJdbcCaller` is accepted). The rule confines where plain SQL may appear;
that the allowlisted classes bind every parameter stays a review matter. ADR-0012 is not rewritten;
this section supersedes its "known gap" paragraph.

## Open points

- Invitations addressed to a deleted user's phone in **other** shops are not removed by account
  completion; they hold that phone number until the retention rule removes them (7 days after they
  expire, at most 24 hours of validity). Deleting them at completion
  (`invitations WHERE phone_e164 = :phone AND accepted_at IS NULL`) is a small follow-up proposal for
  the owner; it is not built.
- A transfer does not cancel the shop's open `SHOP` request itself; the executor cancels it at the
  next run (`owner_changed`). No endpoint reads a shop's deletion state, so the new owner cannot see
  it in between.

## Evidence limits

Outside the reach of the server and not exercised: the SMS provider's own message logs, which hold
customer reminder texts (`not exercised: no provider account`, G4); the Play account-deletion
declaration (G13); backups made before a deletion (Phase 6 runbook); the `/hesap-silme` web page
(Phase 5); the device wipe on the phone (Phase 3); `subscriptions.state = ORPHANED` (Phase 4). The
verification matrix therefore keeps item 21 `partial`.

## Consequences

- Deletion is slow by design (14 days, hourly executor) and visible: the owner can cancel at any
  time before completion.
- A shop that gains a member during grace is never destroyed silently, at the price of an account
  that stays in the blocked state until the owner decides.
- Evidence: `AccountDeletionTest`, `DeletionBlockedTest`, `DeletionCancelTest`, `ShopDeletionTest`,
  `RetentionSweeperTest`, `AccountPermissionTest`, `AccountLogSampleTest`, `V5ServicesSchemaTest`.
