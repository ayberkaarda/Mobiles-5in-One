import { TestBed } from '@angular/core/testing';
import {
  bearerSignIn,
  cookieSignIn,
  deferred,
  json,
  ME,
  noContent,
  problem,
} from '../../testing/fake-fetch';
import { setupDataAccess } from '../../testing/setup';
import { AccountApi } from '../endpoints';
import { SessionStore } from '../session.store';
import { AuthApi } from './auth-api';
import { AUTH_STRATEGY } from './auth-strategy';

describe('pending logout', () => {
  it('keeps cookie logout pending until revocation is confirmed', async () => {
    const h = setupDataAccess(false);
    const reply = deferred<Response>();
    h.fake.on('POST', '/auth/login', json(cookieSignIn()));
    h.fake.on(
      'POST',
      '/auth/logout',
      () => {
        expect(h.marker.isSet()).toBe(true);
        return reply.promise;
      },
      noContent(),
    );
    h.fake.on('POST', '/auth/csrf', json({ csrf_token: 'csrf-revoke' }));
    const session = TestBed.inject(SessionStore);
    await session.login('a@example.test', 'password-A');
    const pending = session.logout();
    const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
    expect(session.status()).toBe('anonymous');
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/logout')).toHaveLength(1));
    await expect(TestBed.inject(AUTH_STRATEGY).restore()).resolves.toBe(false);
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(h.fake.callsTo('GET', '/me')[0]?.credentials).toBe('omit');
    reply.resolve(problem(503, 'internal'));
    await rejected;
    expect(h.marker.isSet()).toBe(true);
    expect(session.logoutPending()).toBe(true);
    await expect(session.retryPendingLogout()).resolves.toBe(true);
    expect(session.logoutPending()).toBe(false);
    expect(h.marker.isSet()).toBe(false);
    expect(h.fake.callsTo('POST', '/auth/csrf')[0]?.credentials).toBe('include');
    expect(h.fake.callsTo('POST', '/auth/logout').at(-1)?.credentials).toBe('include');
    expect(h.fake.callsTo('POST', '/auth/logout').at(-1)?.headers.get('X-CSRF-Token')).toBe(
      'csrf-revoke',
    );
  });

  it('keeps failed bearer logout pending with only the secure refresh token', async () => {
    const h = setupDataAccess(true);
    const reply = deferred<Response>();
    h.fake.on('POST', '/auth/login', json(bearerSignIn()));
    h.fake.on('POST', '/auth/logout', () => reply.promise, noContent());
    const api = TestBed.inject(AuthApi);
    await api.login('a@example.test', 'password-A');
    const pending = api.logout();
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'network' });
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/logout')).toHaveLength(1));
    expect(h.marker.isSet()).toBe(true);
    expect(h.fake.callsTo('POST', '/auth/logout')[0]?.headers.get('Authorization')).toBe(
      'Bearer access-1',
    );
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(h.fake.callsTo('GET', '/me')[0]?.headers.has('Authorization')).toBe(false);
    expect(h.store.value).toBe('refresh-1');
    reply.reject(new TypeError('offline'));
    await rejected;
    await expect(TestBed.inject(AUTH_STRATEGY).restore()).resolves.toBe(false);
    h.fake.on('POST', '/auth/refresh', json(bearerSignIn('access-revoke', 'refresh-rotated')));
    await expect(api.completePendingLogout()).resolves.toBe(true);
    expect(h.fake.callsTo('POST', '/auth/refresh')[0]?.body).toEqual({
      refresh_token: 'refresh-1',
    });
    expect(h.fake.callsTo('POST', '/auth/logout').at(-1)?.headers.get('Authorization')).toBe(
      'Bearer access-revoke',
    );
    expect(h.store.value).toBeNull();
    expect(h.marker.isSet()).toBe(false);
  });

  it('starts anonymous and retries a persisted logout without requesting me', async () => {
    const h = setupDataAccess(false);
    h.marker.set();
    h.fake.on('POST', '/auth/csrf', problem(503, 'internal'), json({ csrf_token: 'csrf-retry' }));
    h.fake.on('POST', '/auth/logout', noContent());
    const session = TestBed.inject(SessionStore);
    await session.init(
      { hash: '', pathname: '/', search: '' },
      { state: null, replaceState: vi.fn() },
    );
    expect(session.status()).toBe('anonymous');
    expect(session.logoutPending()).toBe(true);
    expect(h.marker.isSet()).toBe(true);
    expect(h.fake.callsTo('GET', '/me')).toHaveLength(0);
    await expect(session.retryPendingLogout()).resolves.toBe(true);
    expect(session.logoutPending()).toBe(false);
  });

  it('accepts an already ended cookie session during pending completion', async () => {
    const h = setupDataAccess(false);
    h.marker.set();
    h.fake.on('POST', '/auth/csrf', problem(401, 'auth.required'));
    await expect(TestBed.inject(AuthApi).completePendingLogout()).resolves.toBe(true);
    expect(h.marker.isSet()).toBe(false);
    expect(h.fake.callsTo('POST', '/auth/logout')).toHaveLength(0);
  });

  it('keeps logout everywhere pending when the server cannot confirm it', async () => {
    const h = setupDataAccess(false);
    const reply = deferred<Response>();
    h.fake.on('POST', '/auth/login', json(cookieSignIn()));
    h.fake.on('POST', '/auth/logout-all', () => reply.promise);
    const session = TestBed.inject(SessionStore);
    await session.login('a@example.test', 'password-A');
    const pending = session.logoutEverywhere();
    const rejected = expect(pending).rejects.toMatchObject({ status: 429 });
    expect(session.status()).toBe('anonymous');
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/logout-all')).toHaveLength(1));
    reply.resolve(problem(429, 'rate_limited'));
    await rejected;
    expect(session.logoutPending()).toBe(true);
    expect(h.marker.isSet()).toBe(true);
    expect(h.fake.callsTo('POST', '/auth/logout-all')).toHaveLength(1);
  });

  it('clears pending logout on a replacement cookie sign-in after a failed retry', async () => {
    const h = setupDataAccess(false);
    h.marker.set();
    h.fake.on('POST', '/auth/csrf', problem(503, 'internal'));
    h.fake.on('POST', '/auth/login', json(cookieSignIn('csrf-B')));
    const session = TestBed.inject(SessionStore);
    await session.login('b@example.test', 'password-B');
    expect(h.fake.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/v1/auth/csrf',
      '/v1/auth/login',
    ]);
    expect(h.fake.callsTo('POST', '/auth/login')[0]?.credentials).toBe('include');
    expect(h.marker.isSet()).toBe(false);
    expect(session.logoutPending()).toBe(false);
    expect(session.status()).toBe('signed-in');
  });
});
