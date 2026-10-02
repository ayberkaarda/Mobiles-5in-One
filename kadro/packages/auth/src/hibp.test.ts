import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createBreachChecker, type FetchLike, findSuffixCount, sha1RangeParts } from './hibp.js';

const PASSWORD = 'password1234';
const { prefix, suffix } = sha1RangeParts(PASSWORD);

function otherSuffix(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').toUpperCase().slice(5);
}

function respond(body: string, status = 200): FetchLike {
  return vi.fn<FetchLike>(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    }),
  );
}

describe('sha1RangeParts', () => {
  it('splits the uppercase SHA-1 into a 5-character prefix and a 35-character suffix', () => {
    const digest = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();
    expect(prefix).toBe(digest.slice(0, 5));
    expect(suffix).toBe(digest.slice(5));
    expect(suffix).toHaveLength(35);
  });
});

describe('findSuffixCount', () => {
  it('ignores padding rows with a zero count', () => {
    expect(findSuffixCount(`${suffix}:0\r\n${otherSuffix('a')}:4`, suffix)).toBe(0);
  });

  it('returns null for a malformed body', () => {
    expect(findSuffixCount('<html>maintenance</html>', suffix)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['blank lines only', '\r\n\r\n  \n'],
  ])('returns null for an %s body', (_label, body) => {
    expect(findSuffixCount(body, suffix)).toBeNull();
  });
});

describe('createBreachChecker', () => {
  it('sends only the 5-character prefix and asks for padding', async () => {
    const fetch = respond(`${otherSuffix('a')}:2\r\n`);
    await createBreachChecker({ fetch })(PASSWORD);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(url).not.toContain(suffix);
    expect(init?.headers).toEqual({ 'Add-Padding': 'true' });
  });

  it('reports a breached password with its count', async () => {
    const fetch = respond(`${otherSuffix('a')}:2\r\n${suffix}:42\r\n${otherSuffix('b')}:0`);
    expect(await createBreachChecker({ fetch })(PASSWORD)).toEqual({
      status: 'breached',
      occurrences: 42,
    });
  });

  it('matches suffixes case-insensitively', async () => {
    const fetch = respond(`${suffix.toLowerCase()}:7`);
    expect(await createBreachChecker({ fetch })(PASSWORD)).toEqual({
      status: 'breached',
      occurrences: 7,
    });
  });

  it('reports a clean password', async () => {
    const fetch = respond(`${otherSuffix('a')}:2\r\n${otherSuffix('b')}:9\r\n`);
    expect(await createBreachChecker({ fetch })(PASSWORD)).toEqual({ status: 'clean' });
  });

  it('is unavailable on a network error', async () => {
    const fetch: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
    expect(await createBreachChecker({ fetch })(PASSWORD)).toEqual({
      status: 'unavailable',
      reason: 'network',
    });
  });

  it('is unavailable on a non-2xx status', async () => {
    expect(await createBreachChecker({ fetch: respond('', 503) })(PASSWORD)).toEqual({
      status: 'unavailable',
      reason: 'http_status',
    });
  });

  it.each(['', '\r\n\r\n'])('is unavailable on an empty 200 body %j', async (body) => {
    expect(await createBreachChecker({ fetch: respond(body) })(PASSWORD)).toEqual({
      status: 'unavailable',
      reason: 'malformed',
    });
  });

  it('is unavailable on a malformed body', async () => {
    expect(await createBreachChecker({ fetch: respond('{"error":true}') })(PASSWORD)).toEqual({
      status: 'unavailable',
      reason: 'malformed',
    });
  });

  it('is unavailable after the timeout', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    expect(await createBreachChecker({ fetch, timeoutMs: 20 })(PASSWORD)).toEqual({
      status: 'unavailable',
      reason: 'timeout',
    });
  });
});
