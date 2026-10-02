import { describe, expect, it } from 'vitest';

import {
  buildApiRequest,
  interpretResponse,
  PAGE_ENDPOINTS,
  parseRetryAfter,
  sendApiRequest,
} from '../../lib/client/api';
import {
  canSubmit,
  failureFor,
  type FlowState,
  flowReducer,
  IDLE,
  PENDING,
} from '../../lib/client/flow';
import {
  announcement,
  failureMessage,
  formatWait,
  PAGE_COPY,
  rateLimitMessage,
} from '../../lib/client/messages';
import { freshToken } from './support';

function headerMap(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers).entries());
}

function problem(status: number, code: string) {
  return interpretResponse(status, new Headers(), { code, status });
}

describe('buildApiRequest (ADR-0014, ADR-0040)', () => {
  it('posts JSON to the fixed same-origin path with x-kadro-client: web', () => {
    const token = freshToken();
    const request = buildApiRequest('verifyEmail', { token });
    expect(request.url).toBe('/api/v1/auth/verify-email');
    expect(request.init.method).toBe('POST');
    expect(request.init.body).toBe(JSON.stringify({ token }));
    expect(request.init.credentials).toBe('same-origin');
    expect(request.init.mode).toBe('same-origin');
    expect(request.init.cache).toBe('no-store');
    expect(request.init.redirect).toBe('error');
    expect(request.init.referrerPolicy).toBe('no-referrer');
    expect(headerMap(request.init)).toEqual({
      accept: 'application/json',
      'content-type': 'application/json',
      'x-kadro-client': 'web',
    });
  });

  it('uses relative /api/v1 paths only', () => {
    for (const path of Object.values(PAGE_ENDPOINTS)) {
      expect(path).toMatch(/^\/api\/v1\/[a-z/-]+$/);
    }
    expect(buildApiRequest('reset', { token: 'x', password: 'y' }).url).toBe('/api/v1/auth/reset');
    expect(buildApiRequest('forgot', { email: 'a@b.co' }).url).toBe('/api/v1/auth/forgot');
    expect(buildApiRequest('login', { email: 'a@b.co', password: 'p' }).url).toBe(
      '/api/v1/auth/login',
    );
  });

  it('sends the CSRF header only on the signed-in mutation, and requires it there', () => {
    const csrf = freshToken();
    for (const endpoint of ['verifyEmail', 'reset', 'forgot', 'login'] as const) {
      const headers = headerMap(buildApiRequest(endpoint, {}, csrf).init);
      expect(headers['x-csrf-token'], endpoint).toBeUndefined();
    }
    const deletion = buildApiRequest('deleteAccount', { password: 'p' }, csrf);
    expect(deletion.init.method).toBe('DELETE');
    expect(deletion.url).toBe('/api/v1/me');
    expect(headerMap(deletion.init)['x-csrf-token']).toBe(csrf);
    expect(() => buildApiRequest('deleteAccount', { password: 'p' })).toThrow(TypeError);
    expect(() => buildApiRequest('deleteAccount', { password: 'p' }, '')).toThrow(TypeError);
  });
});

describe('response interpretation', () => {
  it('parses Retry-After as seconds or HTTP date', () => {
    const now = Date.parse('2026-10-01T10:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
    expect(parseRetryAfter('Thu, 01 Oct 2026 10:02:00 GMT', now)).toBe(120);
    expect(parseRetryAfter('Thu, 01 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter('-5', now)).toBeNull();
  });

  it('turns 429 into rate_limited with the wait time', () => {
    expect(interpretResponse(429, new Headers({ 'retry-after': '42' }), null)).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 42,
    });
    expect(interpretResponse(429, new Headers(), null)).toEqual({
      kind: 'rate_limited',
      retryAfterSeconds: null,
    });
  });

  it('keeps only known problem codes', () => {
    expect(problem(401, 'token_invalid')).toEqual({
      kind: 'problem',
      status: 401,
      code: 'token_invalid',
    });
    expect(problem(400, 'made_up')).toEqual({ kind: 'problem', status: 400, code: null });
    expect(interpretResponse(500, new Headers(), 'oops')).toEqual({
      kind: 'problem',
      status: 500,
      code: null,
    });
  });

  it('reports a network failure without throwing', async () => {
    const outcome = await sendApiRequest(
      () => Promise.reject(new TypeError('Failed to fetch')),
      buildApiRequest('forgot', { email: 'a@b.co' }),
    );
    expect(outcome).toEqual({ kind: 'network' });
  });

  it('reads problem+json bodies and ignores non-JSON bodies', async () => {
    const json = await sendApiRequest(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ code: 'invalid_credentials' }), {
            status: 401,
            headers: { 'content-type': 'application/problem+json' },
          }),
        ),
      buildApiRequest('login', { email: 'a@b.co', password: 'p' }),
    );
    expect(json).toEqual({ kind: 'problem', status: 401, code: 'invalid_credentials' });
    const html = await sendApiRequest(
      () =>
        Promise.resolve(
          new Response('<html>', { status: 502, headers: { 'content-type': 'text/html' } }),
        ),
      buildApiRequest('login', { email: 'a@b.co', password: 'p' }),
    );
    expect(html).toEqual({ kind: 'problem', status: 502, code: null });
  });
});

describe('failureFor', () => {
  it('maps token pages to one invalid-link state (T-WEB-03)', () => {
    expect(failureFor('verifyEmail', problem(401, 'token_invalid'))).toBe('link_invalid');
    expect(failureFor('verifyEmail', problem(400, 'validation_failed'))).toBe('link_invalid');
    expect(failureFor('reset', problem(401, 'token_invalid'))).toBe('link_invalid');
    expect(failureFor('reset', problem(422, 'password_breached'))).toBe('password_breached');
    expect(failureFor('reset', problem(400, 'validation_failed'))).toBe('validation');
  });

  it('maps login, forgot and deletion failures', () => {
    expect(failureFor('login', problem(401, 'invalid_credentials'))).toBe('invalid_credentials');
    expect(failureFor('login', problem(401, 'account_deactivated'))).toBe('account_deactivated');
    expect(failureFor('forgot', problem(400, 'validation_failed'))).toBe('validation');
    expect(failureFor('deleteAccount', problem(401, 'unauthenticated'))).toBe('signed_out');
    expect(failureFor('deleteAccount', problem(403, 'csrf_failed'))).toBe('signed_out');
    expect(failureFor('deleteAccount', problem(401, 'reauth_required'))).toBe('reauth_failed');
    expect(failureFor('deleteAccount', problem(401, 'step_up_required'))).toBe('step_up_required');
    expect(failureFor('deleteAccount', problem(409, 'deletion_pending'))).toBe('deletion_pending');
    expect(failureFor('deleteAccount', problem(409, 'last_admin'))).toBe('last_admin');
  });

  it('never turns a forgot answer into an account-specific message (ADR-0015)', () => {
    for (const status of [400, 401, 403, 404, 409, 410, 422, 500, 503]) {
      for (const code of ['not_found', 'invalid_credentials', 'account_deactivated', 'conflict']) {
        expect(['validation', 'unavailable'], `${status} ${code}`).toContain(
          failureFor('forgot', problem(status, code)),
        );
      }
    }
  });

  it('maps 5xx, 404, 405, 429 and network the same on every page', () => {
    for (const endpoint of ['verifyEmail', 'reset', 'forgot', 'login', 'deleteAccount'] as const) {
      expect(failureFor(endpoint, problem(503, 'service_unavailable'))).toBe('unavailable');
      expect(failureFor(endpoint, problem(404, 'not_found'))).toBe('unavailable');
      expect(failureFor(endpoint, problem(405, 'method_not_allowed'))).toBe('unavailable');
      expect(failureFor(endpoint, { kind: 'rate_limited', retryAfterSeconds: 5 })).toBe(
        'rate_limited',
      );
      expect(failureFor(endpoint, { kind: 'network' })).toBe('network');
      expect(failureFor(endpoint, { kind: 'ok', status: 204, body: null })).toBeNull();
    }
  });
});

describe('flowReducer', () => {
  const ok = { kind: 'ok', status: 204, body: null } as const;

  it('runs idle → pending → success, and success is terminal', () => {
    let state: FlowState = IDLE;
    state = flowReducer(state, { type: 'submit' });
    expect(state).toBe(PENDING);
    state = flowReducer(state, { type: 'settled', endpoint: 'reset', outcome: ok });
    expect(state.status).toBe('success');
    expect(flowReducer(state, { type: 'submit' })).toBe(state);
    expect(flowReducer(state, { type: 'link_rejected' })).toBe(state);
    expect(canSubmit(state)).toBe(false);
  });

  it('ignores a second submit while a request is in flight (no double post)', () => {
    expect(canSubmit(PENDING)).toBe(false);
    expect(flowReducer(PENDING, { type: 'submit' })).toBe(PENDING);
  });

  it('ignores results that arrive when nothing is pending', () => {
    expect(flowReducer(IDLE, { type: 'settled', endpoint: 'login', outcome: ok })).toBe(IDLE);
  });

  it('keeps the retry time of a 429 and allows a retry', () => {
    const state = flowReducer(PENDING, {
      type: 'settled',
      endpoint: 'login',
      outcome: { kind: 'rate_limited', retryAfterSeconds: 90 },
    });
    expect(state).toEqual({ status: 'failure', failure: 'rate_limited', retryAfterSeconds: 90 });
    expect(canSubmit(state)).toBe(true);
    expect(announcement(state, PAGE_COPY.login)).toBe(
      'Çok fazla deneme yapıldı. 2 dakika sonra tekrar dene.',
    );
  });

  it('treats an invalid link as terminal', () => {
    const state = flowReducer(PENDING, {
      type: 'settled',
      endpoint: 'reset',
      outcome: { kind: 'problem', status: 401, code: 'token_invalid' },
    });
    expect(state).toEqual({ status: 'failure', failure: 'link_invalid', retryAfterSeconds: null });
    expect(canSubmit(state)).toBe(false);
    expect(flowReducer(IDLE, { type: 'link_rejected' })).toEqual(state);
  });

  it('allows a retry after a network failure', () => {
    const state = flowReducer(PENDING, {
      type: 'settled',
      endpoint: 'verifyEmail',
      outcome: { kind: 'network' },
    });
    expect(canSubmit(state)).toBe(true);
    expect(flowReducer(state, { type: 'submit' })).toBe(PENDING);
  });
});

describe('messages', () => {
  it('announces nothing while idle and the page copy otherwise', () => {
    expect(announcement(IDLE, PAGE_COPY.reset)).toBe('');
    expect(announcement(PENDING, PAGE_COPY.reset)).toBe(PAGE_COPY.reset.pending);
    expect(announcement({ status: 'success', body: null }, PAGE_COPY.reset)).toContain(
      'tüm oturumlardan çıkış yapıldı',
    );
  });

  it('gives forgot one confirmation for every address (ADR-0015)', () => {
    const run = (body: unknown) =>
      announcement(
        flowReducer(PENDING, {
          type: 'settled',
          endpoint: 'forgot',
          outcome: { kind: 'ok', status: 202, body },
        }),
        PAGE_COPY.forgot,
      );
    expect(run({ status: 'accepted' })).toBe(run(null));
    expect(run({ status: 'accepted' })).toBe(PAGE_COPY.forgot.success);
    expect(PAGE_COPY.forgot.success).toMatch(/aitse/);
  });

  it('formats waits in Turkish, rounded up', () => {
    expect(formatWait(0)).toBe('1 saniye');
    expect(formatWait(59)).toBe('59 saniye');
    expect(formatWait(60)).toBe('1 dakika');
    expect(formatWait(61)).toBe('2 dakika');
    expect(formatWait(3600)).toBe('1 saat');
    expect(rateLimitMessage(null)).toBe('Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.');
  });

  it('never echoes server text: every failure has fixed copy', () => {
    const failures = [
      'link_invalid',
      'invalid_credentials',
      'account_deactivated',
      'password_breached',
      'validation',
      'signed_out',
      'reauth_failed',
      'step_up_required',
      'deletion_pending',
      'last_admin',
      'network',
      'unavailable',
    ] as const;
    for (const failure of failures) {
      expect(failureMessage(failure, null).length, failure).toBeGreaterThan(10);
    }
    expect(failureMessage('link_invalid', null)).toBe(
      'Bu bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı iste.',
    );
  });
});
