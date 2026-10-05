# ADR-0008: Authentication model

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The app has three modes. Donors and merchants have accounts; recipients never do (they get an
anonymous device identity in a later phase). The mobile client talks to the JSON API with bearer
tokens, and the admin panel uses a browser session. Phase 1 delivers account creation, sign-in,
device tokens, e-mail verification, password reset and Apple and Google sign-in on the server.

## Decision

### Device tokens

- Laravel Sanctum personal access tokens, bearer only. Sanctum's stateful (single-page app cookie)
  mode is disabled: `sanctum.stateful` and `sanctum.guard` are empty.
- One token per device. The token name is the required `device_name`; a new sign-in with the same
  `device_name` deletes the earlier token of that device. The `platform` (`ios` or `android`) is
  stored in an extra column with a CHECK constraint.
- Exactly one ability per token, taken from `users.kind` (`donor` or `merchant`).
- Expiry is 30 days: `expires_at` is set at issue time from `SANCTUM_TOKEN_EXPIRATION_MINUTES`
  (default 43200) and the same value is set as `sanctum.expiration`. Logout revokes the current
  token; a successful password reset revokes every token of the user.
- `personal_access_tokens.id` stays a big integer, unlike every domain table. The id is only an
  internal handle that is part of the opaque bearer string; it is never a domain key or exposed in a
  response, and keeping Sanctum's default token class avoids maintaining a custom token class for
  no security gain. Switching later needs a custom token class and a migration change.

### Access rule

A custom rule runs on every bearer token after Sanctum's own expiry checks. It accepts a token only
when its owner is a user, the owner is not deactivated (read from the database on each request),
and its ability list equals exactly `[users.kind]`. A token with another ability, two abilities, the
wildcard or none is refused with 401, and so is any non-user token holder (device tokens arrive with
attestation in a later phase). A change of `users.kind` therefore invalidates older tokens.

### E-mail and password

- Registration takes e-mail, password, name, kind, device name, platform and a non-empty
  `kvkk_text_version`. E-mail is stored lowercase and is unique.
- Sign-in with a wrong password, an unknown e-mail, a deactivated account or a provider-only account
  returns identical `auth.invalid_credentials` responses; unknown accounts get decoy hash work so
  timing does not distinguish them.
- Unverified users can sign in; the response reports `email_verified`. Later gates may use it.

### One-time codes

- E-mail verification and password reset use a 6-digit numeric code, not a signed link.
- Codes are stored in `password_reset_tokens` (one row per user and purpose, with a CHECK on the
  purpose) as an HMAC-SHA256 with a key derived from `APP_KEY` for that purpose. Lifetime 60 minutes,
  single use, deleted after 5 wrong guesses; a new code replaces the old one.
- Mails are queued after commit and encrypted in the queue, so the code never sits in Redis in clear.
- A successful reset also marks the e-mail as verified.
- Wrong, used, expired and unknown-account codes give the same `auth.token_invalid` answer.

### Non-enumeration

`auth/forgot` always answers 202 for a well-formed address. Verify and login answer identically for
unknown accounts. Registration with an existing e-mail does answer 422 `unique`: registration
reveals existence, forgot and login do not. The API limiter (ADR-0009) bounds enumeration.

### Apple and Google

- Verification sits behind the interface `IdentityTokenVerifier`, with a JWKS-based adapter and a
  test fake. The adapter accepts RS256 only, checked in the header before any key is used (blocks
  `none` and symmetric-algorithm confusion). The key set is fetched over HTTPS with a 5 second
  timeout, cached for one hour, only RSA signature keys are kept, and it is refetched once when the
  key id is unknown.
- Checks: issuer from a per-provider list, audience intersecting the configured client ids
  (`APPLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`; an empty list rejects everything), `exp` required, 60 second
  leeway, `sub` required. The nonce is compared in constant time: Apple against the SHA-256 of the
  client's raw nonce, Google against the raw nonce.
- Resolution order: match by provider `sub`, then by e-mail, then create. An e-mail match links the
  provider only when the provider asserts the e-mail is verified and the account has no other
  identity of that provider; otherwise the answer is 409 `conflict`. If the existing account never
  verified its e-mail, linking sets its password to NULL, revokes its tokens and marks the e-mail
  verified; this blocks the takeover where someone pre-registers a victim's address with a password.
- New provider accounts have `password = NULL`, e-mail verification taken from the provider claim and
  a consent row. A provider outage gives 503 `service_unavailable`.
- Dependency: `firebase/php-jwt` is the only package added for this. It does the signature check,
  JWK parsing and time claims; `iss`, `aud`, `nonce` and algorithm checks are our own.

### Consent

Registration (and creation through a provider) writes a `kvkk_consents` row with the text version and
`ip_hash`, an HMAC-SHA256 of the client address with a key derived from `APP_KEY` for that purpose.
The raw address is never stored. Rotating `APP_KEY` changes future hashes.

## Consequences

- Clients store one token per device in secure storage and re-authenticate after 30 days.
- Reset and verification are code-entry flows in the app; no mail-link landing page is needed.
- Anonymous recipient tokens are intentionally not issued here.
- A single pepper derived from `APP_KEY` serves several HMAC purposes; a dedicated pepper per purpose
  is a possible later hardening.

## Not exercised / limits

- Apple and Google verification was tested with tokens signed at run time by a locally made key and a
  fake key set. The real providers' key sets, client registrations and sign-in flows were not
  exercised (ADR-0006, gate G9).
- Real mail delivery was not exercised; tests use mail fakes.
- Evidence: `tests/Feature/Api/Auth/*` and `tests/Unit/Auth/*` (159 auth tests in the run on the delivering branch).
