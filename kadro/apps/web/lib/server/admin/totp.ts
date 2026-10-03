import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { LIMITS } from '@kadro/contracts';

/**
 * TOTP primitives for staff accounts (RFC 6238 over RFC 4226 HOTP, ADR-0064, ADR-0066).
 *
 * Parameters are fixed: HMAC-SHA1, 6 digits, 30-second steps, a 160-bit secret. A code is accepted
 * for the current step and one step either side; a step at or below the last accepted step is
 * refused, so a code cannot be replayed. Every candidate step is computed and compared in constant
 * time, so the response time does not reveal which step (if any) matched.
 *
 * Secrets are stored only as AES-256-GCM ciphertext under `TOTP_ENCRYPTION_KEY`, with the user id
 * as additional authenticated data: a ciphertext copied onto another account does not decrypt.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = LIMITS.totpCode.length;
/** Steps accepted on either side of the current one (authorization matrix footnote 26). */
export const TOTP_WINDOW_STEPS = 1;
/** RFC 4226 recommends at least 160 bits; the contract fixes exactly 160 (32 base32 characters). */
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ISSUER = 'Kadro';

const CIPHERTEXT_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Time step of `now` (RFC 6238 `T`, with `T0 = 0`). */
export function timeStep(now: Date): number {
  return Math.floor(now.getTime() / 1_000 / TOTP_PERIOD_SECONDS);
}

/** RFC 4226 HOTP value of `counter`, as a zero-padded decimal string of {@link TOTP_DIGITS}. */
export function hotp(secret: Buffer, counter: number): string {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new RangeError('HOTP counter must be a non-negative safe integer');
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** Code for the step containing `now`. */
export function totpAt(secret: Buffer, now: Date): string {
  return hotp(secret, timeStep(now));
}

function codesEqual(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(candidate, 'utf8');
  // Codes are validated to six digits before they get here; a length mismatch still compares a
  // buffer against itself so the work done does not depend on the input.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The step `code` belongs to, if it is one of the accepted steps around `now` and later than
 * `lastUsedStep`; otherwise `null`. Every candidate is compared, whatever matched earlier.
 */
export function matchTotpStep(
  secret: Buffer,
  code: string,
  now: Date,
  lastUsedStep: number | null,
): number | null {
  const current = timeStep(now);
  let matched: number | null = null;
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset += 1) {
    const step = current + offset;
    const equal = codesEqual(hotp(secret, step), code);
    const fresh = lastUsedStep === null || step > lastUsedStep;
    if (equal && fresh && matched === null) {
      matched = step;
    }
  }
  return matched;
}

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** RFC 4648 base32 without padding (what authenticator apps expect in `secret=`). */
export function base32Encode(bytes: Buffer): string {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET.charAt((buffer >>> bits) & 0x1f);
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) {
    output += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 0x1f);
  }
  return output;
}

const OTPAUTH_MAX_LENGTH = 512;

/** `otpauth://totp/Kadro:<account>?…` (Key Uri Format) with the fixed parameters. */
export function otpauthUri(base32Secret: string, accountName: string): string {
  const query = new URLSearchParams({
    secret: base32Secret,
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  }).toString();
  const build = (account: string) =>
    `otpauth://totp/${encodeURIComponent(TOTP_ISSUER)}:${encodeURIComponent(account)}?${query}`;
  const uri = build(accountName);
  return uri.length <= OTPAUTH_MAX_LENGTH ? uri : build('staff');
}

// ---------------------------------------------------------------------------
// Encryption at rest
// ---------------------------------------------------------------------------

/** The configured key, or `null` when TOTP is disabled (local without a key: fail closed). */
export function totpKey(encoded: string | undefined): Buffer | null {
  if (encoded === undefined || encoded === '') {
    return null;
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== KEY_BYTES) {
    throw new RangeError('TOTP_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

function aad(userId: string): Buffer {
  return Buffer.from(`kadro.totp.${CIPHERTEXT_VERSION}:${userId}`, 'utf8');
}

/** `v1.<iv>.<ciphertext>.<tag>`, each part base64url; bound to `userId`. */
export function encryptTotpSecret(key: Buffer, userId: string, secret: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(userId));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CIPHERTEXT_VERSION, iv, body, tag]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export class TotpCiphertextError extends Error {
  constructor() {
    super('stored TOTP secret cannot be decrypted');
    this.name = 'TotpCiphertextError';
  }
}

/** Decrypts a stored secret; a wrong key, user or tampered value throws {@link TotpCiphertextError}. */
export function decryptTotpSecret(key: Buffer, userId: string, stored: string): Buffer {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== CIPHERTEXT_VERSION) {
    throw new TotpCiphertextError();
  }
  const [, ivPart = '', bodyPart = '', tagPart = ''] = parts;
  const iv = Buffer.from(ivPart, 'base64url');
  const body = Buffer.from(bodyPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || body.length !== TOTP_SECRET_BYTES) {
    throw new TotpCiphertextError();
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new TotpCiphertextError();
  }
}
