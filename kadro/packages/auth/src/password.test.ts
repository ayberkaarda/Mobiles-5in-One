import { performance } from 'node:perf_hooks';

import { hash } from '@node-rs/argon2';
import { describe, expect, it, vi } from 'vitest';

import { type PasswordBreachChecker } from './hibp.js';
import {
  ARGON2ID_PARAMS,
  evaluateNewPassword,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
  warmUpPasswordHashing,
} from './password.js';

const PASSWORD = 'correct horse battery';

describe('hashPassword', () => {
  it('produces an Argon2id PHC string with m=65536, t=3, p=1', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('salts every hash', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(stored, PASSWORD)).toBe(true);
    expect(await verifyPassword(stored, `${PASSWORD}!`)).toBe(false);
  });

  it('returns false for a missing hash and for a malformed hash', async () => {
    expect(await verifyPassword(null, PASSWORD)).toBe(false);
    expect(await verifyPassword('$argon2id$garbage', PASSWORD)).toBe(false);
  });

  // Coarse smoke check only. The equal-work guarantee is asserted structurally, without timing,
  // in password-work.test.ts. Wall-clock time is noisy on shared machines (other test files and
  // packages hash in parallel on a 2-core CI runner), so even interleaved samples can drift by
  // up to ~2x either way; the 3x bounds catch only gross regressions, such as the unknown-account
  // path skipping Argon2id altogether, and must not be tightened.
  it('spends roughly the same time on unknown accounts and on wrong passwords', async () => {
    await warmUpPasswordHashing();
    const stored = await hashPassword(PASSWORD);

    async function elapsed(run: () => Promise<boolean>): Promise<number> {
      const start = performance.now();
      await run();
      return performance.now() - start;
    }
    function median(samples: number[]): number {
      const sorted = [...samples].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    }

    // Interleaved pairs, so a change in machine load during the test hits both paths alike.
    const known: number[] = [];
    const unknown: number[] = [];
    for (let index = 0; index < 15; index += 1) {
      known.push(await elapsed(() => verifyPassword(stored, 'wrong password!')));
      unknown.push(await elapsed(() => verifyPassword(null, 'wrong password!')));
    }
    const ratio = median(unknown) / median(known);
    expect(ratio).toBeGreaterThan(1 / 3);
    expect(ratio).toBeLessThan(3);
  }, 30_000);
});

describe('passwordNeedsRehash', () => {
  it('is false for hashes with the current parameters', async () => {
    expect(passwordNeedsRehash(await hashPassword(PASSWORD))).toBe(false);
  });

  it.each([
    ['memoryCost only', { memoryCost: 19_456 }],
    ['timeCost only', { timeCost: 2 }],
    ['parallelism only', { parallelism: 2 }],
    ['outputLen only', { outputLen: 64 }],
    ['algorithm only (Argon2i)', { algorithm: 1 as typeof ARGON2ID_PARAMS.algorithm }],
  ])('is true when %s differs', async (_label, change) => {
    const stale = await hash(PASSWORD, { ...ARGON2ID_PARAMS, ...change });
    expect(passwordNeedsRehash(stale)).toBe(true);
  });

  it('is true for unparseable input', () => {
    expect(passwordNeedsRehash('plain-text')).toBe(true);
  });
});

describe('evaluateNewPassword', () => {
  const clean: PasswordBreachChecker = () => Promise.resolve({ status: 'clean' });

  it('rejects passwords shorter than the contracts minimum without asking the breach service', async () => {
    const checker = vi.fn(clean);
    expect(await evaluateNewPassword('a'.repeat(9), checker)).toEqual({
      ok: false,
      code: 'validation_failed',
    });
    expect(checker).not.toHaveBeenCalled();
  });

  it('rejects passwords longer than the contracts maximum', async () => {
    expect(await evaluateNewPassword('a'.repeat(129), clean)).toEqual({
      ok: false,
      code: 'validation_failed',
    });
  });

  it('accepts a 10-character password that is not breached', async () => {
    expect(await evaluateNewPassword('a'.repeat(10), clean)).toEqual({
      ok: true,
      breachCheck: 'clean',
    });
  });

  it('rejects a breached password', async () => {
    const breached: PasswordBreachChecker = () =>
      Promise.resolve({ status: 'breached', occurrences: 3 });
    expect(await evaluateNewPassword(PASSWORD, breached)).toEqual({
      ok: false,
      code: 'password_breached',
    });
  });

  it.each(['network', 'timeout', 'http_status', 'malformed'] as const)(
    'accepts the password when the breach service is unavailable (%s) and reports the reason',
    async (reason) => {
      const down: PasswordBreachChecker = () => Promise.resolve({ status: 'unavailable', reason });
      expect(await evaluateNewPassword(PASSWORD, down)).toEqual({
        ok: true,
        breachCheck: 'unavailable',
        breachCheckReason: reason,
      });
    },
  );
});
