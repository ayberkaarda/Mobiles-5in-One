# Handoff contracts → db 001

- From: `packages/contracts` (Phase 2 domain contracts)
- To: owner of `packages/db`
- Status: open

## 1. `upload_reject_reason` is missing `not_allowed` (fails `contracts-alignment.test.ts`)

ADR-0030 (processing step 5) rejects an upload with `not_allowed` when the uploader lost the right
to apply it (avatar: account no longer active; badge: no longer captain or co-captain, or the team
is gone). Contracts exports `UPLOAD_REJECT_REASONS` with that value; the database enum stops at
`expired`. Add `not_allowed` to the enum (new migration).

Acceptance: `pnpm --filter @kadro/db test` green, including "enums match @kadro/contracts".

## 2. Further alignment worth asserting

- Seeded `features` keys (`lighting`, `changingRoom`, `shower`, `parking`) against
  `VENUE_FEATURES`.
- Check constraints against `LIMITS.teamName` (2..60), `LIMITS.venueName` (2..120),
  `LIMITS.venueText.max` (200), `LIMITS.missingCount` (publish 1..29 within the 0..30 check),
  `LIMITS.applicationMessage.max` (280).
