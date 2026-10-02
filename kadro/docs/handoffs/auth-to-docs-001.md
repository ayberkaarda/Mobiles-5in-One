# Handoff auth → docs (security / ADR owner) 001

- From: `packages/auth` (Phase 1)
- To: owner of `docs/security/authorization-matrix.md` and `docs/adr/`
- Status: resolved (matrix §9.1 updated; ADR-0018 and ADR-0019 written; section 3 items recorded in threat model T-AUTH-04, T-AUTH-05, T-AUTH-08, T-AUTH-09)

The matrix change rule requires document and code to agree. `packages/auth/src/policies.ts`
implements every cell of §3; these points differ from the text of §9.1 and need a doc update.

## 1. Matrix §9.1 policy module shape

- File is `packages/auth/src/policies.ts` (the doc says `packages/auth/policies.ts`).
- `can(actor, action, resource = {}, options = { now })`: the optional fourth argument supplies
  the clock for the step-up window.
- `ActorContext` adds `deactivated: boolean` so `can()` itself returns 401
  `account_deactivated` (fixture `uDeactivated`).
- `Decision` deny status is `401 | 403 | 404 | 409`. 409 is returned only where the matrix cell
  itself is 409 and the policy facts already decide it: `invite.accept` and `application.create`
  by members / participants (`conflict`) and the captain leaving (`captain_must_transfer`).
  Allowed match-scoped decisions carry `projection: 'member' | 'guest'` (footnote 11).
- `ResourceContext` adds: `newTeamRole`, `targetOwnedTeams`, `targetIsPro` (captaincy transfer
  entitlement), `actorOwnedTeams` (team.create limit), `teamProLocked`, `venuePublic`
  (verified or sample), `reauthenticated`, `freshTotp`. A fact the evaluation needs but the handler
  did not pass throws `PolicyContextError` (fail closed, programming error).
- Re-auth missing → 401 `unauthenticated`; staff `me.delete` without TOTP → 401
  `step_up_required` (see handoff auth-to-contracts-001 for a proposed `reauth_required` code).

## 2. Proposed ADR-0018: HIBP breach check fails open

- Decision: registration and reset call the Pwned Passwords range API (k-anonymity, 5-character
  SHA-1 prefix, `Add-Padding: true`, 1.5 s timeout). A breached password is refused with 422
  `password_breached`. When the API is unreachable, times out, answers non-2xx or with a malformed
  body, the password is **accepted** and the verdict reports `breachCheck: 'unavailable'` so the API
  logs a metric.
- Reason: account creation must not depend on a third-party service; the length rule (10..128),
  Argon2id (m=64 MiB, t=3, p=1) and the auth rate limits (group A) stay in force. Fail closed would
  turn an HIBP outage into a registration outage.
- Consequence: during an outage a breached password can be set; it is not re-checked later.

## 3. Other implementation choices to record

- Email token lifetimes: verify 24 h, reset 1 h (`EMAIL_TOKEN_TTL_SECONDS`).
- Refresh rotation sets the new row's expiry to `now + TTL` (sliding 30 days for mobile); every
  rotation revokes its predecessor, so presenting any revoked token is reuse and revokes the family.
- CSRF tokens are HMAC-signed with `CSRF_SECRET` and bound to the web session's refresh family id,
  so they survive cookie rotation.
- Access token `typ` header is `at+jwt`; `kid` is the RFC 7638 thumbprint of `JWT_PUBLIC_KEY`;
  `aud` is `kadro-api`; clock tolerance 5 s.
