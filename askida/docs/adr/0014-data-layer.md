# ADR-0014: Data layer

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Phase 1 delivers the database schema for every domain table of specification section 5, the model
classes, factories and a sample data seeder. Constraints should hold in the database, not only in
application code.

## Decision

### Identifiers

Primary keys are UUIDv7 through Laravel's `HasUuids` trait (this Laravel version generates version 7
UUIDs; a separate version-7 trait does not exist). There is no database default because PostgreSQL 16
has no `uuidv7()` function. Package tables keep big integer ids because the package classes expect
them (roles, permissions, `activity_log.id`, `personal_access_tokens.id`, see ADR-0008); their morph
keys are UUID.

### Money

Every amount is `BIGINT` in kurus, never a float. `items`, `donations` and `payouts` also carry
`currency CHAR(3) DEFAULT 'TRY'` with a CHECK equal to `TRY`. CHECKs bound values: item price 100 to
1 000 000 kurus, daily cap above 0, donation quantity 1 to 20, amount above 0, commission between 0
and the amount, payout amount 0 or more.

### Geography

`shops.location` is `geography(Point,4326) NOT NULL` with a GiST index and a CHECK for a Turkiye
bounding box (longitude 25.5 to 45.0, latitude 35.8 to 42.2). A value object and cast write a bound
EWKT parameter and read PostgreSQL's hex EWKB in PHP. Distance and ordering helpers use bound
`whereRaw` and `selectRaw` only (ADR-0012).

### Hook protections

- A state-shape CHECK ties each status to its columns (an available hook has no anonymous id, code or
  times; a reserved one has a code, a reservation time and a later expiry; a redeemed one has a code
  and a redemption time; an expired one has no redemption time). `code_hash` must be 64 lowercase hex
  characters.
- A partial unique index on (`shop_id`, `code_hash`) for `RESERVED` and `REDEEMED` rows allows one
  live or used code per shop, blocks a second redemption of a code and serves as the redeem lookup.
- A trigger makes a `REDEEMED` row final: status, redemption time, code hash, shop, item and donation
  cannot change; only `anon_id` and `redeemed_by_user_id` may go to NULL (foreign-key anonymisation).
- Supporting partial indexes serve picking available units, expiry, daily redemption lists and
  per-device reservation counts.
- Consequence for Phase 2: the reservation engine must retry code generation on a unique violation
  and the expiry job must clear code, device and times when returning a unit to `AVAILABLE`.

### Deletion semantics

Donations keep their rows when a donor is deleted (`donor_id` set NULL; `anonymized_at` only with a
NULL donor). `shops.owner_id` is nullable with RESTRICT, so a deletion flow must detach an owner
explicitly. Shop members and push tokens cascade with the user; deletion requests survive with a NULL
user; a hook's device link is set NULL and daily counters cascade when a device is removed. Status
vocabularies are lowercase for shops, donations and payouts and uppercase for hooks, as in the
specification; PHP enums mirror the CHECK lists and a unit test compares them.

### Encrypted columns

`tax_number_enc` and `iban_enc` use Laravel's `encrypted` cast. **Deviation:** the specification asks
for AES-256-GCM, but `config/app.php` currently uses AES-256-CBC (Laravel's CBC mode adds an HMAC-SHA256
MAC, so it is authenticated, but it is not the specified cipher). This will be fixed in the Phase 2
wiring; changing the cipher after data exists requires re-encryption (see the history-purge
runbook item in the verification matrix). Until then item 11 stays partial.

Server-controlled columns (verification state, flags, owner, sub-merchant key, amounts, provider
fields, statuses and all hook columns) are not mass-assignable, and sensitive columns are hidden from
serialisation.

### Time zone

The database session time zone equals the application time zone (`DB_TIMEZONE`, defaulting to
`APP_TIMEZONE`, `Europe/Istanbul`). Before this was set, Laravel wrote naive local timestamps into
`timestamptz` columns read as UTC, and token and code expiry were three hours off; the bug was found by
the auth tests and fixed with a dedicated test. Business days (daily caps, impact days, redemption day
lists) are computed explicitly in `Europe/Istanbul`, never by truncating a UTC timestamp.

### Seeders

`SampleDataSeeder` refuses to run outside `local` and `testing`; `DatabaseSeeder` calls it only there
(and always seeds admin roles), so `migrate --seed` in production writes no sample data. It is
idempotent and creates six sample shops in Istanbul districts with `is_sample = true`, the `[ÖRNEK]`
name prefix, verified state, three to five items each, and one sample merchant and one sample donor
(local only, see `docs/ops/env.md`).

### Compose volumes

The compose file no longer gives its volumes fixed names, so each compose project gets its own
`<project>_pg` and `<project>_minio`.

## Consequences

- Invalid states are rejected by PostgreSQL even if a code path is wrong.
- Constraints make some changes migrations rather than code edits.

## Lessons: shared volume incident

With fixed volume names, several parallel compose projects mounted the same PostgreSQL data
directory. One start logged `PANIC: could not locate a valid checkpoint record`, and another test run saw
32 unrelated test failures while a second stack wrote to the same directory. The stacks moved to
separate volumes and re-ran their checks, and the fixed names were then removed. Rule: never run two
database servers on one data directory and never run two test processes on one database.

## Not exercised / limits

- Migrations were run up, down and up again, and `migrate:fresh --seed` twice, on a local PostgreSQL
  16 with PostGIS; no production data exists.
- Cipher correction is open work; the retention period for financial rows is open (ADR-0005).
- Evidence: `tests/Feature/Data/*` (209 tests with unit domain tests in the run on the delivering branch),
  `tests/Feature/DatabaseTimezoneTest.php`.
