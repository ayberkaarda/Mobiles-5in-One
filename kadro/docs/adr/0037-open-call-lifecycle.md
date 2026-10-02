# ADR-0037: Open-call lifecycle, publish limits and expiry job

- Status: Accepted; amends [ADR-0003](0003-open-call-acceptance-preconditions.md) (expiry
  notification)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 6, §6 item 22; ADR-0003, ADR-0010, ADR-0017, ADR-0028, ADR-0031;
  authorization matrix §3.5 footnotes 18–22; threat model T-OC-01..09

## Context

ADR-0003 fixes the acceptance preconditions and states that time-based expiry needs no job,
because every decision re-checks `expires_at`. That keeps correctness, but pending applicants of an
expired call never hear back, and the stored `status` stays `open`. The schema already has the
states `open`, `closed`, `expired`, `removed` and at most one `open` call per match. Publishing is
also the main spam surface of the public listing.

## Decision

### States

| From   | To        | When                                                                                                                                                            |
| ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —      | `open`    | Published by captain or co-captain                                                                                                                              |
| `open` | `closed`  | `missing_count` reaches 0 by acceptance; staff close it (`PATCH matches/:id/open-call` with `status: 'closed'`); the match leaves `open` (lock, cancel, played) |
| `open` | `expired` | `opencall.expire` job, hourly, for `expires_at ≤ now()`                                                                                                         |
| `open` | `removed` | Moderator removal (Phase 5, `DELETE admin/open-calls/:id`)                                                                                                      |

`closed`, `expired` and `removed` are terminal. Every transition out of `open` rejects the call's
remaining `pending` applications in the same transaction and enqueues `application.decided` pushes
(ADR-0031). The expiry job only adds the stored status and the notifications; acceptance and
listing keep checking `expires_at` themselves, so a late job never lets an expired call act
(ADR-0003 unchanged).

### Publish (`POST matches/:id/open-call`)

- Preconditions (matrix footnote 19): match `open` and `starts_at > now()`, no other `open` call
  for the match (unique index → 409 `open_call_exists`), `1 ≤ missing_count ≤ slots − confirmed`
  (else 409 `invalid_missing_count`), `now() + 15 min ≤ expires_at ≤ starts_at` (else 409
  `invalid_call_expiry`), team not `is_pro_locked`. These codes already exist in
  `packages/contracts`.
- `district_id` defaults to the venue's district (directory venue) or the team's district; staff may
  choose another existing district. `level` uses the shared enum (ADR-0017); `position` optional.
- Rate limit group C: 10 publishes per user per day. Together with "one open call per match" and
  "match must be open and in the future", one account can list at most 10 calls a day, each tied to
  a real match of a team it runs.
- After a call ends, a new call may be published for the same match if the preconditions hold.

### Applications

- Create (ADR-0003 conditions 2–4, ADR-0010 uniqueness, group O 30 / day): `message` ≤ 280
  characters, plain text, links not rendered as links. The applicant must have a verified email.
- Withdraw and decide as in matrix §3.5. Acceptance follows ADR-0003; the accepted applicant becomes
  a match guest with RSVP `in` (never waitlisted, ADR-0035).

### Public listing

- `GET open-calls` returns only `status = 'open' AND expires_at > now()` and the public projection
  (footnote 18), sorted by `starts_at`, cursor-paginated (ADR-0039).

## Consequences

- Applicants always receive an outcome; stored status matches reality within an hour.
- Contracts: `PATCH matches/:id/open-call` (staff close) and rate-limit group C (handoff
  `decisions-to-contracts-001`); matrix §3.5 and §8 updated.

## Rejected alternatives

- **No expiry job (ADR-0003 as written).** Correct, but leaves applicants without an answer.
- **Per-team publish limit.** A user could create teams to multiply it; the per-user limit plus the
  real-match requirement bounds the total.
