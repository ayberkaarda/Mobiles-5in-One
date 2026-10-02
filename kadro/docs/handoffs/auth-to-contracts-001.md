# Handoff auth → contracts 001

- From: `packages/auth` (Phase 1)
- To: owner of `packages/contracts`
- Status: resolved (contracts exports ACCESS_TOKEN_AUDIENCE, accessTokenClaimsSchema and the codes below; packages/auth imports them, answers missing re-auth with 401 `reauth_required` and member/participant conflicts with 409 `already_participant`)

## 1. Access token claim shape and audience

ADR-0012 fixes the access JWT claims to `sub`, `sid`, `iat`, `exp`, `aud`, `iss`, but
`packages/contracts` has no schema for them and no audience constant. `packages/auth` currently
defines both in `packages/auth/src/jwt.ts`:

- `ACCESS_TOKEN_AUDIENCE = 'kadro-api'`
- `accessTokenClaimsSchema = z.strictObject({ sub: idSchema, sid: z.uuid(), iat: int ≥ 0, exp: int > 0, aud: literal, iss: string })`

Request: export `ACCESS_TOKEN_AUDIENCE` and `accessTokenClaimsSchema` (same shape, strict) from
`packages/contracts/src/auth.ts`. `packages/auth` will then import them and drop its local copy.
`sid` must accept any UUID version: for mobile it is the refresh family id (random UUIDv4).

## 2. Error codes used by the matrix but missing from `ERROR_CODES`

The authorization matrix footnotes name these codes; domain services will need them:

| Code                      | Status | Source                        |
| ------------------------- | ------ | ----------------------------- |
| `totp_not_enrolled`       | 409    | matrix §3.8                   |
| `match_terms_frozen`      | 409    | footnote 12, ADR-0004         |
| `lineup_invalid_player`   | 409    | matrix §2 step 6, footnote 15 |
| `already_applied`         | 409    | footnote 20, ADR-0010         |
| `application_not_pending` | 409    | footnote 21                   |
| `call_closed`             | 409    | footnote 21                   |
| `match_not_open`          | 409    | footnote 21                   |
| `already_participant`     | 409    | footnote 21                   |
| `reauth_required`         | 401    | footnote 4 (proposed)         |

`can()` currently answers a missing re-authentication proof (`me.delete`, `admin.totpEnroll`)
with 401 `unauthenticated`. A dedicated `reauth_required` code would let clients prompt for the
password instead of signing the user out; if added, `packages/auth` switches to it.
