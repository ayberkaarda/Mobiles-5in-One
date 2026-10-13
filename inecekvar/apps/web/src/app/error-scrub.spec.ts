import { beforeSendFor, scrubEvent, scrubText } from './error-scrub';

// Built from parts so no literal reads as a credential.
const JWT = ['eyJhbGciOiJFUzI1NiJ9', 'eyJzdWIiOiIxMjM0NSJ9', 'c2lnbmF0dXJlLXBhcnQ'].join('.');
const OPAQUE = ['opak', 'erisim', 'anahtari', '0123456789'].join('-');

function fakeEvent(): Record<string, unknown> {
  return {
    event_id: '0f1e2d3c',
    server_name: 'ssr-host-1',
    message: 'login failed for a.person@example.com',
    user: { id: 'u-1', email: 'a.person@example.com', ip_address: '203.0.113.9' },
    request: {
      url: 'https://inecekvar.app/hat/ornek-hat-1?token=' + OPAQUE,
      method: 'POST',
      query_string: 'token=' + OPAQUE,
      data: { password: 'x' },
      cookies: { session: OPAQUE },
      headers: { Authorization: 'Bearer ' + OPAQUE, 'User-Agent': 'test' },
    },
    exception: {
      values: [{ type: 'Error', value: 'bad point 41.0123456, 29.0987654 from ' + JWT }],
    },
    breadcrumbs: [
      { category: 'fetch', message: 'GET https://api.inecekvar.app/v1/near?lat=41.0123456' },
      { category: 'ui', data: { email: 'a.person@example.com', lat: 41.0123456 } },
    ],
    extra: { trace: { coordinates: [[29.1234567, 41.1234567]] }, pair: [29.1234567, 41.1234567] },
  };
}

describe('scrubEvent', () => {
  it('removes credentials, addresses, bodies and precise coordinates', () => {
    const cleaned = scrubEvent(fakeEvent());
    const text = JSON.stringify(cleaned);

    for (const fragment of [OPAQUE, JWT, 'a.person', '203.0.113.9', '0123456', 'ssr-host-1']) {
      expect(text).not.toContain(fragment);
    }
    expect(cleaned['user']).toEqual({ id: 'u-1' });
    expect(cleaned['request']).toEqual({
      url: 'https://inecekvar.app/hat/ornek-hat-1',
      method: 'POST',
      headers: { 'User-Agent': 'test' },
    });
    expect(cleaned['message']).toBe('login failed for [email]');
    expect(cleaned['extra']).toEqual({ trace: {}, pair: [29.123, 41.123] });
    expect((cleaned['breadcrumbs'] as unknown[])[1]).toEqual({
      category: 'ui',
      data: { lat: 41.012 },
    });
  });

  it('leaves the input untouched', () => {
    const event = fakeEvent();
    const before = JSON.stringify(event);
    scrubEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });

  it('keeps counts and integers', () => {
    expect(scrubEvent({ extra: { points: 120, ids: [1, 2] } })).toEqual({
      extra: { points: 120, ids: [1, 2] },
    });
  });
});

describe('scrubText', () => {
  it.each([
    ['Bearer ' + OPAQUE, 'Bearer [redacted]'],
    ['basic ' + OPAQUE, 'basic [redacted]'],
    ['token ' + JWT, 'token [redacted-jwt]'],
    ['at 41.0123456,29.0987654', 'at 41.012,29.099'],
    ['/v1/near?lat=41.0123456&lng=29.1', '/v1/near'],
    ['mail x.y@example.com', 'mail [email]'],
  ])('scrubs %s', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });
});

describe('beforeSendFor', () => {
  it('is inert without a DSN', () => {
    expect(beforeSendFor(undefined)).toBeUndefined();
    expect(beforeSendFor(null)).toBeUndefined();
    expect(beforeSendFor('  ')).toBeUndefined();
  });

  it('returns the scrubber with a DSN', () => {
    expect(beforeSendFor('https://k@errors.example.invalid/1')).toBe(scrubEvent);
  });
});
