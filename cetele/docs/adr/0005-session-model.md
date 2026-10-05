# ADR-0005: Session model

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec section 6 items 5, 11 and 12 require phone-number sign-in with a one-time code, short-lived
access tokens, refresh rotation with reuse detection and hashed secrets. The server has no
password. A stolen phone, a stolen database dump and a leaked log must each yield as little as
possible. Phase 1 builds the whole path against fakes for the SMS gateway and the integrity
verdict ([ADR-0006](0006-integrity-verifier-and-local-adapters.md)).

## Options considered

- Server-side sessions with an opaque id: simple revocation, but every request reads a session
  row and the Android client would need cookie handling. Rejected.
- Long-lived JWT only: no revocation. Rejected.
- Short access JWT plus opaque refresh token with rotation: chosen. Revocation costs one
  database lookup per refresh, and a compromised access token lives at most 15 minutes.

## Decision

### One-time code

- Six digits from `SecureRandom`. The database stores `HMAC-SHA256(pepper, phone || code)` in
  `otp_codes.code_hmac`, never the code. The pepper is `CETELE_OTP_PEPPER`, at least 32 bytes;
  startup fails when it is empty outside the `local` and `test` profiles, and in those profiles a
  random pepper is created at startup.
- Issuing is serialised per phone with a transaction-scoped PostgreSQL advisory lock taken before
  the open codes are closed, so concurrent requests for one phone leave exactly one open code.
- Time to live 5 minutes, single use (`consumed_at`), at most 5 attempts, then the code is
  consumed. Only the newest open code of a phone can be verified: a new request closes the
  previous one.
- The code is bound to the `deviceId` of the request that created it. A verify from another device
  id counts as a wrong attempt.
- The HMAC is computed on every verify, also when no code is open, so unknown phones and open
  codes take the same path. Wrong, expired, consumed and exhausted codes, an unknown phone and a
  deactivated user all produce the same `401 auth.otp_invalid` body. Failed attempts are committed
  before the 401 is returned.
- `otp_codes.purpose` is `LOGIN` now. The `REAUTH` value exists in the column check and is used
  from Phase 2 (account deletion, ownership transfer).
- A successful verify creates the user when the phone is new (`INSERT ... ON CONFLICT DO NOTHING`,
  race free) and upserts a `devices` row (`(user_id, device_id)` unique, `integrity_verified_at`
  taken from the code's `created_at`).

### Access token

- ES256 JWT, header `typ=JWT`, `kid=es256-1`. Claims: `sub` (user id), `did` (device id), `jti`,
  `iat`, `exp`, `iss=https://cetele.app`, `aud=cetele-api`. No roles and no shop ids (decision D-1,
  [ADR-0007](0007-tenancy-and-permission-enforcement.md)).
- Lifetime 15 minutes, clock skew 30 seconds. `alg=none`, HS256, another key, another `kid`,
  another issuer, a missing or different audience (exactly `cetele-api` is required, a list with
  extra audiences is refused), missing claims and a tampered token are all
  `401 auth.unauthenticated`.
- Keys come from `CETELE_JWT_ES256_PRIVATE_KEY_PEM` (PKCS#8) and `CETELE_JWT_ES256_PUBLIC_KEY_PEM`
  (X.509), P-256 only; startup checks the curve and that the two keys match. Both empty creates an
  ephemeral pair per start, allowed only in `local` and `test`
  ([ADR-0006](0006-integrity-verifier-and-local-adapters.md)); exactly one empty fails startup.
- The authentication filter reads `users.deactivated_at` on every request; a deactivated or
  unknown user is 401. The public auth endpoints ignore the `Authorization` header, so an expired
  access token never blocks a refresh.

### Refresh token

- 32 random bytes, base64url (43 characters). Stored as SHA-256 (`refresh_tokens.token_hash`,
  unique). Lifetime 60 days from issue; every rotation issues a new row with a new 60 days.
- Rotation: the old row gets `revoked_at`, the new row gets `rotated_from` and the same
  `family_id`. The whole operation is serialised per family: the family id is resolved from the
  token hash, `AuthLocks` takes `pg_advisory_xact_lock` on a key derived from the family, and the
  row is then re-read `FOR UPDATE`. Presenting a revoked or already rotated token revokes every row
  of the family (committed before the 401) and answers `401 auth.refresh_invalid`. There is no
  grace window: a client that sends two refreshes with the same token concurrently loses the
  family and signs in again. This is deliberate.
- Order of checks on refresh: the address budget for unknown tokens is estimated first without
  taking a token (an address over its budget is refused before any lookup); then the family lock
  and reuse detection, which are never throttled, so a thief who used up the device budget cannot
  hide a replay; then expiry and the active-user check; then the device bucket; then the rotation.
  Only unknown tokens charge the IP bucket; known tokens charge the device bucket.
- Unknown, malformed (longer than 128 characters) and expired tokens and a deactivated user are
  `401 auth.refresh_invalid`; an expired token or a deactivated user does not revoke the family.
- Logout (`POST /v1/auth/logout`, bearer) locks every live family of the caller's `(user, device)`
  pair in sorted key order (no lock-order deadlock with a rotation), then revokes all live refresh
  tokens of the pair and answers 204. Other devices of the user are untouched. The access token
  stays valid until it expires (at most 15 minutes).

## Consequences

- A leaked access token is useful for 15 minutes; a leaked refresh token is useful until its first
  reuse is detected. The database holds no code and no token in clear text.
- Refresh has a sliding lifetime and no absolute family lifetime: an active client can stay signed
  in indefinitely. A cap (for example 180 days) is a proposal for the owner, not built.
- Expired or consumed `otp_codes` and revoked or expired `refresh_tokens` accumulate. A retention
  job is planned with the deletion flow in Phase 2.
- Real SMS delivery and real Play Integrity verdicts are not exercised here
  (`not exercised: no provider account`, [ADR-0004](0004-portfolio-delivery-scope.md) G3, G4).
- Advisory locks are per PostgreSQL database: they serialise concurrent requests on one database,
  which is the deployment here. The locks need no schema change.
- Evidence: `OtpVerifyTest`, `OtpStorageTest`, `OtpIssueRaceTest`, `RefreshRotationTest`,
  `RefreshRaceTest`, `LogoutTest`, `JwtTest`, `JwtKeyConfigurationTest`, `V2AuthSchemaTest` (names in the
  [verification matrix](../security/verification-matrix.md)).
