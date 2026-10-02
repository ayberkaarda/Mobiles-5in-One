import type * as AuthModule from '@kadro/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * T-AUTH-03: the dummy Argon2id hash used for unknown accounts is computed at server start, so
 * the first login of a fresh process is not slower for unknown emails than for known ones.
 */

const warmUpHashing = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@kadro/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  warmUpPasswordHashing: warmUpHashing,
}));

const { register } = await import('../../instrumentation');
const edge = await import('../../lib/server/auth/warm-up.edge');

afterEach(() => {
  warmUpHashing.mockClear();
});

describe('instrumentation register()', () => {
  it('warms up password hashing on the Node.js runtime', async () => {
    await register();
    expect(warmUpHashing).toHaveBeenCalledTimes(1);
  });

  it('resolves to a no-op without Argon2 for the edge runtime', async () => {
    await edge.warmUp();
    expect(warmUpHashing).not.toHaveBeenCalled();
  });
});
