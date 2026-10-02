import { type Transaction } from '@kadro/db';

import { type JobSender } from './enqueue';

/**
 * `email.send` producers of the auth flows (ADR-0029). The web process sends no email and creates
 * no email token: the worker issues the token, renders the template and sends it. Payloads are
 * `{ kind, userId | null, requestId }`; keys follow handoff worker-to-web-001 §2.
 */

/** Verification email for a newly registered account. */
export function enqueueVerifyEmail(
  jobs: JobSender,
  tx: Transaction,
  input: { readonly userId: string; readonly requestId: string },
): Promise<string | null> {
  return jobs.enqueue(
    tx,
    'email.send',
    { kind: 'verify_email', userId: input.userId, requestId: input.requestId },
    { idempotencyKey: `email:verify:${input.userId}:${input.requestId}` },
  );
}

/** "Already registered" email when registration meets an existing account (ADR-0015). */
export function enqueueAlreadyRegistered(
  jobs: JobSender,
  tx: Transaction,
  input: { readonly userId: string; readonly requestId: string },
): Promise<string | null> {
  return jobs.enqueue(
    tx,
    'email.send',
    { kind: 'already_registered', userId: input.userId, requestId: input.requestId },
    { idempotencyKey: `email:registered:${input.userId}:${input.requestId}` },
  );
}

/**
 * Password reset email. Enqueued on every forgot request; `userId` is `null` when no eligible
 * account matched, so the request does the same work either way and the worker sends nothing.
 */
export function enqueuePasswordReset(
  jobs: JobSender,
  tx: Transaction,
  input: { readonly userId: string | null; readonly requestId: string },
): Promise<string | null> {
  return jobs.enqueue(
    tx,
    'email.send',
    { kind: 'password_reset', userId: input.userId, requestId: input.requestId },
    { idempotencyKey: `email:reset:${input.userId ?? 'none'}:${input.requestId}` },
  );
}
