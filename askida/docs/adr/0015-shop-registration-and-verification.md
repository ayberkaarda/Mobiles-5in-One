# ADR-0015: Shop registration and verification states

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification section 3 (merchant stories) and section 6 item 4 require that a shop is visible to
donors and recipients only after a moderator approved it, and that a merchant cannot change the
facts that were approved without a new review. The admin panel is a Phase 3 deliverable, so Phase 2
must ship the state machine as a service that the panel and a local command can both call.

## Decision

### Registration

- `POST shops` (merchant token, not staff of any shop) creates the shop with
  `verification_state = pending` and an `owner` membership for the caller.
- Accepted input: name, type (`bakery|restaurant|grocery|stationery|cafe|other`), address, il, ilce,
  latitude and longitude (inside the Türkiye bounding box), phone (normalised to `+90XXXXXXXXXX`),
  tax number (10 digits, VKN checksum), IBAN (TR, 26 characters, mod-97, spaces and case
  normalised) and the `listed_on_web` consent.
- Prohibited in the body (a request that names them fails validation): id, owner, slug,
  verification state, verification time, `is_sample`, the provider sub-merchant key, the `*_enc`
  columns and the location column.
- Tax number and IBAN are stored in the encrypted columns only. The owner sees them masked to the
  last four characters; no other role receives them.

### States and transitions

`App\Domain\Shops\Services\ShopVerificationService` is the only writer of `verification_state`:

| From       | To         | Operation  | Caller                                                  |
| ---------- | ---------- | ---------- | ------------------------------------------------------- |
| `pending`  | `verified` | `verify`   | `admin` or `moderator` (gate `manage-shops`)            |
| `pending`  | `rejected` | `reject`   | `admin` or `moderator` (gate `manage-shops`)            |
| `rejected` | `pending`  | `resubmit` | shop owner (also on any real edit of the rejected shop) |
| `verified` | `pending`  | `reopen`   | shop owner, on a sensitive field change                 |

Any other transition throws `IllegalVerificationTransition` (409 `conflict`). The shop row is locked
`FOR UPDATE` during a transition. Each transition writes an `activity_log` entry (log name `shops`,
events `shop.verified`, `shop.rejected`, `shop.resubmitted`, `shop.reopened`,
`shop.sensitive_change`) whose properties hold state names and field names only, plus subject and
causer ids. `ShopVerified` and `ShopRejected` are dispatched after commit with ids only. A request that
carries an API token is refused by the gate, so a merchant or donor token never reaches it.

Until the panel exists the service is exposed as
`php artisan shops:verify {shop id|slug} [--reject] --actor=<email>`; it refuses a missing or unknown
actor, a role without `manage-shops` and a shop that is not `pending`.

### Sensitive fields (settles draft rule D-2)

Address, il, ilce, location, tax number and IBAN are sensitive. Only a real change counts:
encrypted values are compared after decryption and coordinates within 1e-7 degrees. A verified shop
that changes one goes back to `pending`; a rejected shop with any real change is re-submitted; the
slug never changes on edit. `PATCH shops/{id}` is owner-only (staff get 403, non-members 404).

## Consequences

- The Phase 3 panel calls the service and adds no transition logic of its own.
- A merchant who fixes a typo in the address loses visibility until the next review; this is
  intentional because the address is part of what the moderator checked.
- `GET shops` (the directory) lists verified shops only. The matrix note that members also see their
  own unverified shop in the list is not implemented; members see it through `GET shops/{slug}`
  (ADR-0016).
- Evidence for the transitions and the command is in `tests/Unit/Shops` and `tests/Feature/Api/Shops`.
