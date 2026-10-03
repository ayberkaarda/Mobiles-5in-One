# ADR-0005: Financial record retention

- Status: Proposed: open question (needs the owner's accountant; nothing here is confirmed)
- Date: 2026-10-03
- Deciders: Ayberk (owner), with an accountant (not yet consulted)

## Context

Donation, payment-event and payout rows are financial records. Account deletion (specification
item 21) hard-deletes personal data after a 7-day grace period but keeps donation rows with
`donor_id = NULL` and an `anonymized_at` timestamp, because payment records may have to be retained
for accounting. The retention period has not been confirmed with an accountant. This record does
not give legal or tax advice.

## Open question

For how many years must the following be retained, and in what form?

- `donations`, `payment_events` and `payouts` rows and provider settlement references.
- Merchant tax number and IBAN (stored encrypted) after a shop is closed.
- Invoices or receipts, if the commission generates any.

## Sample value (not confirmed)

For the scheduled purge job and its tests, the project uses a configurable retention of **10
years** after the end of the calendar year of the record. This is a sample value chosen to be
conservative. It has not been verified against any statute and may be wrong for this product.

## Decision

- Retention is a single configuration value read through `config/*.php`; no code hard-codes it.
- Until the open question is answered, no automatic deletion of financial rows runs in any
  environment; only the documented personal-data removal on account deletion applies.
- Financial rows hold no donor identity after anonymisation: only amounts, ids, provider
  references and timestamps.
- The answer, once obtained, is recorded in a new ADR that supersedes this one.

## Consequences

- Implementation can proceed with the anonymisation behaviour and a configurable value; the purge
  job stays disabled.
- The real value affects the privacy notice text (sample-labelled in this portfolio) and backup
  retention.
- This stays listed as an open owner action in every delivery report (see ADR-0006, gate G15).
