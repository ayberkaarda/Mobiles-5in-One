# Handoff decisions → db 001

- From: Phase 2 decisions (`docs/adr/0028` … `0040`)
- To: owner of `packages/db`
- Status: open

Schema changes required by the Phase 2 decisions. One migration file per logical change is
preferred; all are additive except the comment change in item 5.

## 1. `job_receipts` (ADR-0028)

Columns: `id` (UUIDv7), `queue text NOT NULL`, `idempotency_key text NOT NULL`
(`char_length ≤ 128`), `created_at`. Unique `(queue, idempotency_key)`; index on `created_at` for
the 30-day sweep.

Acceptance: inserting the same `(queue, idempotency_key)` twice raises a unique violation; the
worker role has `INSERT, SELECT, DELETE`; the web role has no grant.

## 2. `uploads` (ADR-0030)

Columns: `id`, `user_id` (FK `users`, `ON DELETE CASCADE`), `kind` enum `avatar | badge`,
`team_id` (FK `teams`, `ON DELETE CASCADE`, nullable), `content_type` enum
`image/jpeg | image/png | image/webp`, `content_length integer` (check 1..2 097 152), `status` enum
`pending | processing | ready | rejected | deleted`, `reject_reason` enum (`missing`,
`size_mismatch`, `not_an_image`, `type_mismatch`, `too_many_pixels`, `decode_failed`, `expired`,
`not_allowed`), `media_key text NULL`, timestamps.

Checks: `kind = 'badge'` ⇔ `team_id IS NOT NULL`; `status = 'rejected'` ⇔ `reject_reason IS NOT
NULL`; `status = 'ready'` ⇒ `media_key IS NOT NULL`. Indexes: `(user_id, created_at)`,
`(status, created_at)`.

## 3. `deletion_requests.external_pending` (ADR-0032)

`text[] NOT NULL DEFAULT '{}'`, values from a closed set (`revenuecat`). Partial index on rows with
a non-empty array.

## 4. `users.is_tombstone` (ADR-0033)

`boolean NOT NULL DEFAULT false`, plus check: `NOT is_tombstone OR (password_hash IS NULL AND
apple_sub IS NULL AND google_sub IS NULL AND avatar_key IS NULL AND district_id IS NULL AND
totp_secret_enc IS NULL AND deactivated_at IS NOT NULL)`.

## 5. `match_rsvps.waitlisted_at` (ADR-0035)

`timestamptz NULL` with check `(status = 'waitlist') = (waitlisted_at IS NOT NULL)` and index
`(match_id, waitlisted_at) WHERE status = 'waitlist'`. Update the column comment on
`match_rsvps.user_id` and `mvp_votes` from "deleted-user sentinel" to "tombstone of the deleted
account (ADR-0033)".

## 6. `venues.search_name` (ADR-0039)

`text NOT NULL`, filled by the application with `foldTr(name)` from `packages/contracts`; migration
enables `pg_trgm` and adds a GIN trigram index on `search_name`. Backfill the seeded sample venues.
The seed script uses the same function.

## 7. Grants (ADR-0028)

`kadro_worker` owns schema `pgboss`; `kadro_app` gets `USAGE` on `pgboss`, `INSERT` on its job
table and `SELECT` on its queue table only.

Acceptance for the whole handoff: `drizzle-kit check` clean, migrations apply on an empty database
and on the Phase 1 schema, and the db test suite covers each new check constraint.
