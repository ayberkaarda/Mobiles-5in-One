# ADR-0032: Account deletion — request, grace period and hard delete

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 item 21; ADR-0005, ADR-0008, ADR-0009, ADR-0012, ADR-0025, ADR-0028,
  ADR-0029, ADR-0030, ADR-0033; authorization matrix §3.2 footnotes 4–5; threat model T-DEL-01..08

## Context

Item 21 requires in-app and web deletion: re-authentication, immediate deactivation, a 7-day grace
period that a login cancels, then a worker job that removes personal data, R2 objects and invites,
anonymises match history, deletes solo-owned teams, transfers captaincy of shared teams, deletes
the RevenueCat subscriber, sends a confirmation email and writes an audit row without personal
data. Phase 1 already implements the cancel-on-login rule and `deletion_requests`.

## Decision

### 1. Request (`DELETE me`)

- Proof: single-use re-authentication (password, or a provider identity token with `iat` ≤ 5 min)
  plus, for staff, a fresh TOTP code (missing proof → 401 `reauth_required`, missing TOTP → 401
  `step_up_required`); the last active admin is refused with 409 `last_admin`
  (ADR-0009). Rate limit group D: 5 attempts per 15 min per user, because the endpoint verifies a
  password.
- One transaction, holding a lock on the user row:
  1. insert `deletion_requests` (`grace_until = now() + 7 days`); an existing pending request →
     409 `deletion_pending`;
  2. set `users.deactivated_at = now()`;
  3. revoke every refresh token and web session (ADR-0025) and delete every push token;
  4. set the user's RSVPs on `open` and `locked` matches that have not started to `out` (waitlist
     promotion and captain notification run as for any drop-out) and withdraw pending open-call
     applications; teams, roles and `played` history are untouched during the grace period;
  5. enqueue `account.hard_delete` with `startAfter = grace_until`, idempotency key
     `delete:<deletionRequestId>`, and `email.send` kind `deletion_scheduled`;
  6. write audit `account.deletionRequested` (target `deletion_request`, no metadata).
- Response 202 `{ graceUntil }`; the client discards its tokens.

### 2. Grace period

- Every authenticated request answers 401 `account_deactivated` (ADR-0012); refresh fails because
  every family is revoked.
- A successful login (password or provider) within the grace period deletes the pending request,
  clears `deactivated_at` and writes `auth.deletionCancelled` (implemented in Phase 1). RSVPs set to
  `out` are not restored. The queued hard-delete job then finds no pending request and completes
  without effect.
- Registering again with the same email during the grace period behaves as for any existing
  account (ADR-0015).

### 3. Hard delete (`account.hard_delete`, payload `{ deletionRequestId }`)

Preconditions, checked under a lock on the deletion request: request exists, `completed_at IS NULL`,
`grace_until ≤ now()`, user still deactivated. Otherwise complete without effect.

**External cleanup first** (idempotent, safe to repeat on retry):

1. Delete R2 objects: every published object under `avatars/{userId}/` and every incoming object
   under `incoming/avatar/{userId}/`; for each team that step 3 below will delete, every object
   under `badges/{teamId}/` and `incoming/badge/{teamId}/`.
2. RevenueCat: delete the subscriber through the REST API. Until Phase 5 provides the RevenueCat
   credentials and webhook processing, this step is skipped and `deletion_requests.external_pending`
   records `revenuecat`; the Phase 5 reconciliation job processes those rows. No subscription can
   exist before Phase 5, so nothing is left behind in the meantime.

**Then one database transaction:**

3. Teams where the user is captain:
   - other members exist → captaincy transfer with the ADR-0008 routine to the oldest co-captain
     by `joined_at`, else the oldest member. The free-tier owned-team limit does not block this
     transfer (a team must not lose its captain); if the new captain is not entitled to own another
     team, the team is set `is_pro_locked = true` (matrix §7). Audit `team.captaincyTransfer` with
     `metadata.reason = 'account_deleted'`.
   - no other member → the team is deleted with its matches, invites, open calls and applications
     (cascades). Guests' RSVPs on those matches go with them; this is accepted, the team's history
     has no remaining member.
4. Memberships: delete the user's `team_members` rows; delete RSVPs on `draft`, `open` and `locked`
   matches (ADR-0005 rules, waitlist promotion runs).
5. History: create the tombstone of ADR-0033 and re-point the user's remaining `match_rsvps`
   (`played` and `cancelled` matches) and both sides of `mvp_votes` to it.
6. Content: delete `venue_reviews` and `open_call_applications` by the user; set
   `venues.created_by = NULL` (venues stay, they are directory data). Update (ADR-0044): also
   delete the user's pending push re-sends (`push_resends`, no foreign key to cascade).
7. Delete the `users` row. Cascades remove `refresh_tokens`, `email_tokens`, `push_tokens`,
   `subscriptions`, `uploads`; `audit_logs.actor_id` and `deletion_requests.user_id` become `NULL`.
8. Set `deletion_requests.completed_at = now()`; write audit `account.deleted`, actor `NULL`,
   target the deletion request, `metadata = { teamsDeleted, teamsTransferred, objectsDeleted }`.
   No email, name, display name or user id in `metadata`.

**Confirmation email.** The address is gone after commit and must not be written into a job
payload. The handler therefore sends the `deletion_completed` email itself, after step 7 and before
`COMMIT`, with a 10 s timeout. A send failure is logged (`email_delivery_failed`) and **does not
block** the commit: completing the deletion has priority over confirming it. If the commit fails
after a successful send, the retry sends the email again (accepted duplicate).

### 4. What remains, by design

- `audit_logs` rows keep pseudonymous ids (`target_id`, ids in `metadata`) that no longer resolve to
  a person; the table is append-only.
- Rate-limit buckets keyed by HMAC of the email expire within their window.
- Backups contain the deleted data for up to 30 days (RR-2); logs for up to 30 days, without
  emails (masked) or tokens.

## Consequences

- Within one request the account stops working everywhere; within 7 days plus at most one sweep
  interval it is gone. `maintenance.sweep` re-queues overdue requests (ADR-0028).
- The Phase 6 end-to-end proof searches every table for the deleted user's id, email and display
  name and expects no match outside `audit_logs` id references.
- Schema changes (handoff `decisions-to-db-001`): `deletion_requests.external_pending text[]`,
  tombstone support (ADR-0033). Contracts: `deletion_pending` error code, `DELETE me` body with the
  re-auth proof (handoff `decisions-to-contracts-001`).

## Rejected alternatives

- **Delete the RevenueCat subscriber at request time (as item 21 lists it).** A login within the
  grace period cancels the deletion, but a deleted subscriber cannot be restored; the subscription
  would detach from the account. Deleting at hard-delete time keeps cancellation lossless.
- **Leave RSVPs untouched during the grace period.** Teams would plan with a player who cannot open
  the app for a week.
- **Put the email address into the completion job payload.** Job rows and their archives would
  then hold personal data after the account is gone.
- **Block hard delete until the confirmation email is accepted.** A provider outage would keep
  personal data beyond the promised period.

## Amendment: team deletion by the captain (2026-10-02)

Step 3 deletes a team only when the deleted user is its sole member, and transfers it otherwise.
`DELETE teams/:id` now follows the same line for history: a team with at least one `played` match
and any member besides the captain cannot be deleted (409 `team_has_history`, matrix §3.3
footnote 34); a solo team is deleted with its matches, as in step 3. Only `played` counts as
history. Matches in `cancelled` are not history: a shared team that has only cancelled (or no)
matches is still deleted with its cascades, including the RSVPs that step 5 would otherwise keep for
`cancelled` matches. The hard-delete job is unchanged and does not go through this endpoint.

Known limits: a captain can remove the other members first and then delete the solo team
(ADR-0008 amendment); when step 3 transfers a team to a free-tier member who already owns a team,
the team becomes `is_pro_locked` (matrix §7), whereas the same transfer through the API is refused
with 403 `entitlement_required`.
