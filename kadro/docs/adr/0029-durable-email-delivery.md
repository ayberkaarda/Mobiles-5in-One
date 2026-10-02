# ADR-0029: Durable email delivery with worker-issued tokens

- Status: Accepted; supersedes the Phase 1 interim of
  [ADR-0026](0026-email-delivery-phase1-best-effort.md)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: ADR-0015, ADR-0026, ADR-0027, ADR-0028; threat model T-AUTH-08, T-AUTH-18, T-NOT-05,
  RR-9; handoff `web-to-worker-001`

## Context

Phase 1 sends verification, reset and "already registered" emails from the web process with
Next.js `after()`. Delivery is best effort (ADR-0026). Phase 2 must make delivery durable through
the `email.send` queue (ADR-0028) without ever writing a plaintext token into a job row, because
job rows are kept in the database, its backups and pg-boss archives.

Two designs keep the token out of plaintext storage:

1. The worker generates the token when it sends the email and stores only its hash.
2. The web app generates the token, stores the hash, and puts the token into the payload encrypted
   with AES-256-GCM under a key from configuration; the worker decrypts and sends.

## Decision

**Option 1: the worker issues the token.** The payload is
`{ kind, userId | null, requestId, idempotencyKey }` with `kind` in `verify_email`,
`password_reset`, `already_registered`, `deletion_scheduled`, `deletion_completed`.

### Handler

1. Validate the payload. Load the user by id inside a transaction that locks the user row.
2. Decide whether the email is still due, otherwise complete without sending:
   - `verify_email`: account exists, `email_verified_at IS NULL`, not deactivated.
   - `password_reset`: `userId` not null, account exists, has a password, not deactivated. The
     forgot endpoint enqueues one job on every call, with `userId = null` when no eligible account
     matches, so request work does not depend on account existence (ADR-0015).
   - `already_registered`, `deletion_scheduled`: account exists.
   - `deletion_completed` is not sent through this queue; see ADR-0032.
3. For token kinds: generate 256 bits from the CSPRNG, insert `email_tokens` with the SHA-256
   hash, `purpose` and `expires_at = now() + TTL` (verify 24 h, reset 1 h, unchanged from Phase 1),
   commit. The plaintext exists only in worker memory and in the sent email.
4. Render the template from `@kadro/emails` (moved out of `apps/web/emails`, see Consequences) and
   send through the configured transport. The token travels only in the URL fragment
   (`/e-posta-dogrula#token=…`, `/sifre-sifirla#token=…`, ADR-0027).
5. If the provider answers with a definite failure, the token row issued in this attempt is
   deleted first. Then a 429 or 5xx throws (retry with backoff); any other 4xx completes the job
   with the outcome `rejected_by_provider`, because the same request will not succeed later. On a
   timeout or network error the outcome is unknown: the token row is kept and the job retries.

### Token rules

- **Single use, per purpose.** Redeeming any token of a purpose marks every other open token of the
  same user and purpose as used in the same transaction (Phase 1 already does this for reset; it
  now applies to verify as well).
- **Bounded live tokens.** At most 3 unexpired, unused tokens per user and purpose; issuing a
  fourth marks the oldest as used. This bounds the effect of retries and repeated requests.
- **Lifetime starts at issue time**, so a retried email never carries a token that is already
  close to expiry.

### Loss and duplicates

- **Lost email** (provider accepted but never delivered, or all retries failed): the user requests
  again; the request rate limits of group A apply. A dead-lettered `email.send` raises the
  `job_dead_lettered` alert.
- **Duplicate email** (worker stopped after sending, before completing): the retry issues a second
  token and sends a second email. Both links work until one is redeemed, which spends the other.
  No security property depends on exactly-once delivery.
- **Stale jobs.** A token email whose job was created more than the token lifetime ago (reset 1 h,
  verify 24 h) is completed without sending and counted as `email_stale_dropped`; the user would
  otherwise receive a reset email hours after asking.

### Migration from Phase 1

The switch ships in one release, in this order:

1. `@kadro/emails` package with the existing templates and transport (moved, not rewritten).
2. Worker: `email.send` handler, queues created at start.
3. Web: register, forgot and the deletion flow call `enqueue()` inside their transactions; the
   `after()` scheduler, token creation in `account-flows.ts` and the web-side email transport are
   removed in the same change. There is no period with both paths active, so no double sending.
4. Configuration: `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM` move from the web schema to the
   worker schema; the worker also needs `WEB_ORIGIN` to build links.

Tokens issued by the Phase 1 path before the release stay valid until they expire; their rows
have the same format.

## Consequences

- No plaintext token is stored in a job row, a log line, or a backup. A database leak yields only
  hashes, as before.
- Register stays constant-work: both branches insert one user-or-nothing row and enqueue one job.
- The `email_delivery_failed` metric moves to the worker; the web process no longer talks to
  Resend at all, and `RESEND_API_KEY` leaves the web environment.
- Handoffs: `decisions-to-worker-001` (handler), `decisions-to-web-001` (enqueue, remove
  `after()`), `decisions-to-config-001` (env move).

## Rejected alternatives

- **Encrypted token in the payload (option 2).** Retries would resend the same token, but it adds a
  long-lived symmetric key whose compromise together with a backup exposes every live token in the
  queue, and it needs key rotation for in-flight jobs. The duplicate-email case it avoids is
  harmless under the single-use-per-purpose rule.
- **Keep `after()` with an in-process retry loop.** Still lost on process stop and deploy.
