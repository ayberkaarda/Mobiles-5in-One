import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Entropy of opaque refresh, session and email tokens: 256 bits → 43 base64url characters. */
export const OPAQUE_TOKEN_BYTES = 32;

/**
 * New opaque token from the operating system CSPRNG, base64url without padding. Matches
 * `opaqueTokenSchema` of `@kadro/contracts` (43..128 characters of `[A-Za-z0-9_-]`).
 */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/**
 * Lowercase hex SHA-256 of a token: the only form stored in `refresh_tokens.token_hash` and
 * `email_tokens.token_hash` (64 characters, checked by the database). Lookups hash the presented
 * token and query by this value, so the plaintext never reaches the database.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time string equality. Both values are reduced to fixed-length HMAC digests under a
 * per-call random key first, so neither the content nor the length of either input leaks through
 * timing. Use for secrets compared outside the database (webhook secret, CSRF token pair).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const key = randomBytes(32);
  const digestA = createHmac('sha256', key).update(a, 'utf8').digest();
  const digestB = createHmac('sha256', key).update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

// ---------------------------------------------------------------------------
// Email tokens (verification and password reset)
// ---------------------------------------------------------------------------

export type EmailTokenPurpose = 'verify' | 'reset';

/**
 * Lifetime per purpose. Verification links stay valid for a day; reset links are short-lived
 * because they grant account takeover (threat model T-AUTH-08).
 */
export const EMAIL_TOKEN_TTL_SECONDS = {
  verify: 86_400,
  reset: 3_600,
} as const satisfies Record<EmailTokenPurpose, number>;

export interface IssuedEmailToken {
  /** Sent to the user once inside the email link; never stored or logged. */
  token: string;
  /** Values for the `email_tokens` row. */
  row: { purpose: EmailTokenPurpose; tokenHash: string; expiresAt: Date };
}

export function issueEmailToken(
  purpose: EmailTokenPurpose,
  now: Date = new Date(),
): IssuedEmailToken {
  const token = generateOpaqueToken();
  const ttlSeconds =
    purpose === 'verify' ? EMAIL_TOKEN_TTL_SECONDS.verify : EMAIL_TOKEN_TTL_SECONDS.reset;
  return {
    token,
    row: {
      purpose,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1_000),
    },
  };
}

/** The `email_tokens` columns the redemption check reads; `null` when the hash matched no row. */
export interface StoredEmailToken {
  purpose: EmailTokenPurpose;
  expiresAt: Date;
  usedAt: Date | null;
}

export type EmailTokenVerdict = { ok: true } | { ok: false; code: 'token_invalid' };

/**
 * Matrix footnote 2: the token row must exist, match the purpose, be unexpired and unused. Every
 * failure is the same `token_invalid` so the reason is not disclosed. The caller marks the row
 * used (`UPDATE ... SET used_at = now() WHERE id = $1 AND used_at IS NULL`) in the same
 * transaction as the effect and treats zero updated rows as `token_invalid`.
 */
export function evaluateEmailToken(
  stored: StoredEmailToken | null,
  purpose: EmailTokenPurpose,
  now: Date = new Date(),
): EmailTokenVerdict {
  if (
    stored === null ||
    stored.purpose !== purpose ||
    stored.usedAt !== null ||
    stored.expiresAt.getTime() <= now.getTime()
  ) {
    return { ok: false, code: 'token_invalid' };
  }
  return { ok: true };
}
