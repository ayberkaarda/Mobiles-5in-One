import { type EmailSendJob } from '@kadro/contracts';
import {
  type Database,
  type EmailTokenPurpose,
  type Transaction,
  deletionRequests,
  emailTokens,
  users,
} from '@kadro/db';
import {
  EmailDeliveryError,
  type EmailTransport,
  type RenderedEmail,
  alreadyRegisteredMessage,
  deletionScheduledMessage,
  passwordResetMessage,
  verifyEmailMessage,
} from '@kadro/emails';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { type Clock } from '../clock.js';
import { hasReceipt, insertReceipt } from '../idempotency.js';
import { type JobContext, TransientJobError } from '../job-runner.js';
import { type Metrics } from '../metrics.js';
import { EMAIL_TOKEN_TTL_MS, generateEmailToken, issueEmailToken } from './tokens.js';

const QUEUE = 'email.send';

/** Never a real user id (UUIDv7 ids never have version nibble 0). */
const NO_USER_ID = '00000000-0000-0000-0000-000000000000';

const TOKEN_PURPOSE: Readonly<Record<EmailSendJob['kind'], EmailTokenPurpose | null>> = {
  verify_email: 'verify',
  password_reset: 'reset',
  already_registered: null,
  deletion_scheduled: null,
};

export interface EmailHandlerDependencies {
  readonly db: Database;
  readonly transport: EmailTransport;
  readonly webOrigin: string;
  readonly clock: Clock;
  readonly metrics: Metrics;
}

interface Recipient {
  readonly email: string;
  readonly displayName: string;
}

type Prepared =
  | { readonly due: false; readonly outcome: string }
  | {
      readonly due: true;
      readonly recipient: Recipient;
      readonly message: RenderedEmail;
      readonly tokenId: string | null;
    };

type UserRow = typeof users.$inferSelect;

/** Locks the user row; a job without a user runs the same statement shape on a nil id. */
async function lockUser(tx: Transaction, userId: string | null): Promise<UserRow | undefined> {
  const [row] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId ?? NO_USER_ID))
    .for('update');
  return row;
}

async function pendingGraceUntil(tx: Transaction, userId: string): Promise<Date | undefined> {
  const [row] = await tx
    .select({ graceUntil: deletionRequests.graceUntil })
    .from(deletionRequests)
    .where(and(eq(deletionRequests.userId, userId), isNull(deletionRequests.completedAt)))
    .orderBy(desc(deletionRequests.requestedAt))
    .limit(1);
  return row?.graceUntil;
}

/** Decides whether the email is still due (ADR-0029 step 2) and issues its token if it needs one. */
async function prepare(
  tx: Transaction,
  job: EmailSendJob,
  dependencies: EmailHandlerDependencies,
): Promise<Prepared> {
  const now = dependencies.clock.now();
  const user = await lockUser(tx, job.userId);
  const purpose = TOKEN_PURPOSE[job.kind];
  // Generated for every token kind, also when nothing is sent, so the work done does not depend
  // on whether an account matched (ADR-0015).
  const generated = purpose === null ? null : generateEmailToken();

  if (user === undefined || user.isTombstone) {
    return { due: false, outcome: job.userId === null ? 'no_account' : 'not_due' };
  }
  const active = user.deactivatedAt === null;
  const origin = dependencies.webOrigin;
  const recipient = { email: user.email, displayName: user.displayName };

  switch (job.kind) {
    case 'verify_email':
    case 'password_reset': {
      const eligible =
        job.kind === 'verify_email'
          ? active && user.emailVerifiedAt === null
          : active && user.passwordHash !== null;
      if (!eligible || generated === null || purpose === null) {
        return { due: false, outcome: 'not_due' };
      }
      const tokenId = await issueEmailToken(tx, {
        userId: user.id,
        purpose,
        hash: generated.hash,
        now,
      });
      const input = { origin, displayName: user.displayName, token: generated.token };
      const message =
        job.kind === 'verify_email' ? verifyEmailMessage(input) : passwordResetMessage(input);
      return { due: true, recipient, message, tokenId };
    }
    case 'already_registered':
      return {
        due: true,
        recipient,
        message: alreadyRegisteredMessage({ origin, displayName: user.displayName }),
        tokenId: null,
      };
    case 'deletion_scheduled': {
      const graceUntil = await pendingGraceUntil(tx, user.id);
      if (graceUntil === undefined) {
        return { due: false, outcome: 'not_due' };
      }
      return {
        due: true,
        recipient,
        message: deletionScheduledMessage({
          origin,
          displayName: user.displayName,
          graceUntil,
        }),
        tokenId: null,
      };
    }
  }
}

async function deleteToken(db: Database, tokenId: string | null): Promise<void> {
  if (tokenId !== null) {
    await db.delete(emailTokens).where(eq(emailTokens.id, tokenId));
  }
}

/** `email.send` (ADR-0029): the worker issues the token, stores only its hash and sends the link. */
export function createEmailHandler(dependencies: EmailHandlerDependencies) {
  const { db, transport, clock, metrics } = dependencies;

  return async (job: EmailSendJob, context: JobContext): Promise<string> => {
    if (await hasReceipt(db, QUEUE, job.idempotencyKey)) {
      return 'duplicate';
    }

    const purpose = TOKEN_PURPOSE[job.kind];
    if (
      purpose !== null &&
      // eslint-disable-next-line security/detect-object-injection -- purpose is a typed EmailTokenPurpose key
      clock.now().getTime() - context.createdOn.getTime() > EMAIL_TOKEN_TTL_MS[purpose]
    ) {
      metrics.increment('email_stale_dropped', { kind: job.kind });
      await insertReceipt(db, QUEUE, job.idempotencyKey);
      return 'stale_dropped';
    }

    const prepared = await db.transaction(async (tx) => {
      const result = await prepare(tx, job, dependencies);
      if (!result.due) {
        // Not due: the decision is final, so the receipt commits with it.
        await insertReceipt(tx, QUEUE, job.idempotencyKey);
      }
      return result;
    });
    if (!prepared.due) {
      return prepared.outcome;
    }

    try {
      await transport.send(
        { kind: job.kind, to: prepared.recipient.email, ...prepared.message },
        context.signal,
      );
    } catch (error) {
      if (!(error instanceof EmailDeliveryError)) {
        await deleteToken(db, prepared.tokenId);
        throw error;
      }
      metrics.increment('email_delivery_failed', {
        kind: job.kind,
        reason: error.reason,
        ...(error.status === undefined ? {} : { status: error.status }),
      });
      if (!error.definite) {
        // Unknown outcome: the email may have been delivered, so its link stays valid.
        throw new TransientJobError(error.message);
      }
      await deleteToken(db, prepared.tokenId);
      if (error.retryable) {
        throw new TransientJobError(error.message);
      }
      await insertReceipt(db, QUEUE, job.idempotencyKey);
      return 'rejected_by_provider';
    }

    await insertReceipt(db, QUEUE, job.idempotencyKey);
    return 'sent';
  };
}
