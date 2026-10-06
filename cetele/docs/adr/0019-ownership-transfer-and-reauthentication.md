# ADR-0019: Ownership transfer and re-authentication

- Status: Accepted
- Date: 2026-10-06
- Deciders: Ayberk (owner)

## Context

Three actions are destructive or hand over control of a shop: deleting the account, deleting a shop
and transferring ownership ([ADR-0018](0018-account-and-shop-deletion.md)). A stolen unlocked phone
with a valid session should not be enough for any of them, so each asks for a fresh proof that the
caller still controls the phone number. Decision D-7 of the
[authorization matrix](../security/authorization-matrix.md) fixed the shape of the transfer in
[ADR-0007](0007-tenancy-and-permission-enforcement.md) and deferred the build; spec item 21 cannot be
met without it, because an owner of a shared shop must be able to hand it over before deleting an
account.

## Decision

### Re-authentication (`REAUTH`)

- `POST /v1/auth/reauth/request` takes a bearer token (`isAuthenticated()`), no integrity token and
  no body. It sends a six-digit code to the caller's own phone through the shared SMS gateway
  ([ADR-0016](0016-sms-reminders-and-netgsm-client.md)) and answers 202 with an empty body. Limits:
  `reauth.request.user` 3 per 10 minutes, and the existing phone bucket `otp.phone` after it.
- The code is an `otp_codes` row with `purpose = REAUTH`; the column check has allowed the value
  since Phase 1. `OtpService.issue` and `check` take the purpose, and the lookup of the newest open
  code is per `(phone, purpose)`: a `LOGIN` code is never accepted as `REAUTH` and the other way
  round, and both can be open at the same time. A `REAUTH` code keeps the rules of
  [ADR-0005](0005-session-model.md): five minutes, five attempts, single use, bound to the device of
  the request, HMAC stored.
  - `ReauthOtpTest`: `login and reauth can be open together and cannot replace each other`
  - `ReauthOtpTest`: `reauth expires at five minutes and closes on the fifth wrong attempt`
- The code travels in the body of `DELETE /v1/me`, `DELETE /v1/shops/{shopId}` and
  `POST /v1/shops/{shopId}/ownership-transfer`. `ReauthVerifier.require` charges
  `reauth.verify.user` (10 per 10 minutes), checks the code, and on failure answers
  **`403 auth.reauth_invalid`**, not 401: the session is valid, the step-up failed, and a 401 would
  make the app sign the user out. The failed attempt is committed before the 403, as at sign-in.
  - `ReauthTest`: `request sends to caller device and consumes the code once`
  - `ReauthTest`: `login code is refused and wrong attempts commit before correct verification`
  - `ReauthTest`: `fourth request and eleventh verification are rate limited`
- A code is consumed by the first successful check, so every destructive call needs its own fresh
  code, and a request that fails for another reason after the check (for example a transfer to a user
  who is not a member) has already used it.

### Ownership transfer

`POST /v1/shops/{shopId}/ownership-transfer` (`MEMBERS_MANAGE`, body `{userId, code}`; no new
action) answers 200 `{shopId, ownerUserId, previousOwnerUserId}`. Checks in order: the `REAUTH`
code; a target equal to the caller is `409 membership.owner_locked`; a target that is not an active
`STAFF` member of this shop is 404 (a member of another shop and an unknown id look the same). In
one transaction the caller is demoted to `STAFF` first and the target promoted to `OWNER`, because
the partial unique index on one owner per shop is checked per statement
([ADR-0007](0007-tenancy-and-permission-enforcement.md), D-6); the promotion must change exactly one
row. The transfer clears `blocked_at` on the caller's open account deletion request, if any. If the
promotion fails the demotion is rolled back and the caller stays `OWNER`.

- `OwnershipTransferTest`: `roles swap and exactly one owner remains`
- `OwnershipTransferTest`: `foreign target self and wrong code never alter ownership`
- `OwnershipTransferTest`: `database rejection of promotion rolls back demotion`
- `OneOwnerInvariantTest` (Phase 1) still holds.

### Product spec

The endpoint is not in the product spec API list. Each of the Phase 2 additions exists because a
spec story or item 21 cannot work without it; none adds a feature. The lead lists them in the spec
after the gate: `POST auth/reauth/request`, `DELETE me/deletion`, `DELETE shops/{id}`,
`DELETE shops/{id}/deletion`, `POST shops/{id}/ownership-transfer`,
`POST shops/{id}/media/{mediaId}/complete`, `GET shops/{id}/media/{mediaId}`.

## Consequences

- A thief with an unlocked phone and a live session still needs the SMS to the same number to delete
  or hand over anything. A SIM swap defeats this, as it defeats sign-in itself.
- The REAUTH SMS costs money and has its own small bucket; it does not count toward the reminder
  quota (only `REMINDER` sends do, [ADR-0016](0016-sms-reminders-and-netgsm-client.md)).
- Real SMS delivery of the code is not exercised (`not exercised: fake gateway only`, G4).
- Evidence: `ReauthTest`, `ReauthOtpTest`, `OwnershipTransferTest`, `OneOwnerInvariantTest`,
  `AccountPermissionTest`, `AccountLogSampleTest`.
