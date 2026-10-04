# ADR-0020: Hook reservation and redemption engine

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

A hook is one prepaid unit. Two recipients must not get the same unit, a code must be redeemable
exactly once, caps must hold under parallel requests, and nothing in the flow may identify a
recipient (specification section 6 items 4, 5 and 11; threat model 4.1 and 4.2). Phase 1 already put
a partial unique index and a final-state trigger on `hooks` (ADR-0014).

## Decision

### Lifecycle

`AVAILABLE` to `RESERVED` (sets `anon_id`, `code_hash`, `reserved_at`,
`expires_at = now + 10 minutes`, configurable by `HOOK_RESERVATION_MINUTES`) to `REDEEMED` (sets
`redeemed_at` and `redeemed_by_user_id`). An unredeemed reservation returns to `AVAILABLE` and clears
the four reservation columns in one update. The deadline is exclusive: at `expires_at` the code is
expired. `EXPIRED` is never set by this engine; it is reserved for units awaiting refund after a shop
is removed (Phase 3). Release runs from the job `hooks.release-expired` (every minute) and lazily
inside reserve and redeem, so correctness never depends on the job. Release picks rows
`FOR UPDATE SKIP LOCKED` and re-checks `status = 'RESERVED'`, so a unit held by a redeem is skipped
and parallel releasers cannot release twice. A `REDEEMED` row is never touched.

### Codes

Eight characters of Crockford base32 without `I L O U` from `random_int`; input is normalised
(upper case, spaces and dashes removed, `I` and `L` to `1`, `O` to `0`). Only
`HMAC-SHA256(code, HOOK_CODE_PEPPER)` (hex) is stored, with a pepper of at least 32 characters. A
collision on the unique partial index is retried in a savepoint up to 5 times, then 503 with nothing
changed. The plaintext appears only in the `reserve` response and in no log or other response.

### Reserve (`POST hooks/reserve`, anon token)

Body `shop_id`, `item_id`; the `anon_id` comes from the token and is prohibited in the body. Lock
order inside one transaction, the same for every caller so no deadlock cycle exists: (1) the device's
counter row of the Istanbul day (insert-or-ignore, then `FOR UPDATE`) and the per-device caps; (2)
the item row `FOR UPDATE` and the item `daily_cap`; (3) the oldest `AVAILABLE` unit
`FOR UPDATE SKIP LOCKED`.

- Caps: 2 reservations per device per day, 1 per shop per day. They count reservations made, so a
  reservation that expires still counts and a device cannot hold units by re-reserving. The item
  `daily_cap` counts `RESERVED` (by `reserved_at`) plus `REDEEMED` (by `redeemed_at`) units of that
  day; released units do not count.
- Limiter `hooks-reserve`: 5 per hour per `anon_id` and 60 per hour per address.
- An unknown or unverified shop, an inactive item or an item of another shop is 404. Cap and stock
  failures are 409 `anon.daily_cap`, `anon.shop_cap` and `hook.none_available`.
- Success is 201 `{code, expires_at, shop:{id,name}, item:{name,category}}`.

### Redeem (`POST shops/{shop}/redeem`, merchant token)

Owner or staff of the shop. The code is normalised and hashed, then the unit is found by shop and
hash, locked `FOR UPDATE`, and moved by a conditional update `WHERE status = 'RESERVED'`; the partial
unique index and the trigger are the third layer. Success is 200
`{message: "1 ekmek verildi", item:{name}, redeemed_at}` with no recipient data. Unknown, used and
other-shop codes are the same 422 `hook.code_invalid`, so a member cannot probe other shops;
`hook.code_expired` is answered only for an expired unit of this shop, which is released on the
spot. Limiter `redeem`: 30 per minute per shop for members, non-members use their own bucket.
`GET shops/{shop}/redemptions?day=` returns item, time and the redeemer's role only.

### Self-redeem signal

When the donation's donor is the redeeming user the redemption is allowed and an `activity_log`
entry `suspicious_self_redeem` (subject: the hook, causer: the merchant, properties: shop and
donation ids) is written for finance review in Phase 3. Merchants cannot donate (one account kind),
so this path is a defence in depth.

### Hook issuer

`HookIssuer::issueForDonation(donation)` (called in Phase 3 when a payment is confirmed) locks the
donation `FOR UPDATE`, refuses a donation that is not `paid`, creates only the missing units up to
`qty` as `AVAILABLE` and returns the number created, so a replayed call creates nothing. It sets
`hooks_issued_at` when that column exists. `HooksIssued` is dispatched only when units were created.

## Consequences

- Reservation and redemption need PostgreSQL row locks; there is no cache-only path.
- Evidence: a pool of 8 worker processes (`tests/Security/Concurrency`) starts each scenario at the
  same instant through a PostgreSQL advisory lock. Scenarios: one device 8 parallel reserves (1
  success), device with an earlier reservation (1 success), 8 devices competing for 3 units (3
  successes, distinct units), item cap 2 (2 successes), 8 parallel redeems of one code (1 success),
  6 redeems against 2 releasers (no double release, statuses consistent), 6 parallel issuer calls
  (exactly `qty` units). Removing a lock or a cap made the matching test fail in the branch runs.
- Not exercised: behaviour under production replication or a connection pooler in transaction
  mode; the tests run one PostgreSQL instance.
