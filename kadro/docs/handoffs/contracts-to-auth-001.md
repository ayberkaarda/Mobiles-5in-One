# Handoff contracts → auth 001

- From: `packages/contracts` (Phase 2 domain contracts)
- To: owner of `packages/auth`
- Status: open

## 1. Seven new policy actions (blocks `@kadro/auth` build)

`ACTIONS` now contains the Phase 2 rows of authorization matrix §3 (decisions handoff
`decisions-to-web-001` §4):

| Action             | Matrix row                           | Cell summary                                        |
| ------------------ | ------------------------------------ | --------------------------------------------------- |
| `invite.list`      | `GET teams/:id/invites`              | co / cap Y; ply 403; user, gst 404                  |
| `invite.revoke`    | `DELETE teams/:id/invites/:inviteId` | co / cap Y; ply 403; user, gst 404                  |
| `invite.preview`   | `GET invites/:code`                  | everyone incl. anon (footnote 28)                   |
| `opencall.close`   | `PATCH matches/:id/open-call`        | co / cap Y; ply, gst 403; user 404                  |
| `upload.complete`  | `POST uploads/:id/complete`          | uploader only (self); anyone else 404 (footnote 31) |
| `upload.read`      | `GET uploads/:id`                    | uploader only (self); anyone else 404               |
| `review.deleteOwn` | `DELETE venues/:id/reviews/mine`     | any authenticated user, own row only (footnote 32)  |

`RULES` in `src/policies.ts` uses `satisfies Record<Action, Rule>`, so the package does not
compile until each action has a rule and table rows in `policies.test.ts`.

Acceptance: `pnpm --filter @kadro/auth typecheck test build` green; one test row per new cell.

## 2. New error codes available to `can()`

`review_not_eligible` (403, `review.create` without a played match at the venue, ADR-0038) is in
`ERROR_CODES`; the decisions handoff asks for a `playedAtVenue` fact on `ResourceContext`.
Members accepting an invite or applying to their own team's call answer 409
`already_participant` (ADR-0034, matches the registry entries `acceptInvite` and
`createApplication`).
