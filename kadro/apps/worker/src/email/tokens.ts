import { createHash, randomBytes } from 'node:crypto';

import { type EmailTokenPurpose, type Transaction, emailTokens } from '@kadro/db';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';

import { HOUR_MS } from '../clock.js';

/** Token lifetimes, unchanged from Phase 1 (ADR-0029). */
export const EMAIL_TOKEN_TTL_MS: Readonly<Record<EmailTokenPurpose, number>> = {
  verify: 24 * HOUR_MS,
  reset: HOUR_MS,
};

/** At most this many unexpired, unused tokens per user and purpose (ADR-0029). */
export const MAX_LIVE_TOKENS = 3;

export interface GeneratedToken {
  /** Plaintext: lives only in worker memory and in the sent email. */
  readonly token: string;
  /** Lowercase hex SHA-256 stored in `email_tokens.token_hash`. */
  readonly hash: string;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 256 bits from the CSPRNG, base64url (43 characters, the format of ADR-0040). */
export function generateEmailToken(): GeneratedToken {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256Hex(token) };
}

/**
 * Inserts a token row with a lifetime starting now. Before inserting, the oldest live tokens of the
 * same user and purpose are marked used so that at most {@link MAX_LIVE_TOKENS} remain live.
 */
export async function issueEmailToken(
  tx: Transaction,
  input: {
    readonly userId: string;
    readonly purpose: EmailTokenPurpose;
    readonly hash: string;
    readonly now: Date;
  },
): Promise<string> {
  const live = await tx
    .select({ id: emailTokens.id })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, input.userId),
        eq(emailTokens.purpose, input.purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, input.now),
      ),
    )
    .orderBy(asc(emailTokens.createdAt), asc(emailTokens.id))
    .for('update');
  const excess = live.length - (MAX_LIVE_TOKENS - 1);
  if (excess > 0) {
    await tx
      .update(emailTokens)
      .set({ usedAt: input.now, updatedAt: input.now })
      .where(
        inArray(
          emailTokens.id,
          live.slice(0, excess).map((row) => row.id),
        ),
      );
  }
  const [row] = await tx
    .insert(emailTokens)
    .values({
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.hash,
      expiresAt: new Date(input.now.getTime() + EMAIL_TOKEN_TTL_MS[input.purpose]),
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: emailTokens.id });
  if (!row) {
    throw new Error('email token insert returned no row');
  }
  return row.id;
}
