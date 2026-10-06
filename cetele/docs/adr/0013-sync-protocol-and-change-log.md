# ADR-0013: Sync protocol and change log

- Status: Accepted
- Date: 2026-10-06
- Deciders: Ayberk (owner)

## Context

The app is offline first (spec section 4, sync engine). Every write to a customer or a ledger entry
is an outbox operation on the device and reaches the server through one push endpoint; every device
catches up through one pull endpoint. The spec lists no CRUD endpoints for customers or entries, so
`sync/push` is the only write path. The protocol has to survive retries after a lost response, two
devices editing the same shop, a customer deleted on one device while another still writes to it,
and a staff member whose role does not allow one of the operations in the batch.

## Options considered

- Per-entity REST endpoints with `If-Match` versions: needs an online round trip per write and
  conflict handling in the UI. Rejected (offline first).
- A pull cursor on `updated_at`: timestamps are not unique and a transaction that commits late can
  be skipped by a reader that already moved past its time. Rejected.
- A per-shop integer sequence assigned under a lock, with a full snapshot per change row: chosen.

## Decision

### Wire format

- `POST /v1/shops/{shopId}/sync/push` takes `{"operations": [...]}` with at most 500 operations.
  Each operation has `clientId` (UUID, the idempotency key), `clientSeq` (long, at least 1), a
  `kind` and its body: `CUSTOMER_UPSERT` (`customer`), `CUSTOMER_DELETE` (`customerId`) or
  `ENTRY_CREATE` (`entry`). The response is `{"results": [...], "head": n}`; a result is
  `{clientId, status, entityId?, code?, errors?}` with `status` `APPLIED`, `DUPLICATE` or
  `REJECTED`, and `head` is the shop's `last_seq` after the batch.
- `GET /v1/shops/{shopId}/sync/pull?since={seq}&limit={n}` (`since` at least 0, default 0; `limit`
  1 to 500, default 500) answers `{"changes": [...], "nextSince", "hasMore"}` ordered by `seq`. A
  change is `{seq, entity, entityId, op, at, payload}` with `entity` `CUSTOMER` or `ENTRY` and `op`
  `UPSERT` or `DELETE`. A `since` beyond the head is an empty list with `nextSince = since`.
  Out-of-range parameters are `422 validation.failed` (`SyncValidationTest`:
  `pull parameters are bounded`).
- The device id is the one in the access token, never a body field. `shop_id` is the path id,
  checked against the caller's membership first (404 for a non-member,
  [ADR-0007](0007-tenancy-and-permission-enforcement.md)).
- Rate limits: `sync.push.user` 60 per minute and `sync.pull.user` 120 per minute, keyed by user id
  (mechanism of [ADR-0009](0009-rate-limiting-and-client-ip.md)).

### Whole-batch and per-operation failures

A batch is refused as a whole with `422 validation.failed` and field codes when it has more than
500 operations (`operations` `too_long`), a `clientSeq` that is not strictly increasing in array
order (`operations[i].clientSeq` `out_of_order`, a new `FieldErrorCodes` value), a duplicate
`clientId` inside the batch (`invalid_format`), an unknown `kind` or a malformed operation shape. A
missing required JSON property inside an operation (for example no `customer.name`) is rejected by
the Jackson layer and therefore also refuses the whole batch; the device sees a 422 and must treat
it as a client bug, not as a retryable condition. Nothing of a refused batch is applied:

- `SyncValidationTest`: `batch size ordering duplicate ids and malformed shapes reject the entire batch`
- `SyncValidationTest`: `unknown operation properties and kinds reject before applying`

Everything else is reported in the operation's own result and never stops the batch (decision D-8
of the [authorization matrix](../security/authorization-matrix.md), settled here): field validation
(`validation.failed` with `errors: [{field, code}]`), a missing permission (`forbidden`),
`not_found`, `conflict`, `customer.deleted`, `ledger.already_reversed`, `ledger.reversal_mismatch`
and `plan.customer_limit`, all from the registry of
[ADR-0008](0008-problem-details-and-error-codes.md). A forbidden operation therefore rejects only
itself: a `STAFF` device that queued a customer delete sees `forbidden` for it while the
neighbouring entries apply. The action is checked per operation (`CUSTOMER_WRITE`,
`CUSTOMER_DELETE`, `LEDGER_WRITE`) after the membership gate `SHOP_READ` on the endpoint.

- `SyncPermissionTest`: `operation permissions reject only forbidden actions`
- `SyncValidationTest`: `invalid fields are rejected individually while valid neighbours apply`
- `SyncConvergenceTest`: the convergence scenario (two devices, replay, rename, deletion, reversal)

### Idempotency

The key is the operation `clientId`, never the entity id. A receipt row in `sync_outbox_receipts` is
written in the same transaction as the apply, so a replayed `clientId` answers `DUPLICATE` with the
stored `entityId` and writes nothing (`SyncConvergenceTest`:
`deleted customer replay is idempotent and revokes statement links`). A rejected operation leaves no
receipt, so the same `clientId` can be sent again once its cause is fixed. A `clientSeq` already used
by the same device with a different `clientId` is `conflict`. `clientSeq` is checked inside one
batch and per device against receipts; it is not verified across batches beyond that (accepted
risk, [threat model](../security/threat-model.md) 4.10).

### Order of checks per operation

Receipt, permission, field validation, device `clientSeq` reuse, then the rules of the kind
([ADR-0014](0014-ledger-model.md)). A customer id or entry id that belongs to another shop is
`conflict`, and an `ENTRY_CREATE` naming a customer of another shop is `conflict` too (not
`not_found`), as the isolation test expects (`SyncIsolationTest`:
`foreign entity ids conflict without changing either tenant`). This is a small existence oracle on
ids, accepted because ids are UUIDv7 chosen by the client and the answer reveals no data.

### Sequence and transactions

- Each operation runs in its own `REQUIRES_NEW` transaction. It takes the shop row lock
  (`FOR NO KEY UPDATE`) and then the `shop_sequences` row (`INSERT ... ON CONFLICT DO NOTHING` for
  the first use, `SELECT ... FOR UPDATE`, then `UPDATE ... RETURNING`), and holds both until
  commit. Duplicate detection, the customer cap and the sequence allocation run under that lock, so
  `seq` order is commit order and a reader never sees `n + 1` before `n`.
- A rolled-back operation rolls back its `last_seq` increment too, so no gap appears in practice.
  The contract allowed gaps from rollbacks; the build is stricter. Clients must still tolerate a
  gap, and the reader does:
  - `ChangeLogSequenceTest`: `rollback publishes no snapshot or sequence advancement`
  - `ChangeLogSequenceTest`: `eight concurrent writers publish unique contiguous commit ordered snapshots`
  - `ChangeLogSequenceTest`: `reader skips a reserved gap and preserves cursor order`
- The shop row lock also serialises pushes with invitation creation and statement link issuance on
  the same shop. This is acceptable at the planned scale and is the price of one lock order for
  every writer.
- A non-problem exception in the middle of a batch (a database outage) answers 500 after the
  earlier operations committed. The device retries the same batch with the same `clientId` values
  and gets `DUPLICATE` for those that already applied.

### Change log

`change_log` holds one row per change with a full snapshot of the entity as `payload` (`CustomerView`
or `EntryView`, the same classes that serialise the pull response). Pull needs no joins, and a
device that applies rows in `seq` order ends at the latest state. A reversal writes two
`ENTRY UPSERT` rows (the new entry and the original with `reversedBy`); a customer delete writes a
`CUSTOMER DELETE` row whose payload carries `deletedAt`. The log is never compacted in Phase 2.

### Engine rules for the Android client

Apply pulled rows in `seq` order and store `nextSince` only after the batch is applied; treat
`DUPLICATE` as success; mark `REJECTED` operations by `code` instead of retrying them blindly; send
`clientSeq` strictly increasing within a batch and per device; never reuse a `clientId` for a
different operation; accept gaps in `seq`. The handoff
[server-to-android-001](../handoffs/server-to-android-001-phase2-contract.md) carries the exact
shapes.

## Consequences

- Writes serialise per shop. At the scale of a small shop this costs nothing; a very hot shop would
  need a different allocator.
- The log grows with every write and keeps whole snapshots; pull cost is bounded by `limit`.
- Evidence: `SyncConvergenceTest`, `SyncValidationTest`, `SyncIsolationTest`, `SyncPermissionTest`,
  `ChangeLogSequenceTest`, `SyncLogSampleTest`, `V4LedgerSchemaTest`. Not exercised: the Android
  sync engine against this server (Phase 3).
