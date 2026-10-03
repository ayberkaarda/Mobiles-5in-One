# Handoff admin moderation → contracts

- From: admin moderation and venue import (`apps/web/lib/server/admin/*.ts`, ADR-0067)
- To: owner of `packages/contracts` (`admin.ts`, `endpoints.ts`) and the database migrations
- Status: open

## Content reports have no contract

The admin API moderates venues, reviews, open calls and accounts from staff lists (ADR-0064).
There is no way for a user to report a review, an open call or an account, and no admin queue of
reports: no table, no endpoint, no policy action and no error code. Nothing was invented for it.

A ban is covered by `PATCH admin/users/:id/deactivate` (deactivation revokes every session and
is lifted with `deactivated: false`, ADR-0067 §4); no separate ban state is needed.

Request, if report handling is in scope:

1. A `reports` table (reporter, target type `venue_review | open_call | user`, target id, reason
   from a closed set, optional short text, status `open | dismissed | actioned`, handled by, times)
   with a unique open report per reporter and target.
2. `POST /api/v1/reports` (verified email, its own rate-limit group) and
   `GET /api/v1/admin/reports` plus `PATCH /api/v1/admin/reports/:id` (staff + step-up, audited),
   with the matching matrix rows in §3.8 and IDOR rows.

Acceptance: the endpoints are in the registry and the OpenAPI document, the policy actions exist
in `packages/auth`, and the matrix lists the new rows.
