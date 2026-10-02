import * as argon2 from '@node-rs/argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Counts the Argon2id operations behind verifyPassword instead of timing them. Equal work on both
// paths is what keeps unknown accounts from being told apart by response time (threat model
// T-AUTH-03); wall-clock comparisons cannot assert that reliably on a shared CI runner.
vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof argon2>();
  return { ...actual, hash: vi.fn(actual.hash), verify: vi.fn(actual.verify) };
});

const { hashPassword, passwordNeedsRehash, verifyPassword, warmUpPasswordHashing } =
  await import('./password.js');

const PASSWORD = 'correct horse battery';
const WRONG = 'wrong password!';
const hashSpy = vi.mocked(argon2.hash);
const verifySpy = vi.mocked(argon2.verify);

describe('verifyPassword does the same Argon2id work for unknown and known accounts', () => {
  beforeEach(() => {
    hashSpy.mockClear();
    verifySpy.mockClear();
  });

  // Runs first, before anything else in this file has touched the dummy hash.
  it('derives the dummy hash once per process, even without a warm-up', async () => {
    await Promise.all([verifyPassword(null, WRONG), verifyPassword(null, WRONG)]);
    await verifyPassword(null, WRONG);
    await warmUpPasswordHashing();
    expect(hashSpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledTimes(3);
  });

  it('runs exactly one verification and no hashing on either path once warmed up', async () => {
    await warmUpPasswordHashing();
    const stored = await hashPassword(PASSWORD);
    hashSpy.mockClear();

    expect(await verifyPassword(stored, WRONG)).toBe(false);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenLastCalledWith(stored, WRONG);

    expect(await verifyPassword(null, WRONG)).toBe(false);
    expect(verifySpy).toHaveBeenCalledTimes(2);
    expect(hashSpy).not.toHaveBeenCalled();
  });

  it('verifies unknown accounts against a hash with the production parameters', async () => {
    await warmUpPasswordHashing();
    expect(await verifyPassword(null, PASSWORD)).toBe(false);
    expect(verifySpy).toHaveBeenCalledTimes(1);
    const [dummy, password] = verifySpy.mock.calls[0] ?? [];
    expect(typeof dummy).toBe('string');
    expect(passwordNeedsRehash(dummy as string)).toBe(false);
    expect(password).toBe(PASSWORD);
    // Same verify call shape as the known-account path: no extra options that change the cost.
    expect(verifySpy.mock.calls[0]).toHaveLength(2);
  });
});
