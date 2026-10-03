import { describe, expect, it } from 'vitest';

import { maskEmail, REDACTED, scrubEvent, scrubText } from './scrub.js';

// Secret-shaped values are assembled at run time so the repository holds no credential literals.
function fakeKey(length: number): string {
  const alphabet = 'k7Qm2xW9pL4z';
  return Array.from({ length }, (_, index) => alphabet.charAt((index * 5) % alphabet.length)).join(
    '',
  );
}
function fakeJwt(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url');
  return [header, payload, fakeKey(24)].join('.');
}
const SESSION = fakeKey(40);
const JWT = fakeJwt();
const PASSWORD = ['pass', 'word', String(Date.now())].join('-');
const EMAIL = ['ayberk', 'example.com'].join('@');

function serialise(value: unknown): string {
  return JSON.stringify(value);
}

describe('scrubEvent', () => {
  it('removes cookies, the request body and credential headers from the request', () => {
    const event = {
      request: {
        url: 'https://kadro.app/api/v1/teams',
        method: 'POST',
        cookies: { kadro_session: SESSION },
        data: { password: PASSWORD, name: 'Team' },
        headers: {
          Authorization: `Bearer ${SESSION}`,
          Cookie: `kadro_session=${SESSION}`,
          'Set-Cookie': `kadro_session=${SESSION}; HttpOnly`,
          'X-CSRF-Token': SESSION,
          'Accept-Language': 'tr-TR',
        },
      },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request).not.toHaveProperty('cookies');
    expect(scrubbed.request).not.toHaveProperty('data');
    expect(scrubbed.request.headers).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      'Set-Cookie': REDACTED,
      'X-CSRF-Token': REDACTED,
      'Accept-Language': 'tr-TR',
    });
    expect(serialise(scrubbed)).not.toContain(SESSION);
    expect(serialise(scrubbed)).not.toContain(PASSWORD);
  });

  it('redacts credential headers given as name and value pairs', () => {
    const scrubbed = scrubEvent({
      request: {
        headers: [
          ['authorization', `Bearer ${SESSION}`],
          ['accept', 'application/json'],
          ['set-cookie', `a=${SESSION}`],
        ],
      },
    });
    expect(scrubbed.request.headers).toEqual([
      ['authorization', REDACTED],
      ['accept', 'application/json'],
      ['set-cookie', REDACTED],
    ]);
  });

  it('redacts token query parameters in the url and in every query string form', () => {
    const asString = scrubEvent({
      request: {
        url: `https://kadro.app/invite?code=${SESSION}&lang=tr`,
        query_string: `token=${SESSION}&page=2`,
      },
    });
    expect(asString.request.url).toBe(`https://kadro.app/invite?code=${REDACTED}&lang=tr`);
    expect(asString.request.query_string).toBe(`token=${REDACTED}&page=2`);

    const asObject = scrubEvent({
      request: { query_string: { access_token: SESSION, page: '2' } },
    });
    expect(asObject.request.query_string).toEqual({ access_token: REDACTED, page: '2' });

    const asPairs = scrubEvent({
      request: {
        query_string: [
          ['refresh_token', SESSION],
          ['page', '2'],
        ],
      },
    });
    expect(asPairs.request.query_string).toEqual([
      ['refresh_token', REDACTED],
      ['page', '2'],
    ]);
  });

  it('drops the IP address and masks the email of the user', () => {
    const scrubbed = scrubEvent({
      user: { id: 'u-1', email: EMAIL, ip_address: '203.0.113.7', username: 'ayberk' },
    });
    expect(scrubbed.user).toEqual({ id: 'u-1', email: 'a***@e***', username: 'ayberk' });
  });

  it('masks emails and redacts tokens in the message and log entry', () => {
    const scrubbed = scrubEvent({
      message: `sign-in failed for ${EMAIL} with ${JWT}`,
      logentry: { message: 'refresh %s', params: [SESSION] },
    });
    expect(scrubbed.message).toBe(`sign-in failed for a***@e*** with ${REDACTED}`);
    expect(scrubbed.logentry).toEqual({ message: 'refresh %s', params: [REDACTED] });
  });

  it('scrubs nested objects and arrays inside extra', () => {
    const scrubbed = scrubEvent({
      extra: {
        attempt: 2,
        payload: {
          profile: { contact: { email: EMAIL, phone: null } },
          sessions: [{ refreshToken: SESSION }, { note: `key ${SESSION}` }],
        },
        lists: [[EMAIL, 'plain'], [{ password: PASSWORD }]],
      },
    });
    expect(scrubbed.extra).toEqual({
      attempt: 2,
      payload: {
        profile: { contact: { email: 'a***@e***', phone: null } },
        sessions: [{ refreshToken: REDACTED }, { note: `key ${REDACTED}` }],
      },
      lists: [['a***@e***', 'plain'], [{ password: REDACTED }]],
    });
  });

  it('scrubs breadcrumbs in both array and values form', () => {
    const crumb = {
      category: 'fetch',
      message: `POST https://kadro.app/api/v1/auth/login?email=${EMAIL}`,
      data: {
        url: `https://kadro.app/api/v1/auth/refresh?token=${SESSION}`,
        status_code: 401,
        request_headers: { authorization: `Bearer ${SESSION}` },
        body: { password: PASSWORD },
      },
    };
    for (const breadcrumbs of [[crumb], { values: [crumb] }]) {
      const text = serialise(scrubEvent({ breadcrumbs }));
      expect(text).not.toContain(SESSION);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(EMAIL);
      expect(text).toContain('"status_code":401');
      expect(text).toContain(`token=${REDACTED}`);
    }
  });

  it('redacts credential keys anywhere, case and separator insensitive', () => {
    const scrubbed = scrubEvent({
      contexts: { app: { API_KEY: SESSION, Client_Secret: SESSION, version: '1.0.0' } },
      tags: { 'x-api-key': SESSION, screen: 'teams' },
    });
    expect(scrubbed.contexts.app).toEqual({
      API_KEY: REDACTED,
      Client_Secret: REDACTED,
      version: '1.0.0',
    });
    expect(scrubbed.tags).toEqual({ 'x-api-key': REDACTED, screen: 'teams' });
  });

  it('keeps identifiers outside free text and keeps short or non-token words', () => {
    const eventId = 'c0ffee00c0ffee00c0ffee00c0ffee00';
    const traceId = 'abcdef0123456789abcdef0123456789';
    const scrubbed = scrubEvent({
      event_id: eventId,
      contexts: { trace: { trace_id: traceId, op: 'navigation' } },
      exception: {
        values: [
          { type: 'TypeError', value: 'Cannot read properties_of_undefined_while_rendering' },
        ],
      },
      release: 'kadro@1.4.0+42',
    });
    expect(scrubbed.event_id).toBe(eventId);
    expect(scrubbed.contexts.trace.trace_id).toBe(traceId);
    expect(scrubbed.exception.values[0]?.value).toBe(
      'Cannot read properties_of_undefined_while_rendering',
    );
    expect(scrubbed.release).toBe('kadro@1.4.0+42');
  });

  it('redacts token-like values in exception messages', () => {
    const scrubbed = scrubEvent({
      exception: { values: [{ type: 'Error', value: `invalid session ${SESSION}` }] },
    });
    expect(scrubbed.exception.values[0]?.value).toBe(`invalid session ${REDACTED}`);
  });

  it('does not mutate the input and survives cycles and deep nesting', () => {
    const extra: Record<string, unknown> = { password: PASSWORD };
    extra.self = extra;
    let deep: Record<string, unknown> = { token: SESSION };
    for (let level = 0; level < 30; level += 1) {
      deep = { next: deep };
    }
    const event = { extra, contexts: { deep } };
    const scrubbed = scrubEvent(event);
    expect(extra.password).toBe(PASSWORD);
    expect(scrubbed.extra).toEqual({ password: REDACTED, self: '[Truncated]' });
    expect(serialise(scrubbed)).not.toContain(SESSION);
  });

  it('returns non-object input unchanged', () => {
    expect(scrubEvent(null)).toBeNull();
    expect(scrubEvent('text')).toBe('text');
  });
});

describe('scrubText and maskEmail', () => {
  it('redacts bearer values, JWTs and long key-shaped runs, and masks emails', () => {
    expect(scrubText(`Authorization: Bearer ${SESSION}`)).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(scrubText(`jwt=${JWT}`)).toBe(`jwt=${REDACTED}`);
    expect(scrubText(`mail ${EMAIL} now`)).toBe('mail a***@e*** now');
    expect(scrubText('a short word list stays')).toBe('a short word list stays');
    expect(scrubText('Basic plan users')).toBe('Basic plan users');
  });

  it('masks malformed addresses fully', () => {
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail('ayberk@')).toBe('***');
  });
});
