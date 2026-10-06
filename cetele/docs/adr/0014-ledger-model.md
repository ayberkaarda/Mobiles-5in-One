# ADR-0014: Ledger model

- Status: Accepted
- Date: 2026-10-06
- Deciders: Ayberk (owner)

## Context

A shop keeps customers and a ledger of debts and payments (spec section 3, stories 2 to 4). Money
must never be edited silently, two devices may write the same customer offline, and the same balance
has to come out on every device, on the public statement page, in the PDF and in a reminder text.
Writes arrive only through `sync/push` ([ADR-0013](0013-sync-protocol-and-change-log.md)).

## Options considered

- Editable entries with an audit trail: simple to display, but a balance can change after a
  statement was shared. Rejected.
- Append-only entries with a reversing entry, and one balance function: chosen.
- Server-assigned ids: the device could not store an entry before the first sync. Rejected.

## Decision

### Ids and tenancy

Customer and entry ids are UUIDv7 made on the device and stored as primary keys. The idempotency
key is the operation `clientId` (`ledger_entries.client_id`, unique), not the entity id. Every table
with a `shop_id` implements `TenantScoped` and is reached through a `TenantRepository`
([ADR-0007](0007-tenancy-and-permission-enforcement.md), ArchUnit rules 1 and 2 unchanged). An entry
id is immutable: an `ENTRY_CREATE` for an existing id with a different `clientId` is `conflict`
(`ReversalRulesTest`: `entry identity and device sequence cannot be reused`).

### Entries

- `type` is `DEBT` or `PAYMENT`; `amount_minor` is a positive integer in kuruş, `1` to
  `10_000_000_000`, currency `TRY` only (`V4LedgerSchemaTest`:
  `entry range type currency due date notes and keys are enforced`). The API reports a violation as
  `out_of_range` through `@Kurus` (`SharedLimitsTest`: `kurus reports the composed range error`);
  the Android `Money` range is a Phase 3 item.
- `occurred_on` is a date and may be at most one day after today in `Europe/Istanbul`; `due_on` is
  allowed on a `DEBT` only; the note is at most 500 characters.
- `photo_key` is the processed key `media/<shopId>/<mediaId>.jpg` of the shop in the path, checked
  by regex at push and by the database constraint, so another shop's key can never be referenced
  ([ADR-0017](0017-media-pipeline.md)).

### Reversals

A reversing entry carries the same `type` and `amount_minor` as the original and
`reverses = original.id`; the original gets `reversed_by`. Rules, in the order the server applies
them: the original must exist in the shop and belong to the same customer with equal type and
amount (`ledger.reversal_mismatch`, 422), it cannot itself be a reversal (also
`ledger.reversal_mismatch`), it cannot be reversed twice (`ledger.already_reversed`, 409), and the
reversing entry carries no `due_on` and no `photo_key`. Unique constraints on `reverses` and
`reversed_by` back the rules in the database. A reversed entry stays visible, struck through with
its reversal line, on statements ([ADR-0015](0015-statement-links-and-public-page.md)).

- `V4LedgerSchemaTest`: `entry idempotency and reversal references are unique`
- `ReversalRulesTest`: `reversal must match customer type and amount and cannot reverse a reversal`

### Balance

One place computes it, `ledger.money.Balance`: the sum over entries with `reverses IS NULL AND reversed_by IS NULL`
of `+amount` for `DEBT` and `-amount` for `PAYMENT`, in exact arithmetic (overflow and an unknown
type are refused). A reversal pair therefore contributes zero whichever type was reversed. The test
fixture computes the same formula in SQL so a drift between the two shows up in the convergence
scenario.

- `BalanceTest`: `debts add and payments subtract`
- `BalanceTest`: `reversal pairs contribute zero for either type`
- `BalanceTest`: `unknown types and overflow are refused`

### Money format

`MoneyFormat.format` renders integer kuruş as `₺1.250,00` with `Locale("tr", "TR")` and a negative
as `-₺12,00`; amounts stay integers everywhere else (`MoneyFormatTest`:
`Turkish currency format preserves integer minor units`). Statement page, PDF and the reminder text
use this one function.

### Customers

- Last writer wins by the server's `updated_at`: every applied upsert sets it to `now()`, no version
  check, and rewrites every field (`SyncConvergenceTest` covers two devices renaming one customer).
- A delete is a tombstone (`deleted_at`). Tombstones win: an upsert of a deleted customer is
  rejected `customer.deleted`, and so is an entry for a deleted customer. Deleting a deleted
  customer is idempotent (`APPLIED`, no new change-log row) and revokes the customer's statement
  links.
- Phone is Turkish mobile E.164 only (`@E164Tr`, SMS targets, threat model 4.3). SMS consent needs
  evidence: `sms_consent_at` and `sms_consent_source` (`IN_PERSON`, `PHONE`, `WRITTEN`, `OTHER`) are
  required together with `sms_consent = true` by a check constraint (`V4LedgerSchemaTest`:
  `customer fields and consent evidence are enforced`).

### Plan limits

`PlanLimits.of(plan)`: customers FREE 100 and PRO unlimited, photos per month FREE 200 and PRO 2000,
reminders per month FREE 30 and PRO 500. The customer cap counts live (non-deleted) customers,
applies only to new ids (updates still work at the cap) and frees a slot on delete. The rejection is
the per-operation result `plan.customer_limit`.

- `CustomerLimitTest`: `free live customer cap allows updates and frees space after deletion`
- `CustomerLimitTest`: `pro permits more than one hundred customers`

## Consequences

- A mistaken entry is corrected with a visible pair of lines; nothing is ever rewritten.
- Last writer wins loses the earlier of two concurrent edits of the same customer. For a shop
  customer record (name, phone, note) that is accepted; entries are never merged.
- A customer tombstone cannot be undone from the client; a recreated customer gets a new id.
- Evidence: `BalanceTest`, `MoneyFormatTest`, `ReversalRulesTest`, `CustomerLimitTest`,
  `SyncConvergenceTest`, `V4LedgerSchemaTest`, `SharedLimitsTest`.
