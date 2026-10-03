# ADR-0054: Mobile profile, statistics and settings, including account deletion

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 items 9 and 11, §5 (`me` endpoints, uploads), §6 items 7 and 21, §8
  (i18n); ADR-0012, ADR-0030, ADR-0032, ADR-0047, ADR-0048, ADR-0049, ADR-0050, ADR-0052;
  authorization matrix §3.2 footnotes 4–5, §4.1, footnote 31 (uploads)

## Context

The Profil tab of the mobile foundation (ADR-0047) showed the name and email and a sign-out
button. Players need to keep their position, level and district current (the district is the one
a new team gets, ADR-0050), see the statistics of spec item 9, choose the app language, turn on
notifications for this device, read the legal pages, and delete the account from the app (Apple
App Review guideline 5.1.1(v), security checklist item 21). The API for this exists:
`GET`/`PATCH me`, `GET me/stats`, `DELETE me`, `POST me/push-tokens`, `POST uploads/presign`,
`POST uploads/:id/complete`, `GET uploads/:id`, `GET districts`. Facts of that API that shape the
client:

- `DELETE me` needs a single-use re-authentication proof (the current password, or a provider
  identity token at most five minutes old for social-only accounts) and, for staff, a fresh TOTP
  code; it answers 202 `{ graceUntil }` and revokes every session at once;
- there is no cancel endpoint: a successful sign-in during the 7-day grace period cancels the
  deletion (ADR-0012), and the sign-in answer does not say that it did;
- logout revokes the presented refresh-token family only; there is no "sign out everywhere";
- `PATCH me` accepts only the self-writable fields and refuses an empty body; the avatar is set by
  the upload worker, the client can only remove it (`avatar: null`).

## Decision

### Routes

- `(tabs)/profil` shows the profile: photo (or initials), name, email, Pro state when the
  `entitlements` member says so, position, level, district and the statistics card, with "edit"
  and "settings". `profil/duzenle` edits the profile; `ayarlar` holds the settings and
  `ayarlar/hesabi-sil` the deletion. All three are in the signed-in guard.
- `ayarlar/hesap-silindi` explains the grace period after a request. It is registered outside both
  guards (like the email-link screens), because the request ends the session and a guarded screen
  would close before the user read it. It is opened before the local sign-out runs.

### Profile and statistics

- `me` and `me/stats` stay under the `me` query root, which is not persisted: both are personal
  (ADR-0047 keeps `me` off the device for the email and providers).
- A failure of `me` shows the error with request id and retry; settings stay reachable from the
  failure state so a user can still sign out or delete. A failure of the statistics stays inside
  their card with its own retry. A refetch failure over a shown profile shows the "saved data"
  notice.
- The statistics show matches played and MVP count; the `advanced` block only when the server
  answered with the `full` tier (the entitlement is decided server side, matrix §7).
- The district name comes from `GET districts` (open-call key, persisted reference data); a
  missing name shows "could not be loaded", never a guessed one.

### Editing

- react-hook-form with the shared check resolver (`src/auth/forms.ts`): the display name uses the
  registration rule, which a test compares with `displayNameSchema`; position, level and district
  are choices from fixed lists (positions and levels compared with the contract lists). The
  district uses the open-call district picker (`src/calls/components.tsx`), so there is one
  picker in the app.
- Only changed fields are sent, the name trimmed; nothing changed means no request. The answer
  replaces the cached `me`, so the create-team screen sees a new district at once; team and match
  details refetch in the background when the name or photo changed. Field errors of a
  `validation_failed` answer (`body.<field>`) mark that field; the form error shows the catalog
  copy and request id.
- Photo: "remove" sends `avatar: null` after a confirmation. "Change" follows ADR-0030 end to end
  up to the picker: type (JPEG, PNG, WebP) and size (1 byte .. 2 MiB) are checked on the device,
  presign carries only kind, type and the exact byte length, the PUT goes to object storage with
  exactly the signed headers and without the bearer token, then `complete`, then up to four
  status reads (1, 2, 3, 4 s); ready refetches `me`, rejected says so, still processing says the
  photo appears shortly. The app has no image picker module, so the picker port is `null` and the
  control is hidden; adding the module only sets that port.

### Settings

- Language: Turkish or English, applied at once and remembered in AsyncStorage
  (`kadro.language`, a device preference with no account data, kept across sign-outs). At start
  the root layout applies it over the device language of ADR-0048.
- Notifications: a port over `expo-notifications`. Without an EAS project id in the build (local
  builds today) push is reported as unavailable. Otherwise the screen reads the permission; the
  system prompt and the registration (`POST me/push-tokens` with token and platform; the owner is
  the session's user) run only on a tap. The token is checked against the contract pattern first.
  Whether this device registered is kept in memory and reset at every sign-out. Receiving and
  opening notifications belong to the deep-link and push work.
- Legal pages: links to `/gizlilik`, `/kvkk-aydinlatma` and `/hesap-silme` on
  `EXPO_PUBLIC_WEB_ORIGIN` when it is an https origin, else a "not set up" notice. They are
  labelled as sample texts.
- Sign-out: this device only (logout with the stored refresh token, then the local cleanup of
  ADR-0047); the screen says other devices stay signed in, because the contract has no global
  sign-out.

### Account deletion

- First an explanation of what happens now (account closed, every device signed out,
  notifications stopped, upcoming RSVPs set to "not coming", pending applications withdrawn), in
  the grace period (sign-in cancels; RSVPs are not restored), after it (personal data removed,
  history shown as a deleted user, solo teams deleted, captaincy transferred) and about store
  subscriptions; then a confirmation to continue.
- Proof by account: a password account enters its password; a social-only account linked to Apple
  confirms with a fresh Apple token (new raw nonce, its SHA-256 to Apple, raw nonce and token to
  the server, used at once); a Google-only account, or an Apple account on a device without Apple
  sign-in, is sent to the web deletion page, because Google sign-in is not wired (ADR-0049). Staff
  accounts also enter the TOTP code.
- The request is sent only after a second confirmation. A refused proof (`reauth_required`),
  a missing or wrong TOTP code (`step_up_required`), `last_admin` and `rate_limited` show the
  screen's own copy (`common:deletion.errors.*`), so the message is specific even without an error
  catalog; the typed password and code stay in the form; nothing changes locally. Other failures
  use the error catalog with the request id.
- On 202 the date is stored in memory, the notice screen opens, then the device signs out without
  a logout call (the server already revoked every session); the sign-out runs even when opening
  the notice fails. The sign-out listeners drop the query caches and the push state.
- A repeat after a lost 202 (timeout, dropped connection) finds the deletion already started:
  409 `deletion_pending`, or 401 `account_deactivated` (the client's refresh is then refused and
  the session already ends). Both are handled as a successful request without a date: notice,
  local sign-out.
- The notice store also says that a request was made in this run. The entry screen shows the
  grace explanation while it is set, in case the notice screen does not survive the switch of
  the route guards; the notice route sends a signed-in visitor without such a request to the
  profile.
- The API client no longer refreshes and replays a request whose 401 carries `reauth_required` or
  `step_up_required`: those refuse the proof, not the access token, and a replay would verify the
  same password a second time against rate limit D.
- The sign-in screen carries one line saying that signing in within 7 days of a deletion request
  cancels it; the server gives no signal, so no message after the fact is possible.

### Copy

- The product spec fixes the i18n namespaces (§8), so the profile, statistics, settings and
  deletion copy lives in `common` (`profile`, `stats`, `profileEdit`, `settings`, `deletion`);
  position and level names are reused from `opencalls`. Failures use the error catalog
  (ADR-0048), except the deletion codes above.

## Consequences

- Spec items 9 and 11 and the in-app half of checklist item 21 work on the phone against the
  existing contract; the 7-day grace and cancel-by-sign-in are explained where the user sees
  them.
- Known limits, recorded as handoffs: no image picker dependency (photo upload stops at the
  picker port); `GET me/stats` and `GET districts` are in the contracts but not yet served by
  the web app; no endpoint to delete a pending upload; no global sign-out; no push project id or
  FCM configuration in the build; no reactivation flag on the sign-in answer; Google
  re-authentication needs the Google port of ADR-0049.
- Open item: no way to unregister a push token. After an ordinary sign-out the device token stays
  bound to the old account on the server (only a deletion removes it), so that account may still
  get pushes on this device. Needs a contract change: `DELETE me/push-tokens/:token` called before
  the local sign-out, or a server rule that registering a token re-binds it (already the case for
  `POST me/push-tokens` from another account) plus a revoke on logout.

## Rejected alternatives

- **Persisting `me` or the statistics for offline display.** Personal data in unencrypted
  storage for a screen that is not needed on the pitch.
- **A grace screen inside the signed-in guard.** It would be closed by the sign-out that the
  request requires.
- **Registering the push token automatically when the settings open.** Asking for a system
  permission without a tap is refused by both stores' guidelines and surprises the user.
- **A `profile` or `settings` i18n namespace.** The spec's namespace list is fixed; adding one is
  a scope change.
