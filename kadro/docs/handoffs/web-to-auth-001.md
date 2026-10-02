# Handoff web → auth 001

- From: `apps/web` `DELETE me` (ADR-0032, matrix §3.2 footnotes 4 and 5)
- To: owner of the admin TOTP step-up (`POST admin/step-up`, `POST admin/totp/enroll`) and of
  `lib/server/auth`
- Status: open

## 1. Staff account deletion fails closed until TOTP verification exists

`DELETE me` requires a fresh TOTP code from `moderator` and `admin` accounts. No TOTP enrollment,
secret encryption key or verifier exists yet, so
`apps/web/lib/server/account/reauth.ts` `verifyStaffTotp()` always answers `false`: every staff
deletion request ends in 401 `step_up_required` (tested in `tests/account/deletion.test.ts`). The
last-admin rule (409 `last_admin`, all active admin rows locked in id order) is implemented behind
it and becomes reachable once the verifier is real.

Request: when TOTP enrollment ships, replace `verifyStaffTotp()` with the real check (decrypt
`totp_secret_enc`, ±1 step, store `totp_last_used_step` so a code cannot be replayed, matrix footnote 26) and add a test that a staff member with a valid code reaches 202, and that the last
active admin gets 409 `last_admin`.

## 2. Cancellation by sign-in: already in place, now covered end to end

`auth/account-state.ts` `admitSignIn()` (ADR-0012) cancels a pending deletion within the grace
period and refuses afterwards. `tests/account/deletion.test.ts` covers the full loop: `DELETE me`
→ password sign-in within the grace period → request row gone, `deactivated_at` cleared,
`auth.deletionCancelled` audit, the queued `account.hard_delete` job left to complete without
effect; after the grace period the same sign-in answers 401 `account_deactivated`. No change is
needed in the sign-in files.

## 3. `avatarUrl` in `toMeResponse()`

See `web-to-teams-001`: `lib/server/auth/profile.ts` still returns `avatarUrl: null`; the helper is
`lib/server/uploads/urls.ts` `mediaUrl()`.
