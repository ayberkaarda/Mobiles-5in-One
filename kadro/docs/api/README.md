# Kadro API

`openapi.json` in this directory is the OpenAPI 3.1 description of every `/api/v1` operation (67
operations over 54 paths at the time of writing). It is **generated** from the endpoint registry in
`packages/contracts/src/endpoints.ts`; never edit it by hand.

```sh
pnpm --filter @kadro/contracts openapi    # rewrites docs/api/openapi.json
```

`packages/contracts/src/openapi.test.ts` fails while the committed file differs from what the
script would write, so a registry change and its regenerated document ship in one commit.

## Conventions

- Base path `/api/v1`. JSON bodies up to 1 MiB (413 `payload_too_large`), `Content-Type:
application/json` (415 `unsupported_media_type`). Request schemas are strict: an unknown key is
  400 `validation_failed`.
- Every response carries `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and an
  `x-request-id` header; the same id is the `requestId` of an error body.
- Lists use cursor pagination: query `cursor` and `limit` (1..100, default 20); the response is
  `{ items, nextCursor }` and `nextCursor` goes back as `cursor`. A malformed or foreign cursor is
  400 `invalid_cursor`.
- Ids are UUIDv7 and are not secret; authorization never depends on them (ADR-0016).
- The OpenAPI extensions `x-kadro-policy-action`, `x-kadro-rate-limit`, `x-kadro-email-verified`,
  `x-kadro-step-up`, `x-kadro-auth`, `x-kadro-client` and `x-kadro-phase` link each operation to the
  authorization matrix (`docs/security/authorization-matrix.md`).

## Authentication

Every request except `GET /api/v1/health` and `POST /api/v1/webhooks/revenuecat` carries the
`x-kadro-client` header, `mobile` or `web` (ADR-0014, ADR-0020). A missing or unknown value, or
`mobile` together with an `Origin` header, is 400. A credential is accepted only on its own client
type.

| Client   | Credential                                                                           | Notes                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mobile` | `Authorization: Bearer <access JWT>` (ES256, 15 minutes) and an opaque refresh token | `POST /auth/refresh` rotates the refresh token; there is no grace window, so clients refresh single-flight (ADR-0019). A rotated token presented again revokes its whole family.                                                                                 |
| `web`    | `__Host-kadro_session` cookie, plus `x-csrf-token` on every non-GET request          | Double-submit CSRF token bound to the session; a missing or mismatched token is 403 `csrf_failed`.                                                                                                                                                               |
| webhook  | `Authorization` header equal to the shared secret                                    | `POST /webhooks/revenuecat` only. No user principal; cookies and bearer tokens are ignored. 401 on a missing or wrong value, 503 when no secret is configured. See ADR-0063.                                                                                     |
| admin    | a moderator or admin session, plus a TOTP step-up                                    | `/admin/**` needs a step-up from the last 15 minutes (401 `step_up_required`). `POST /admin/step-up`, `/admin/totp/enroll` and `/admin/totp/confirm` establish it. Role changes and deactivation also carry a fresh `totpCode` in the body (ADR-0064, ADR-0066). |

The account state and the session family are read from the database on every request, so a
deactivation, a logout or a password reset takes effect on the next request (ADR-0012, ADR-0025).
Operations marked `x-kadro-email-verified` additionally need a verified email (403
`email_unverified`).

A caller with no read relationship to a resource gets 404 with the body of a missing id; a caller
who can read it but may not act gets 403; a state conflict is 409. Who may do what is defined in
`docs/security/authorization-matrix.md`.

## Errors

Errors are RFC 9457 problem details (`application/problem+json`):

```json
{
  "type": "https://kadro.app/problems/not_found",
  "title": "Not found",
  "status": 404,
  "code": "not_found",
  "requestId": "..."
}
```

`code` is the stable identifier clients switch on; `title` is a fixed English string and is never
shown to users. `detail` is optional. A `validation_failed` body adds `errors`, a list of `{ path,
issue }` for up to 50 fields and never echoes submitted values. `venue_exists` adds `existingSlug`
when the caller may read that venue. Bodies never contain stack traces, SQL or file paths. A 429
carries `Retry-After` (seconds); a 401 `unauthenticated` carries `WWW-Authenticate: Bearer
realm="kadro-api"`.

The mobile app maps every `code` to Turkish and English copy; `apps/mobile/tests/errors-catalog.test.ts`
fails when a code has no copy.

| Code                        | Status | Title                                         |
| --------------------------- | ------ | --------------------------------------------- |
| `validation_failed`         | 400    | Request validation failed                     |
| `payload_too_large`         | 413    | Request body too large                        |
| `unsupported_media_type`    | 415    | Unsupported media type                        |
| `unauthenticated`           | 401    | Authentication required                       |
| `invalid_credentials`       | 401    | Invalid credentials                           |
| `token_invalid`             | 401    | Token invalid or expired                      |
| `account_deactivated`       | 401    | Account deactivated                           |
| `step_up_required`          | 401    | Step-up authentication required               |
| `reauth_required`           | 401    | Re-authentication required                    |
| `forbidden`                 | 403    | Forbidden                                     |
| `csrf_failed`               | 403    | CSRF validation failed                        |
| `email_unverified`          | 403    | Email address not verified                    |
| `entitlement_required`      | 403    | Subscription required                         |
| `not_found`                 | 404    | Not found                                     |
| `method_not_allowed`        | 405    | Method not allowed                            |
| `conflict`                  | 409    | Conflict                                      |
| `account_link_required`     | 409    | Account linking required                      |
| `password_breached`         | 422    | Password found in a data breach               |
| `captain_must_transfer`     | 409    | Captaincy must be transferred first           |
| `team_has_history`          | 409    | Team has played matches and other members     |
| `last_admin`                | 409    | Last administrator                            |
| `match_full`                | 409    | Match is full                                 |
| `totp_not_enrolled`         | 409    | TOTP not enrolled                             |
| `totp_invalid`              | 401    | TOTP code invalid                             |
| `totp_already_enrolled`     | 409    | TOTP already enrolled                         |
| `match_terms_frozen`        | 409    | Match terms are frozen                        |
| `lineup_invalid_player`     | 409    | Lineup contains an ineligible player          |
| `already_applied`           | 409    | Already applied                               |
| `application_not_pending`   | 409    | Application is not pending                    |
| `call_closed`               | 409    | Open call closed                              |
| `match_not_open`            | 409    | Match is not open                             |
| `already_participant`       | 409    | Already a participant                         |
| `invalid_status_transition` | 409    | Status transition not allowed                 |
| `match_state_conflict`      | 409    | Match status does not allow this action       |
| `slots_below_confirmed`     | 409    | Slots cannot drop below the confirmed players |
| `slots_below_lineup`        | 409    | Slots too few for the current lineup sides    |
| `player_not_confirmed`      | 409    | Player is not confirmed for this match        |
| `mvp_vote_closed`           | 409    | MVP voting is closed                          |
| `already_voted`             | 409    | Already voted                                 |
| `invalid_votee`             | 409    | Invalid MVP candidate                         |
| `open_call_exists`          | 409    | Match already has an open call                |
| `invalid_missing_count`     | 409    | Missing player count exceeds free slots       |
| `invalid_call_expiry`       | 409    | Open call must expire before the match starts |
| `already_reviewed`          | 409    | Venue already reviewed                        |
| `deletion_pending`          | 409    | Account deletion already pending              |
| `invite_limit`              | 409    | Too many active invites                       |
| `lineup_side_full`          | 409    | Lineup side is full                           |
| `review_not_eligible`       | 403    | Review requires a played match at this venue  |
| `venue_exists`              | 409    | Venue already exists                          |
| `upload_not_pending`        | 409    | Upload is not pending                         |
| `invalid_cursor`            | 400    | Invalid pagination cursor                     |
| `rate_limited`              | 429    | Too many requests                             |
| `internal_error`            | 500    | Internal server error                         |
| `service_unavailable`       | 503    | Service unavailable                           |

The list above is `ERROR_CODES`, `ERROR_STATUS` and `ERROR_TITLES` in
`packages/contracts/src/problem.ts`; the registry entry of each operation names the codes it can
return.

## Rate limits

Every operation names a group in `x-kadro-rate-limit`. A rejected request is 429 `rate_limited`
with `Retry-After`. The limits (`packages/contracts/src/rate-limits.ts`, matrix section 8):

| Group | Operations                                                  | Limit                           |
| ----- | ----------------------------------------------------------- | ------------------------------- |
| A     | login, register, forgot, reset, verify-email, apple, google | 5 / 15 min, per IP and email    |
| R     | refresh                                                     | 30 / 15 min, per refresh family |
| T     | admin step-up, TOTP enroll and confirm                      | 5 / 15 min, per user            |
| I     | invite preview and accept                                   | 20 / hour                       |
| O     | open-call applications                                      | 30 / day                        |
| V     | venue creation                                              | 5 / day                         |
| W     | venue reviews                                               | 10 / day                        |
| C     | open-call publishing                                        | 10 / day                        |
| D     | account deletion request                                    | 5 / 15 min                      |
| U     | upload presign                                              | 10 / 24 h                       |
| P     | push token registration                                     | 10 / day                        |
| G     | other authenticated mutations                               | 120 / min                       |

An operation whose `x-kadro-rate-limit` is absent has no group, for example `GET /me/stats`, `GET /districts`, the admin lists and the webhook (deliveries arrive in bursts, ADR-0063).
