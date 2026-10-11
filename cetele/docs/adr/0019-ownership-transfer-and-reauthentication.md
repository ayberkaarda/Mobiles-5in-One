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
  a required body `{action, shopId?}` with `action` one of `ACCOUNT_DELETE`, `SHOP_DELETE`,
  `OWNERSHIP_TRANSFER`, `DEVICE_SIGN_OUT`; shop actions need `shopId` and an `OWNER` caller of a live
  shop, otherwise 404 and no SMS. A request without a body is refused and sends no SMS. This is a
  breaking change of the hardening round; Android ships the matching call in package P5. It sends
  a six-digit code to the caller's own phone through the shared SMS gateway
  ([ADR-0016](0016-sms-reminders-and-netgsm-client.md)) and answers 202 with an empty body. Limits:
  `reauth.request.user` 3 per 10 minutes and 10 re-authentication codes per phone in 24 hours
  (counted in `otp_codes`, [ADR-0005](0005-session-model.md)); the request no longer charges the
  sign-in bucket `otp.phone`.
- The code row stores its scope (`otp_codes.scope`, `ACTION` or `ACTION:shopId`, migration V9, which
  also closed every open `REAUTH` code), and `ReauthVerifier.require` accepts it only for the same
  action and shop; a scope mismatch counts as a wrong attempt and answers the same 403
  `auth.reauth_invalid`. The SMS names the action, says that it is not a sign-in code and carries
  no user-controlled text (no shop or user name).
  - `ReauthTest`: `missing body invalid action and unowned shop send no SMS`
  - `ReauthTest`: `shop and action mismatches count as wrong attempts and leave the correct scope usable`
  - `ReauthTest`: `three reauth requests leave the login phone bucket available`
  - `ReauthOtpTest`: `reauth SMS names every action and distinguishes the login code`
  - `ReauthOtpTest`: `fifth scope mismatch closes the code even when its digits and device match`
  - `V9ReauthScopeSchemaTest`: `V9 closes old open reauth codes and preserves login and consumed rows`
- The code is an `otp_codes` row with `purpose = REAUTH`; the column check has allowed the value
  since Phase 1. `OtpService.issue` and `check` take the purpose, and the lookup of the newest open
  code is per `(phone, purpose)`: a `LOGIN` code is never accepted as `REAUTH` and the other way
  round, and both can be open at the same time. A `REAUTH` code keeps the rules of
  [ADR-0005](0005-session-model.md): five minutes, five attempts, single use, bound to the device of
  the request, HMAC stored.
  - `ReauthOtpTest`: `login and reauth can be open together and cannot replace each other`
  - `ReauthOtpTest`: `reauth expires at five minutes and closes on the fifth wrong attempt`
- The code travels in the body of `DELETE /v1/me`, `DELETE /v1/shops/{shopId}` and
  `POST /v1/shops/{shopId}/ownership-transfer`, and since the hardening round of
  `POST /v1/me/devices/{id}/sign-out` ([ADR-0005](0005-session-model.md)). `ReauthVerifier.require` charges
  `reauth.verify.user` (10 per 10 minutes), checks the code, and on failure answers
  **`403 auth.reauth_invalid`**, not 401: the session is valid, the step-up failed, and a 401 would
  make the app sign the user out. The failed attempt is committed before the 403, as at sign-in.
  - `ReauthTest`: `request sends to caller device and consumes the code once`
  - `ReauthTest`: `login code is refused and wrong attempts commit before correct verification`
  - `ReauthTest`: `fourth request and eleventh verification are rate limited`
- A code is consumed by the first successful check, so every destructive call needs its own fresh
  code. State checks (open request, shared shop, role, target eligibility) run before the code is
  checked, so a refusal for another reason leaves the code usable; only a race between the
  pre-check and the locked re-check can still consume it.
  - `ReauthTest`: `pending account refusal preserves code for use after cancellation`
  - `ReauthTest`: `shared shop refusal preserves code for explicit deletion choice`
  - `ReauthTest`: `pending shop refusal preserves code after cancellation`

### Ownership transfer

`POST /v1/shops/{shopId}/ownership-transfer` (`MEMBERS_MANAGE`, body `{userId, code}`; no new
action) answers 200 `{shopId, ownerUserId, previousOwnerUserId}`. Checks in order, all before the
`REAUTH` code (scope `OWNERSHIP_TRANSFER:shopId`) is checked: a target equal to the caller is
`409 membership.owner_locked`; a target that is not an active `STAFF` member of this shop, or has any
open account deletion request, inside or after its grace period, is 404 (a member of another shop
and an unknown id look the same). The transaction first locks both user rows in ascending id order and then the shop, the same
order as the deletion executor, and re-checks the target's eligibility (active `STAFF` member,
account not being deleted) under those locks; if the target is gone or no longer eligible the
answer is 404. Then the caller is demoted to `STAFF` first and the target promoted to `OWNER`, because
the partial unique index on one owner per shop is checked per statement
([ADR-0007](0007-tenancy-and-permission-enforcement.md), D-6); the promotion must change exactly one
row. The transfer clears `blocked_at` on the caller's open account deletion request, if any, and cancels
the caller's open `SHOP` deletion request of this shop in the same transaction, so the new owner
never inherits it. If the
promotion fails the demotion is rolled back and the caller stays `OWNER`.

- `OwnershipTransferTest`: `roles swap and exactly one owner remains`
- `OwnershipTransferTest`: `foreign target self and wrong code never alter ownership`
- `OwnershipTransferTest`: `database rejection of promotion rolls back demotion`
- `OwnershipTransferRaceTest`: `transfer to a user whose account deletion is running waits and then finds the user gone`
- `OwnershipTransferTest`: `target with open account deletion is refused during and after grace without consuming code`
- `OwnershipTransferTest`: `ineligible and self targets preserve the transfer code`
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
- Known limitation: the target does not accept a transfer; an owner can only hand a shop to a member
  it already trusts as `STAFF`, and the target can transfer it back. A two-step offer and accept
  flow was judged out of proportion for this scope.
- Evidence: `ReauthTest`, `ReauthOtpTest`, `OwnershipTransferTest`, `OwnershipTransferRaceTest`, `OneOwnerInvariantTest`,
  `AccountPermissionTest`, `AccountLogSampleTest`, `V9ReauthScopeSchemaTest`.
