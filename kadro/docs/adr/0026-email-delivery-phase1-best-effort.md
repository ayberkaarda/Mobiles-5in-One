# ADR-0026: Auth email delivery — best effort in Phase 1, durable job in Phase 2

- Status: Superseded by [ADR-0029](0029-durable-email-delivery.md) (Phase 2 durable delivery)
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §4 (worker queues); ADR-0015; threat model T-AUTH-18, RR-9

## Context

Register, forgot-password and reset send emails (verification, reset, "already registered").
ADR-0015 requires that sending never delays the response, so response time does not reveal whether
an account exists. The worker has no job handlers in Phase 1, so the `email.send` queue from the
product spec is not available yet.

## Decision

**Phase 1 (interim).** The web process sends the email after the response with Next.js `after()`.
Response timing is independent of the account branch. Delivery is best effort: if the provider
call fails or the process stops before the deferred task runs, the email is lost. Each failure is
logged as the metric `email_delivery_failed` without personal data.

**Phase 2 (target).** A pg-boss job `email.send` in `apps/worker` with retry and backoff replaces
the deferred task. The job payload carries `kind`, `userId` and at most an `email_tokens` row id,
never a plaintext token: the worker issues or re-issues the token itself. The web side enqueues in
the same transaction as the user row (register) or right after the lookup (forgot).

**Transport configuration.** `EMAIL_TRANSPORT` is `log` or `resend`. `log` (writes the email to the
local log) is allowed only with `APP_ENV=local`; the `@kadro/config` schema and the transport
factory both refuse it elsewhere. Preview and production require `EMAIL_TRANSPORT=resend`,
`RESEND_API_KEY` and `EMAIL_FROM`, and fail at boot without them. `RESEND_API_KEY` is on the secret
rotation list of the history-purge runbook.

## Risk accepted for Phase 1

- A lost verification or reset email is not retried. The user recovers by requesting it again:
  "Şifremi unuttum" sends a new reset link, and redeeming a reset link also marks the email as
  verified, so it covers a lost verification email as well.
- The `email_delivery_failed` counter makes provider outages visible; a non-zero rate in preview or
  production is reviewed at the Phase 2 gate.

## Consequences

- Phase 2 must deliver `email.send` before any production launch; the Phase 1 path is not a release
  configuration for production traffic.
- Tracked for the worker owner in handoff `web-to-worker-001`.
