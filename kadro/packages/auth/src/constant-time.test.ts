import * as crypto from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { constantTimeEqual } = await import('./tokens.js');

describe('constantTimeEqual uses crypto.timingSafeEqual on fixed-length digests', () => {
  afterEach(() => {
    vi.mocked(crypto.timingSafeEqual).mockClear();
  });

  it.each([
    ['equal values', 'same-value', 'same-value', true],
    ['same length, different content', 'value-a', 'value-b', false],
    ['different length', 'short', 'a much longer value', false],
    ['empty against non-empty', '', 'x', false],
  ])('%s', (_label, a, b, expected) => {
    expect(constantTimeEqual(a, b)).toBe(expected);
    const spy = vi.mocked(crypto.timingSafeEqual);
    expect(spy).toHaveBeenCalledTimes(1);
    const [left, right] = spy.mock.calls[0] ?? [];
    expect(left).toHaveLength(32);
    expect(right).toHaveLength(32);
  });
});
