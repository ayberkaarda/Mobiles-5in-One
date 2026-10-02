import { describe, expect, it } from 'vitest';

import { createClientIpResolver, normalizeIp, rateLimitSubject } from '../lib/server/client-ip';

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

describe('normalizeIp', () => {
  it('accepts plain, bracketed and port-suffixed addresses', () => {
    expect(normalizeIp(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(normalizeIp('203.0.113.7:51234')).toBe('203.0.113.7');
    expect(normalizeIp('[2001:DB8::1]:443')).toBe('2001:db8::1');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('rejects anything that is not an address', () => {
    for (const value of ['', 'unknown', 'evil.example', '999.1.1.1', '[::1', '1.2.3.4:abc']) {
      expect(normalizeIp(value), value).toBeNull();
    }
  });
});

describe('x-forwarded-for with trusted proxies', () => {
  const resolver = createClientIpResolver({
    CLIENT_IP_HEADER: 'x-forwarded-for',
    TRUSTED_PROXY_CIDRS: ['10.0.0.0/8', '::1/128'],
  });

  it('skips trusted hops from the right and returns the first untrusted one', () => {
    expect(resolver.resolve(headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.5' }))).toBe(
      '203.0.113.7',
    );
    expect(
      resolver.resolve(headers({ 'x-forwarded-for': '203.0.113.7, 10.1.2.3, 10.0.0.5' })),
    ).toBe('203.0.113.7');
  });

  it('ignores addresses the client prepended', () => {
    expect(
      resolver.resolve(headers({ 'x-forwarded-for': '1.1.1.1, 8.8.8.8, 203.0.113.7, 10.0.0.5' })),
    ).toBe('203.0.113.7');
    expect(resolver.resolve(headers({ 'x-forwarded-for': 'garbage, 203.0.113.7' }))).toBe(
      '203.0.113.7',
    );
  });

  it('never reads other forwarding headers', () => {
    expect(
      resolver.resolve(
        headers({
          'x-real-ip': '1.1.1.1',
          'cf-connecting-ip': '1.1.1.1',
          forwarded: 'for=1.1.1.1',
        }),
      ),
    ).toBeNull();
  });

  it('falls back to the leftmost entry when every hop is trusted', () => {
    expect(resolver.resolve(headers({ 'x-forwarded-for': '10.9.9.9, 10.0.0.5' }))).toBe('10.9.9.9');
  });

  it('returns null for a malformed hop written by the proxy chain', () => {
    expect(resolver.resolve(headers({ 'x-forwarded-for': '203.0.113.7, not-an-ip' }))).toBeNull();
  });
});

describe('x-forwarded-for without trusted proxies', () => {
  const resolver = createClientIpResolver({
    CLIENT_IP_HEADER: 'x-forwarded-for',
    TRUSTED_PROXY_CIDRS: [],
  });

  it('uses the entry written by the edge proxy (rightmost)', () => {
    expect(resolver.resolve(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }))).toBe(
      '203.0.113.7',
    );
  });
});

describe('single-value headers', () => {
  it('reads only the configured header', () => {
    const resolver = createClientIpResolver({
      CLIENT_IP_HEADER: 'cf-connecting-ip',
      TRUSTED_PROXY_CIDRS: [],
    });
    expect(
      resolver.resolve(
        headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }),
      ),
    ).toBe('203.0.113.7');
    expect(resolver.resolve(headers({ 'x-forwarded-for': '1.1.1.1' }))).toBeNull();
    expect(resolver.resolve(headers({ 'cf-connecting-ip': '1.1.1.1, 2.2.2.2' }))).toBeNull();
  });
});

describe('rateLimitSubject', () => {
  it('groups IPv6 clients by /64 and keeps IPv4 addresses', () => {
    expect(rateLimitSubject('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitSubject('2001:db8:1:2:aaaa::1')).toBe('2001:0db8:0001:0002::/64');
    expect(rateLimitSubject('2001:db8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:0db8:0001:0002::/64');
    expect(rateLimitSubject('::1')).toBe('0000:0000:0000:0000::/64');
    expect(rateLimitSubject(null)).toBe('unknown');
  });
});
