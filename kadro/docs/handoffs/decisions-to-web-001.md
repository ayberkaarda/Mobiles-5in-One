# Handoff decisions → web 001

- From: Phase 2 decisions (`docs/adr/0028` … `0040`)
- To: owner of `apps/web` (API, `lib/server`, pages) and `packages/auth`
- Status: open

## 1. Job enqueue (ADR-0028, ADR-0029)

- `apps/web/lib/server/jobs.ts`: send-only pg-boss client (`supervise`, `schedule`, `migrate`
  off) and `enqueue(tx, queue, payload, options)` using pg-boss's `db` executor bound to the
  Drizzle transaction. Readiness fails while a target queue does not exist.
- Register and forgot enqueue `email.send` inside their transactions; forgot enqueues on every call
  with `userId = null` when no eligible account matches. Remove the `after()` scheduler, web-side
  token creation for emails and the web email transport in the same change. Move
  `apps/web/emails` to a `@kadro/emails` package used by the worker.

## 2. Domain endpoints

Implement the rows marked P2 in `docs/security/authorization-matrix.md` and the state rules of
ADR-0034 (invites), ADR-0035 (RSVP, waitlist, lineup), ADR-0036 (fee split, MVP), ADR-0037 (open
calls), ADR-0038 (venues, reviews), ADR-0039 (filters, cursor), ADR-0030 (uploads: presign with
`content-length` and `content-type` in `X-Amz-SignedHeaders`, complete, status) and ADR-0032
(`DELETE me`). Rate-limit groups C and D are new.

Acceptance: integration tests per 409 code; IDOR rows from matrix §9.3 (P2 bullets); a test that
asserts the signed-header list of every presigned URL.

## 3. Authentication

Refuse any user row with `is_tombstone = true` in the authentication step and in sign-in
(ADR-0033).

## 4. `packages/auth`

Add policy actions `invite.list`, `invite.revoke`, `invite.preview`, `opencall.close`,
`upload.complete`, `upload.read`, `review.deleteOwn` with matrix rows, and the `review.create`
eligibility fact (`playedAtVenue`) as a `ResourceContext` field (403 `review_not_eligible`).

## 5. Email-link pages (ADR-0040)

`/e-posta-dogrula`, `/sifre-sifirla`, `/sifremi-unuttum`, `/giris`, `/hesap-silme` as app surfaces:
fragment token read and removed before any other script, `no-referrer` and `no-store` on token
pages, `noindex`, no third-party resources, WCAG 2.2 AA items listed in the ADR. Playwright flows:
register → verification link → verified; forgot → reset link → new password → sessions revoked;
axe checks in initial, error and success states.
