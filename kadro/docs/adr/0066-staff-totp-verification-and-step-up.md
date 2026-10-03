# ADR-0066: Staff TOTP verification, enrollment and step-up

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: product spec §6 item 18; authorization matrix §3.8 (footnotes 4, 5, 26, 27);
  ADR-0007, ADR-0009, ADR-0032, ADR-0064; `apps/web/lib/server/admin/totp.ts`,
  `apps/web/lib/server/admin/step-up.ts`, `packages/db/src/totp.ts`

## Context

ADR-0064 fixed the admin TOTP surface (`POST admin/step-up`, `POST admin/totp/enroll`,
`POST admin/totp/confirm`), its error codes and the schema (pending secret, last used step,
per-session `step_up_until`). Staff code verification was a stub that always failed, so staff
could neither step up nor delete their own account. This record settles how codes are verified,
how secrets are stored and how attempts are limited.

## Decision

1. **Algorithm.** RFC 6238 over RFC 4226 HOTP with HMAC-SHA1, 6 digits, 30-second steps and
   `T0 = 0`, implemented on `node:crypto` without a third-party library. Secrets are 160 random
   bits, shown once as unpadded RFC 4648 base32 and in a Key Uri Format `otpauth://totp/` URI
   (issuer `Kadro`, the account email as label, falling back to a fixed label if the URI would
   exceed 512 characters).
2. **Window and replay.** The current step and one step either side are accepted. Every candidate
   step is computed and compared with `timingSafeEqual`, whatever matched before. A step at or
   below `users.totp_last_used_step` is refused, and an accepted step is consumed by one
   conditional update (`last_used_step is null or < step`, same active ciphertext), so two
   concurrent requests with one code cannot both pass. Confirmation stores its step the same way
   (`confirmPendingTotpSecret`), so the confirming code cannot then open a step-up.
3. **Storage.** Secrets are AES-256-GCM encrypted under `TOTP_ENCRYPTION_KEY` with a random
   96-bit IV and a 128-bit tag, stored as `v1.<iv>.<ciphertext>.<tag>` (base64url parts). The
   additional authenticated data is `kadro.totp.v1:<user id>`, so a ciphertext copied onto another
   account does not decrypt. Pending and active secrets share the format; confirmation moves the
   ciphertext unchanged. A value that does not decrypt fails the request with 500 (fail closed);
   plaintext secret buffers are zeroed after use. Without a key, enrollment and step-up answer
   503 and per-action codes fail (ADR-0064 §7).
4. **Attempts.** Besides rate-limit group T on the three routes, every code check of an account
   (step-up, confirmation, the fresh code of `DELETE me`, role changes and deactivation) draws on
   one per-user budget of 5 attempts per 15 minutes (matrix footnote 26). The attempt is counted
   before verification; a correct code clears the budget, so legitimate per-action codes are not
   capped. When it is spent the answer is 429 `rate_limited` with `Retry-After`.
5. **Step-up binding.** A successful step-up sets `step_up_until = now + 15 min` on the web
   session row (web) or on every live row of the refresh-token family (mobile, where rotation
   carries the value to the next row). Other sessions of the same account stay without step-up.
6. **Enrollment order.** Non-staff callers get 403 before any account data is read. For staff:
   503 without a key, 409 `totp_already_enrolled` with an active secret (checked before the
   proof, so a proof is not spent on a request that cannot succeed), then the single-use
   re-authentication proof of footnote 4 (401 `reauth_required`). Confirmation shares the policy
   action `admin.totpEnroll`; its proof is the pending secret itself, which only a
   re-authenticated enrollment of the last 10 minutes can create, so the handler passes
   `reauthenticated` to the policy and then verifies the code. A code from a pending secret that a
   newer enrollment replaced answers 401 `totp_invalid`.
7. **Audit.** Rows carry no code, secret or proof; metadata holds only `client` and, for
   failures, a short `reason`:

   | Action                    | When                                                         |
   | ------------------------- | ------------------------------------------------------------ |
   | `admin.totpEnrollStarted` | a pending secret was stored                                  |
   | `admin.totpEnrollFailed`  | the re-authentication proof failed (`reauth`)                |
   | `admin.totpEnrolled`      | the pending secret became active                             |
   | `admin.totpConfirmFailed` | `invalid`, `replaced` or `not_enrolled`                      |
   | `admin.stepUp`            | a step-up window was opened                                  |
   | `admin.stepUpFailed`      | `invalid`, `reused` (lost a concurrent race), `not_enrolled` |
   | `admin.freshTotpFailed`   | a per-action code failed; the reason is the purpose          |

## Consequences

- Staff can enroll, step up and delete their own account; role changes and deactivation reuse
  `verifyFreshStaffTotp` for their per-action code.
- Rotating `TOTP_ENCRYPTION_KEY` makes every stored secret unreadable (500 on use) until staff
  re-enroll through the operator reset of ADR-0064; a key-versioned format can be added later by
  bumping the `v1` prefix.
- Locally, TOTP stays off until a key is created with
  `packages/config/scripts/generate-secrets.mjs`.
