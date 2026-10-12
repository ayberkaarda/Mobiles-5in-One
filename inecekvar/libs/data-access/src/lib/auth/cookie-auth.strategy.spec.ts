import { TestBed } from '@angular/core/testing';
import { cookieSignIn, deferred, json, ME, noContent, problem } from '../../testing/fake-fetch';
import { type Harness, setupDataAccess } from '../../testing/setup';
import { ApiError } from '../api-error';
import { AccountApi, CatalogApi } from '../endpoints';
import { AuthApi } from './auth-api';
import { AUTH_STRATEGY } from './auth-strategy';
import { CookieAuthStrategy } from './cookie-auth.strategy';

describe('CookieAuthStrategy (web and PWA)', () => {
  let h: Harness;

  beforeEach(() => {
    h = setupDataAccess(false);
  });

  async function signIn(csrf = 'csrf-from-login'): Promise<void> {
    h.fake.on('POST', '/auth/login', json(cookieSignIn(csrf)));
    await TestBed.inject(AuthApi).login('deniz@example.test', 'correct horse battery');
  }

  it('is chosen outside the native shell and sends credentials with every request', async () => {
    expect(TestBed.inject(AUTH_STRATEGY)).toBeInstanceOf(CookieAuthStrategy);
    await signIn();
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    for (const call of h.fake.calls) {
      expect(call.credentials).toBe('include');
      expect(call.headers.has('Authorization')).toBe(false);
    }
    expect(h.fake.callsTo('POST', '/auth/login')[0]?.body).toMatchObject({ mode: 'cookie' });
  });

  it('echoes the CSRF token from sign-in on mutations only', async () => {
    await signIn('csrf-A');
    expect(h.fake.callsTo('POST', '/auth/login')[0]?.headers.has('X-CSRF-Token')).toBe(false);
    h.fake.on('PUT', '/me/favorites/l1', noContent()).on('GET', '/me/favorites', json([]));
    const account = TestBed.inject(AccountApi);
    await account.addFavorite('l1');
    await account.favorites();
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')[0]?.headers.get('X-CSRF-Token')).toBe(
      'csrf-A',
    );
    expect(h.fake.callsTo('GET', '/me/favorites')[0]?.headers.has('X-CSRF-Token')).toBe(false);
  });

  it('fetches the CSRF token once after a reload before the first mutations', async () => {
    await TestBed.inject(AUTH_STRATEGY).restore();
    h.fake.on('POST', '/auth/csrf', json({ csrf_token: 'csrf-B' }));
    h.fake.on('PUT', '/me/favorites/l1', noContent()).on('PUT', '/me/favorites/l2', noContent());
    const account = TestBed.inject(AccountApi);
    await Promise.all([account.addFavorite('l1'), account.addFavorite('l2')]);
    const csrfCalls = h.fake.callsTo('POST', '/auth/csrf');
    expect(csrfCalls).toHaveLength(1);
    expect(csrfCalls[0]?.credentials).toBe('include');
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')[0]?.headers.get('X-CSRF-Token')).toBe(
      'csrf-B',
    );
    expect(h.fake.callsTo('PUT', '/me/favorites/l2')[0]?.headers.get('X-CSRF-Token')).toBe(
      'csrf-B',
    );
  });

  it('gets a new CSRF token once and retries once after 403 csrf.invalid', async () => {
    await signIn('csrf-stale');
    h.fake.on('POST', '/auth/csrf', json({ csrf_token: 'csrf-fresh' }));
    h.fake.on('PUT', '/me/favorites/l1', problem(403, 'csrf.invalid'), noContent());
    await TestBed.inject(AccountApi).addFavorite('l1');
    const puts = h.fake.callsTo('PUT', '/me/favorites/l1');
    expect(puts.map((c) => c.headers.get('X-CSRF-Token'))).toEqual(['csrf-stale', 'csrf-fresh']);
    expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(1);
  });

  it('gives up after the retry also answers csrf.invalid', async () => {
    await signIn();
    h.fake.on('POST', '/auth/csrf', json({ csrf_token: 'csrf-fresh' }));
    h.fake.on('PUT', '/me/favorites/l1', problem(403, 'csrf.invalid'));
    await expect(TestBed.inject(AccountApi).addFavorite('l1')).rejects.toMatchObject({
      code: 'csrf.invalid',
    });
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')).toHaveLength(2);
    expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(1);
  });

  it('ends the session when no CSRF token can be had because the cookie expired', async () => {
    await TestBed.inject(AUTH_STRATEGY).restore();
    const ended = vi.fn();
    TestBed.inject(AUTH_STRATEGY).onSessionEnded(ended);
    h.fake.on('POST', '/auth/csrf', problem(401, 'auth.required'));
    h.fake.on('PUT', '/me/favorites/l1', problem(401, 'auth.required'));
    await expect(TestBed.inject(AccountApi).addFavorite('l1')).rejects.toBeInstanceOf(ApiError);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')[0]?.headers.has('X-CSRF-Token')).toBe(false);
  });

  it('surfaces a CSRF endpoint failure that is not a 401', async () => {
    await TestBed.inject(AUTH_STRATEGY).restore();
    h.fake.on('POST', '/auth/csrf', problem(503, 'internal'));
    await expect(TestBed.inject(AccountApi).addFavorite('l1')).rejects.toMatchObject({
      status: 503,
    });
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')).toHaveLength(0);
  });

  it('treats 401 on a cookie request as the end of the session, without retrying', async () => {
    await TestBed.inject(AUTH_STRATEGY).restore();
    const ended = vi.fn();
    TestBed.inject(AUTH_STRATEGY).onSessionEnded(ended);
    h.fake.on('GET', '/me', problem(401, 'auth.required'));
    await expect(TestBed.inject(AccountApi).me()).rejects.toMatchObject({ status: 401 });
    expect(h.fake.callsTo('GET', '/me')).toHaveLength(1);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('asks for no CSRF token while anonymous', async () => {
    h.fake.on('POST', '/plan', json({ city: 'ornek', degraded: false, itineraries: [] }));
    await TestBed.inject(CatalogApi).plan({
      city: 'ornek',
      from: { lat: 1, lng: 1 },
      to: { lat: 2, lng: 2 },
      max_transfers: 0,
    });
    expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(0);
    expect(h.fake.calls[0]?.headers.has('X-CSRF-Token')).toBe(false);
  });

  it('never accepts a bearer sign-in body', async () => {
    h.fake.on(
      'POST',
      '/auth/login',
      json({ ...cookieSignIn(), auth_mode: 'bearer', access_token: 'a', refresh_token: 'r' }),
    );
    await expect(
      TestBed.inject(AuthApi).login('deniz@example.test', 'pw-1234567890'),
    ).rejects.toThrow('cookie strategy received a bearer sign-in');
  });

  it('logs out with the CSRF header and forgets the token', async () => {
    await signIn('csrf-L');
    h.fake.on('POST', '/auth/logout', noContent());
    await TestBed.inject(AuthApi).logout();
    expect(h.fake.callsTo('POST', '/auth/logout')[0]?.headers.get('X-CSRF-Token')).toBe('csrf-L');
    h.fake.on('POST', '/plan', json({}));
    await TestBed.inject(CatalogApi).plan({
      city: 'ornek',
      from: { lat: 1, lng: 1 },
      to: { lat: 2, lng: 2 },
      max_transfers: 0,
    });
    expect(h.fake.callsTo('POST', '/plan')[0]?.headers.has('X-CSRF-Token')).toBe(false);
    expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(0);
  });

  it('drops the session after logout-everywhere even when the call fails', async () => {
    await signIn();
    h.fake.on('POST', '/auth/logout-all', () => Promise.reject(new TypeError('offline')));
    await expect(TestBed.inject(AuthApi).logoutEverywhere()).rejects.toMatchObject({
      kind: 'network',
    });
    h.fake.on('PUT', '/me/favorites/l1', problem(401, 'auth.required'));
    await expect(TestBed.inject(AccountApi).addFavorite('l1')).rejects.toBeInstanceOf(ApiError);
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')[0]?.headers.has('X-CSRF-Token')).toBe(false);
  });

  it('keeps the new session CSRF token after an old CSRF reply', async () => {
    await signIn('csrf-A');
    const reply = deferred<Response>();
    h.fake.on('POST', '/auth/csrf', () => reply.promise);
    const strategy = TestBed.inject(CookieAuthStrategy);
    const attempt = await strategy.authorize('GET', new Headers());
    const pending = strategy.recover(
      new ApiError('problem', 403, 'csrf.invalid', 'request-A'),
      attempt,
    );
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(1));
    await strategy.establish(cookieSignIn('csrf-B'));
    reply.resolve(json({ csrf_token: 'csrf-late-A' }));
    await expect(pending).resolves.toBe(false);
    h.fake.on('PUT', '/me/favorites/l1', noContent());
    await TestBed.inject(AccountApi).addFavorite('l1');
    expect(h.fake.callsTo('PUT', '/me/favorites/l1')[0]?.headers.get('X-CSRF-Token')).toBe(
      'csrf-B',
    );
  });

  it('ignores an old CSRF 401 after a new sign-in', async () => {
    await signIn();
    const reply = deferred<Response>();
    h.fake.on('POST', '/auth/csrf', () => reply.promise);
    const strategy = TestBed.inject(CookieAuthStrategy);
    const ended = vi.fn();
    strategy.onSessionEnded(ended);
    const attempt = await strategy.authorize('GET', new Headers());
    const pending = strategy.recover(
      new ApiError('problem', 403, 'csrf.invalid', 'request-A'),
      attempt,
    );
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(1));
    await strategy.establish(cookieSignIn('csrf-B'));
    reply.resolve(problem(401, 'auth.required'));
    await expect(pending).resolves.toBe(false);
    expect(ended).not.toHaveBeenCalled();
    expect((await strategy.authorize('GET', new Headers())).authenticated).toBe(true);
  });

  it('ignores an old request 401 after a new cookie sign-in', async () => {
    await signIn();
    const reply = deferred<Response>();
    h.fake.on('GET', '/me', () => reply.promise);
    const strategy = TestBed.inject(CookieAuthStrategy);
    const ended = vi.fn();
    strategy.onSessionEnded(ended);
    const pending = TestBed.inject(AccountApi).me();
    const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(h.fake.callsTo('GET', '/me')).toHaveLength(1));
    await strategy.establish(cookieSignIn('csrf-B'));
    reply.resolve(problem(401, 'auth.required'));
    await rejected;
    expect(ended).not.toHaveBeenCalled();
    expect((await strategy.authorize('GET', new Headers())).authenticated).toBe(true);
    expect(h.fake.callsTo('GET', '/me')).toHaveLength(1);
  });

  it('does not share a CSRF flight across cookie sessions', async () => {
    await signIn();
    const reply = deferred<Response>();
    h.fake.on('POST', '/auth/csrf', () => reply.promise, json({ csrf_token: 'csrf-B-fresh' }));
    const strategy = TestBed.inject(CookieAuthStrategy);
    const error = new ApiError('problem', 403, 'csrf.invalid', 'request-A');
    const first = strategy.recover(error, await strategy.authorize('GET', new Headers()));
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(1));
    await strategy.establish(cookieSignIn('csrf-B'));
    const second = strategy.recover(error, await strategy.authorize('GET', new Headers()));
    const observed = await vi
      .waitFor(() => expect(h.fake.callsTo('POST', '/auth/csrf')).toHaveLength(2), { timeout: 100 })
      .then(
        () => true,
        () => false,
      );
    reply.resolve(json({ csrf_token: 'csrf-late-A' }));
    await Promise.all([first, second]);
    expect(observed).toBe(true);
    const headers = new Headers();
    await strategy.authorize('POST', headers);
    expect(headers.get('X-CSRF-Token')).toBe('csrf-B-fresh');
  });
});
