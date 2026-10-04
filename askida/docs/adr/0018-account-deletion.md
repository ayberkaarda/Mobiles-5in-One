# ADR-0018: Account deletion, grace period and hard delete

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Specification section 6 item 21 requires real deletion with a grace period, anonymised donation
rows, special rules for merchants and an end-to-end proof that no personal data remains. Financial
records have a retention question that is still open (ADR-0005).

## Decision

### Request and re-authentication

- `DELETE me` (donor or merchant token, shares the `auth` limiter) answers 202
  `{status: pending, grace_until}`. The caller proves identity again: password accounts send
  `password`; Apple and Google accounts send `provider`, `id_token` and `nonce`. The token goes
  through the existing identity verifier (signature, issuer, audience, expiry, client nonce) and its
  `sub` must equal the account's stored subject for that provider (constant-time compare). The
  verifier exposes no issue time, so freshness is the provider token lifetime plus the nonce. An
  account linked to a password may use either proof.
- On acceptance the account is deactivated at once (`deactivated_at`), every token and push token is
  removed, a `deletion_requests` row is stored (state `pending`, `grace_until` = now + 7 days) and a
  confirmation mail is queued. The request row holds no personal data and survives with
  `user_id = NULL`.
- The web page `GET|POST /hesap-silme` (Blade, CSRF, CSP nonce) offers the same flow for password
  accounts; Apple and Google accounts are told to use the app. All failure cases render the same page.

### Grace period

A successful sign-in with password, Apple or Google during the grace period cancels the request
(`status = cancelled`) and clears `deactivated_at`. After `grace_until` sign-in is refused with the
same 401 as any failure. An account deactivated without a pending request (for example by an
administrator) is never reactivated by signing in.

### Merchants

While a shop owned solely by the user has `AVAILABLE` or `RESERVED` hooks, the request is refused
with 409 `shop.has_open_hooks`. The check runs at request time and again at hard delete (units can
be issued during the grace period); the job then leaves the request pending, logs
`account.hard_delete_deferred` with ids only and retries hourly. Co-owned shops do not block.

### Hard delete (job `accounts.hard-delete`, hourly, unique, without overlap)

- Removed: the user row, KVKK consents (including `ip_hash`), access tokens, reset tokens, push
  tokens, memberships, roles and permissions, shop documents (object first, then row).
- Donations keep their rows with `donor_id = NULL` and `anonymized_at` set;
  `hooks.redeemed_by_user_id` becomes `NULL`.
- `activity_log` entries about the user keep only identifiers: property values that are not integers
  or UUIDs are dropped, recursively.
- Shops owned solely by the user: a shop with no donations and no payouts is deleted with its items.
  A shop that financial rows reference cannot be deleted (foreign keys restrict, ADR-0005), so it
  stays as an ownerless closed anchor stripped of merchant data: `owner_id` null, name, address and
  slug replaced by neutral constants, phone empty, tax number and IBAN null, state `rejected`,
  `listed_on_web` false, location rounded to one decimal degree (about 10 km). The provider
  sub-merchant key is kept only while a payout of that shop is `pending` or `held`. A co-owned shop
  passes to the earliest remaining owner member.

### Proof

The "no residual personal data" tests (donor and merchant variants) walk
`information_schema.columns` for every text, varchar, char, json and jsonb column and count rows
containing the e-mail, name, provider subjects, raw address, KVKK hash, IBAN, tax number and the old
shop name, slug, address and phone; they first assert the walk finds the values before erasure and
zero afterwards. A second walk decrypts every encrypted-cast column of every domain model and
asserts no remaining value equals the deleted account's tax numbers or IBANs.

## Consequences

- Retention of payment records beyond the anonymised rows stays open under ADR-0005; this record
  only guarantees that personal data of the account and merchant PII of closed shops are wiped.
- During the grace period a merchant's shops stay visible; hiding them at deactivation is a
  suggestion, not built.
- Anonymous recipients are deleted by a separate immediate flow (ADR-0019).
- Not exercised: the confirmation mail through a real SMTP service (the tests fake the mailer) and
  Apple or Google tokens from real providers (fixtures only, ADR-0006).
