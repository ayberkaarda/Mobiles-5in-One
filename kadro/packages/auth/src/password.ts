import { randomBytes } from 'node:crypto';

import { newPasswordSchema } from '@kadro/contracts';
import { type Algorithm, hash, type Options, parseOptions, verify } from '@node-rs/argon2';

import { type BreachCheckResult, type PasswordBreachChecker } from './hibp.js';

/**
 * Argon2id parameters from the security checklist (item 11): 64 MiB memory, 3 passes, 1 lane.
 * `Algorithm` is an ambient const enum, so its numeric value is spelled out here (2 = Argon2id).
 */
export const ARGON2ID_PARAMS = {
  algorithm: 2 as Algorithm.Argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

/** Hashes a password with Argon2id and a random 16-byte salt. Returns a `$argon2id$` PHC string. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_PARAMS);
}

let dummyHash: Promise<string> | undefined;

/**
 * PHC string with the production parameters whose plaintext nobody knows. Verifying against it
 * costs the same as verifying a real hash, so unknown accounts and social-only accounts cannot be
 * told apart by response time (threat model T-AUTH-03).
 */
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hash(randomBytes(32), ARGON2ID_PARAMS);
  return dummyHash;
}

/** Computes the dummy hash ahead of the first login so the first request is not slower. */
export async function warmUpPasswordHashing(): Promise<void> {
  await dummyPasswordHash();
}

/**
 * Verifies `password` against the stored hash in constant work: when the account does not exist
 * or has no password (`storedHash` is `null`), a full Argon2id verification against a dummy hash
 * runs anyway and the result is `false`. Malformed stored hashes also yield `false`.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash === null) {
    await verifySafely(await dummyPasswordHash(), password);
    return false;
  }
  return verifySafely(storedHash, password);
}

async function verifySafely(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

/**
 * `true` when a stored hash was produced with parameters other than {@link ARGON2ID_PARAMS}; the
 * caller rehashes the password after a successful login.
 */
export function passwordNeedsRehash(storedHash: string): boolean {
  try {
    const options = parseOptions(storedHash);
    return (
      options.algorithm !== ARGON2ID_PARAMS.algorithm ||
      options.memoryCost !== ARGON2ID_PARAMS.memoryCost ||
      options.timeCost !== ARGON2ID_PARAMS.timeCost ||
      options.parallelism !== ARGON2ID_PARAMS.parallelism ||
      options.outputLen !== ARGON2ID_PARAMS.outputLen
    );
  } catch {
    return true;
  }
}

type UnavailableReason = Extract<BreachCheckResult, { status: 'unavailable' }>['reason'];

export type NewPasswordVerdict =
  | { ok: true; breachCheck: 'clean' }
  /** Accepted without a breach answer; `breachCheckReason` is meant for logs and metrics. */
  | { ok: true; breachCheck: 'unavailable'; breachCheckReason: UnavailableReason }
  | { ok: false; code: 'validation_failed' | 'password_breached' };

/**
 * Policy for a password chosen at registration or reset: the length rule from
 * `@kadro/contracts` (`LIMITS.password`, min 10) and the Have I Been Pwned range check.
 *
 * When the breach service is unreachable the password is accepted (`breachCheck: 'unavailable'`)
 * so registration does not depend on a third party; the caller records the event with
 * `breachCheckReason`. The length
 * rule, Argon2id and the auth rate limits stay in force regardless.
 */
export async function evaluateNewPassword(
  password: string,
  breachChecker: PasswordBreachChecker,
): Promise<NewPasswordVerdict> {
  if (!newPasswordSchema.safeParse(password).success) {
    return { ok: false, code: 'validation_failed' };
  }
  const result = await breachChecker(password);
  switch (result.status) {
    case 'breached':
      return { ok: false, code: 'password_breached' };
    case 'unavailable':
      return { ok: true, breachCheck: 'unavailable', breachCheckReason: result.reason };
    case 'clean':
      return { ok: true, breachCheck: 'clean' };
  }
}
