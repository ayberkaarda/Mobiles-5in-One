# Handoff contracts → web 001

- From: `packages/contracts` (Phase 2 domain contracts)
- To: owner of `apps/web` (API routes and `lib/server`)
- Status: open

## 1. Problem titles (blocks `@kadro/web` typecheck)

`ERROR_CODES` gained 17 codes (domain 409s, `review_not_eligible` 403, `invalid_cursor` 400).
`lib/server/errors.ts` keeps its own `PROBLEM_TITLES` with `satisfies Record<ErrorCode, string>`.
Contracts now exports `ERROR_TITLES` with the same strings for the existing codes. Replace the
local map with `ERROR_TITLES` (or re-export it as `PROBLEM_TITLES`) so titles cannot drift again.

## 2. The endpoint registry is the route source of truth

`ENDPOINTS` / `ENDPOINT_LIST` (`@kadro/contracts`) give, per operation: `method`, `path` (the
Next.js file pattern), `client`, `auth`, `policy` (action or `selectBy` body field), `emailVerified`,
`params`, `query`, `body`, `response`, `errors`, `rateLimit` (matrix §8 group, now including C and
D). Route handlers should spread these instead of restating them. `packages/contracts` tests
already check every existing route file against the registry (path, method, auth, client, group A,
`ctx.authorize` action).

Points that differ from the Phase 1 shapes or need wrapper support:

- `auth: 'optional'` endpoints: `GET open-calls`, `GET venues`, `GET venues/[slug]`,
  `GET invites/[code]`. `tests/route-coverage.test.ts` `PUBLIC_AUTH` must list them.
- Rate-limit groups other than A (R, I, O, V, W, C, D, U, P, G) are not wired in `route()` yet;
  `GET invites/[code]` is a read with group I (anonymous: IP key).
- Venue reviews live under `venues/[slug]/reviews` and `venues/[slug]/reviews/mine`: Next.js
  allows one dynamic segment name per level, shared with `GET venues/[slug]`.
- `PATCH me` accepts `avatar: null` and no key; `PATCH teams/[id]` accepts `badge: null`
  (ADR-0030). `DELETE me` body: `password` or `provider` + `identityToken` (+ `nonce` for Apple),
  optional `totpCode`; 202 `{ graceUntil }`; group D.
- `PATCH open-calls/[id]/applications/[appId]` and `POST uploads/presign` select the action from
  the body (`policy.selectBy`).

## 3. Constraint → code mapping (`CONSTRAINT_ERROR_CODES`)

| Constraint                           | Code               |
| ------------------------------------ | ------------------ |
| `open_calls_one_open_per_match_key`  | `open_call_exists` |
| `venue_reviews_venue_id_user_id_key` | `already_reviewed` |
| `mvp_votes_match_id_voter_id_key`    | `already_voted`    |
| `deletion_requests_pending_user_key` | `deletion_pending` |
| `mvp_votes_no_self_vote`             | `invalid_votee`    |

## 4. Cancelling a deletion

There is no cancel endpoint: a deactivated account has no usable session, so a successful sign-in
during the grace period is the cancellation (ADR-0012, ADR-0032). The registry documents this on
`login`, `signInWithApple`, `signInWithGoogle` and `deleteMe`.

Acceptance: `pnpm --filter @kadro/web typecheck test` green with `ERROR_TITLES`; new routes built
from the registry entries.
