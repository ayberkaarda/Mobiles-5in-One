# ADR-0007: Tenancy and permission enforcement

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec section 6 items 3 and 4 make the server the only authority: a member of shop A must never
read or write shop B, and a `STAFF` member must not perform owner actions. The
[authorization matrix](../security/authorization-matrix.md) listed open decisions D-1, D-2, D-5,
D-6 and D-7 against Phase 1 and Phase 2. This record settles them and fixes the enforcement
design that the endpoints of Phase 1 (shops, invitations, members) and every later tenant endpoint
follow.

## Decision

### Decisions of the matrix

- **D-1, memberships are read on every request.** The access token carries `sub`, `did`, `jti`,
  `iat`, `exp` and `iss`, no roles ([ADR-0005](0005-session-model.md)). A removed member loses
  access on the next request with the same token (`TenantIsolationTest`, "membership is read on
  every request"). The cost is one indexed read per tenant request.
- **D-2, `STAFF` may not list members.** `GET shops/{id}/members` needs `MEMBERS_MANAGE`.
- **D-5, `EXPORT_ALL` is accepted as an action gate, not a confidentiality boundary.** The app is
  offline first (spec story 8), so every member device holds the whole ledger of its shop by
  design. `EXPORT_ALL` gates bulk export (CSV and share, Phase 3 UI). `sync/pull` stays
  `CUSTOMER_READ` plus `LEDGER_READ` for both roles. There is no server export endpoint in the
  MVP; a future one would carry the action. The threat model row "Elevation of privilege" states
  the same.
- **D-6, one owner per shop; the owner cannot remove themselves.** A partial unique index
  `memberships_one_owner ON memberships (shop_id) WHERE role = 'OWNER'` enforces one owner in the
  database. `DELETE shops/{id}/members/{userId}` on the caller's own id or on an `OWNER` row is
  `409 membership.owner_locked`.
- **D-7, ownership transfer is deferred to Phase 2** together with the deletion flow it serves
  (spec item 21). Its shape is fixed now so the matrix row exists:
  `POST shops/{id}/ownership-transfer` with body `{userId}` of an existing `STAFF` member, action
  `MEMBERS_MANAGE` plus a fresh OTP re-verification (`purpose=REAUTH`); the caller becomes `STAFF`
  and the target `OWNER` in one transaction. No new `Permission` is added. The product spec API
  list has no such endpoint; this is a spec gap for the owner to decide, not scope added here.
- **D-3, D-4** keep their draft answer (yes) and are settled in Phase 2; **D-8** Phase 2;
  **D-9, D-10** Phase 4.

### 404 convention

A caller who is not a member of the shop in the path, an unknown shop, a deleted shop and a member
id that belongs to another shop all get the same `404 not_found` body (apart from `traceId`). A
member whose role lacks the action gets `403 forbidden`. Existence of a tenant is never revealed to
an outsider. `TenantIsolationTest` compares the bodies.

### Enforcement design

- `PermissionEvaluator`, bean name `perm`, method `can(shopId, action)`. Every tenant handler
  carries `@PreAuthorize("@perm.can(#shopId, '<CODE>')")` with the exact `Permission.code`. The
  evaluator reads the membership from the database, takes the principal from the security context
  and decides with `PermissionMatrix`. With no membership it throws `ProblemException(not_found)`
  from inside the expression, so 404 wins over 403. An unknown action code throws (500) and never
  grants.
- `TenantContext(shopId, userId, role)` is a plain value created by
  `MembershipResolver.resolve(shopId, currentUser)`, which throws `not_found` when there is no
  membership or the shop is deleted. There is no thread-local: services receive the context as a
  parameter.
- Defence split: `@PreAuthorize` enforces the action and is the single tested authority; services
  re-resolve the membership inside their transaction (404 if it vanished) but do not re-check the
  action. `PermissionEnforcementTest` ties the annotation codes to the matrix.
- Tenant repositories extend `TenantRepository<T>`, a marker over Spring Data `Repository` that
  declares only `save` and `delete` and inherits no `findById`. Every other method must have a
  `shopId` parameter. Entities implement `TenantScoped`. `ArchitectureTest` rules 1, 2 and 4 check
  this ([ADR-0012](0012-architecture-rules-and-test-strategy.md)).
- Two tenant-discovery queries are keyed by something other than a client-supplied shop id and sit
  outside tenant repositories, both JPQL with bound parameters: `MembershipQuery.membershipsOf`
  (the caller's own memberships, used by `GET /v1/me`) and `InvitationCodeIndex.shopIdOf` (an
  invitation code is a capability that selects its shop; only the shop id is returned and the row
  is then read through the tenant repository).
- `POST /v1/shops` and `POST /v1/invitations/{code}/accept` have no shop in the path and are
  annotated `isAuthenticated()`, because architecture rule 4 requires an annotation on every
  tenancy handler.

### Invitations

Code of 8 characters from the Crockford base32 alphabet without `I L O U`, drawn with
`SecureRandom`, stored as the hex `HMAC-SHA256(CETELE_OTP_PEPPER, "cetele.invitation.v1|" + code)` of the canonical code (64 lowercase hex characters, so the column check is unchanged), valid 24 hours, returned once, at
most 5 open invitations per shop (`409 conflict`), bound to the invited phone. Accepting needs the
same phone as the invited one; a malformed, unknown, expired, used, foreign-phone or deleted-shop
code is the same `404`. Accepting while already a member is `409 membership.already_member` and
does not consume the code (the caller proved phone ownership, so nothing leaks). Accepting is
limited to 10 attempts per 10 minutes per user ([ADR-0009](0009-rate-limiting-and-client-ip.md)).

Open invitations are closed, in the same transaction, when they can no longer be honest: accepting
a code closes every other open code of that phone in that shop, and removing a member closes every
open invitation of that shop for the removed member's phone, so a removed member cannot rejoin
with a second code issued earlier. Closing sets `expires_at` to now (never before `created_at`, so
the schema check holds); other phones and other shops are untouched, and a fresh invitation after
a removal works.

## Consequences

- The shop filter lives in repositories and is checked by tests and four architecture rules, not by
  the database. A new query that ignores `shopId` is caught by rule 2 only when it is declared in a
  tenant repository; raw SQL is covered by rule 3 for native queries, and plain JDBC is covered
  only by review ([ADR-0012](0012-architecture-rules-and-test-strategy.md)).
- Invitation hashes are keyed with the OTP pepper, so an offline copy of `invitations` alone does
  not allow brute-forcing the 40-bit codes. Consequences, accepted: the pepper must be present at
  accept time, and rotating `CETELE_OTP_PEPPER` invalidates every open invitation (at most 24
  hours of validity); in `local` and `test` the random startup pepper means open invitations die
  on every restart. A leaked pepper together with a leaked table restores the brute-force risk.
- Accepted residual: `STAFF` can read the whole ledger through sync (D-5). Timing differences
  between the 404 of a missing and a foreign shop are not measured.
- Evidence: `TenantIsolationTest`, `PermissionEnforcementTest`, `InvitationFlowTest`,
  `OneOwnerInvariantTest`, `ShopValidationTest`, `MembershipQueryTest`, `V3TenancyMigrationTest`,
  `PermissionMatrixTest`, `ArchitectureTest`.
