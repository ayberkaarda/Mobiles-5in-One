# ADR-0015: Register and forgot-password never reveal account existence

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §6 items 5, 11, 13; authorization matrix §3.1; threat model T-AUTH-03

## Context

If `POST auth/register` returned 201 with a session for a new email and 409 for an existing one, or
`POST auth/forgot` returned 404 for unknown emails, an attacker could enumerate registered
accounts, which is personal data under KVKK and a starting list for credential stuffing.

## Decision

- `POST auth/register` always returns 202 with the same body, whether or not the email exists.
  - New email: the account is created unverified and a verification email is queued.
  - Existing email: nothing is changed and an "already registered" email with login and reset links
    is queued to that address.
  - No session or token is issued; the client proceeds to `POST auth/login`. Login works before
    verification; **V** actions stay blocked until the email is verified.
- `POST auth/forgot` always returns 202 with the same body; a reset email is queued only when the
  account exists and has a password.
- Both paths do the same work before responding: the password is hashed with Argon2id on both
  register branches, and emails are always enqueued (`email.send`) rather than sent inline, so
  response time does not depend on account existence.
- Validation errors (400) and rate limits (429, group A) apply before the existence check and are
  identical for both cases.

## Consequences

- Registration takes one extra round trip (register, then login).
- Response-diff and timing tests in the attack suite cover register and forgot for existing and
  unknown emails.
