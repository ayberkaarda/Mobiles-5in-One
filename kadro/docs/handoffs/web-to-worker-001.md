# Handoff web → worker 001

- From: `apps/web` auth endpoints (Phase 1)
- To: owner of `apps/worker`
- Status: resolved (decision recorded in ADR-0026: `email.send` job with retries is a Phase 2 worker deliverable, required before production)

## Durable delivery of auth emails (`email.send`)

ADR-0015 says register and forgot "enqueue" their emails so that response time does not depend on
account existence. `apps/worker` has no job handlers yet, so Phase 1 sends these emails from the
web process **after the response** (Next.js `after()`, `apps/web/lib/server/auth/services.ts`).
Response timing is therefore already independent of the account branch, but delivery is not
durable: an email whose send fails, or whose process stops before `after()` runs, is lost (the
failure is logged as `email_delivery_failed` without personal data; the user can request it
again).

Request: a pg-boss job `email.send` in `apps/worker` with retry and backoff, taking
`{ kind: 'verify_email' | 'password_reset' | 'already_registered', userId, emailTokenId? }`.
The worker renders the template from `apps/web/emails` (move to a shared package if needed) and
must never receive a plaintext token in the job payload: it issues the token row itself, or the
web side stores only the hash and the worker re-issues. Once the job exists, the web side
replaces the deferred task in `account-flows.ts` with an enqueue in the same transaction as the
user row (`register`) or after the lookup (`forgot`).

Related: the cleanup of expired `email_tokens` and `refresh_tokens` rows (and stale
`rate_limit_buckets` keys, see `kadro-p1-api-infra` open issue 9) also belongs in the worker.
