# ADR-0041: Listing the applications of an open call

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 6, §5; ADR-0003, ADR-0010, ADR-0013, ADR-0037, ADR-0039;
  authorization matrix §3.5 footnote 33, §5, §6; threat model T-OC-10, T-OC-11; handoff
  `contracts-to-security-001` item 5

## Context

Captains and co-captains decide applications (`PATCH open-calls/:id/applications/:appId`), but
§5 of the product spec has no endpoint that lists them. Staff would learn about applications only
through the `application.received` push and its `applicationId`; a missed or coalesced push
(ADR-0031) would leave an application undiscoverable. Applicants also need to see the state of
their own application.

## Decision

New endpoint `GET /api/v1/open-calls/:id/applications`, policy action `application.list`.

- **Who can read**
  - Captain and co-captain of the team that owns the call's match: every application of the call.
  - The applicant (any authenticated user with an application on this call, including a match
    guest): **only their own row**, as a list of at most one item.
  - Everyone else (unrelated users, team players, match guests without an application,
    moderators and admins without a team role, ADR-0007) → 404, identical to an unknown call
    (ADR-0013: no read relationship). Anonymous → 401.
- **Scope query**: the call is loaded with its match and team; the list query is
  `open_call_applications.open_call_id = :id AND (staff(actor, team) OR user_id = :actor)`; when
  neither holds, 404 before any row is read.
- **Query**: `status` (optional, one of `pending | accepted | rejected | withdrawn`), `cursor`,
  `limit` (1..100, default 20). Sort `(created_at, id)` ascending, keyset cursor with filter
  fingerprint (ADR-0039); malformed or cross-filter cursor → 400 `invalid_cursor`.
- **Response 200**: `{ items, nextCursor }`, each item the existing `Application` shape:
  `id`, `openCallId`, `applicant` (`id`, `displayName`, `avatarUrl`, `position`, `level`),
  `message`, `status`, `createdAt`, `updatedAt`. Never the applicant's email, district, phone,
  other applications or other teams. `message` is plain text (rendered as text, ADR-0037).
- **Allowed in every call state** (`open`, `closed`, `expired`, `removed`), so staff can review the
  history of a closed call; tombstoned applicants do not appear because hard delete removes their
  applications (ADR-0032).
- **Rate limit**: none (read; the same as the other list endpoints). Email verification is not
  required for reading.

## Consequences

- Staff can always find pending applications without relying on push delivery.
- The applicant sees their own status without a separate endpoint.
- Contracts: registry entry, `application.list` action, query schema (handoff owner:
  `packages/contracts`); `packages/auth`: rule and table rows; `apps/web`: route and IDOR rows.

## Rejected alternatives

- **Embed applications in `GET matches/:id` for staff.** Mixes a team-private match view with
  data from outside the team and cannot be paginated.
- **Return 403 to team players.** They have no read relationship to applications (ADR-0013 rows
  for `application.decide`), so 404 keeps the existing semantics.
