# Handoff decisions → contracts 001

- From: Phase 2 decisions (`docs/adr/0028` … `0040`)
- To: owner of `packages/contracts`
- Status: resolved (implemented in the `packages/contracts` endpoint registry, follow-ups in handoffs `contracts-to-*-001`; upload model follows ADR-0030: worker applies, `avatar: null` / `badge: null` only)

## 1. Job contracts (ADR-0028)

New module `src/jobs.ts`: queue name constants and one `.strict()` payload schema per queue
(`email.send`, `push.send`, `push.receipts`, `match.reminder`, `upload.process`,
`account.hard_delete`, `opencall.expire`, `maintenance.sweep`, `venue.import`). Every payload has
`idempotencyKey` (≤ 128 chars) and ids, enums and ISO timestamps only; no free-text fields.
Email kinds (ADR-0029), notification types (ADR-0031) and upload reject reasons (ADR-0030) are
exported enums.

Acceptance: a test proves that no payload schema accepts a key outside its shape and that no
schema contains an unbounded string field.

## 2. Endpoints (rows marked P2 in the authorization matrix)

| Endpoint                                                                                                                 | ADR  |
| ------------------------------------------------------------------------------------------------------------------------ | ---- |
| `POST uploads/presign` (`contentType`, `contentLength` added), `POST uploads/:id/complete`, `GET uploads/:id`            | 0030 |
| `GET teams/:id/invites`, `DELETE teams/:id/invites/:inviteId`, `GET invites/:code`                                       | 0034 |
| `PATCH matches/:id/open-call` (`status: 'closed'`)                                                                       | 0037 |
| `DELETE venues/:id/reviews/mine`                                                                                         | 0038 |
| `DELETE me` body: re-auth proof (`password` or `identityToken` + `provider`), `totpCode?`; response 202 `{ graceUntil }` | 0032 |

The presign response carries `uploadId`. `PATCH me` accepts `avatar: null` and no storage key;
`PATCH teams/:id` accepts `badge: null`. Responses expose `avatarUrl` / `badgeUrl`.

## 3. Error codes

New: `invite_limit`, `lineup_side_full`, `review_not_eligible`, `venue_exists`, `invalid_cursor`,
`deletion_pending`, `upload_not_pending` (all 409 except `review_not_eligible` 403 and
`invalid_cursor` 400). Existing codes reused: `already_participant`, `already_voted`,
`mvp_vote_closed`, `open_call_exists`, `invalid_missing_count`, `invalid_call_expiry`,
`already_reviewed`, `reauth_required`.

## 4. Shared functions

- `foldTr(text)`: Turkish lower-casing (`İ→i`, `I→ı` then `ı→i`), diacritics removed
  (`ç ğ ö ş ü → c g o s u`), whitespace collapsed (ADR-0039). Test vectors: "Kadıköy",
  "KADIKÖY", "kadikoy" fold to the same value.
- `suggestLineup(players, slots)`: deterministic auto-balance by position (ADR-0035).
- List filter schemas for `GET open-calls` (`district | province`, `level`, `position`, `from`,
  `to` ≤ 31 days) and `GET venues` (`district | province`, `q` 2..60).

## 5. Rate-limit groups and paths

- `src/rate-limits.ts` gains group C (`POST matches/:id/open-call`, 10 per 86 400 s, key `user`,
  ADR-0037) and group D (`DELETE me`, 5 per 900 s, key `user`, ADR-0032); group I also covers
  `GET invites/:code` (anonymous preview keyed by IP).
- The registry currently uses `/api/v1/venues/[slug]/reviews`; the product spec and the
  authorization matrix use `venues/:id/reviews`. Either is acceptable; the matrix row follows the
  registry once the path is final, so pick one and report it to the owner of `docs/security`.
