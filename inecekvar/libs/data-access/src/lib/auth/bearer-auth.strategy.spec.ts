import { TestBed } from '@angular/core/testing';
import {
  bearerSignIn,
  cookieSignIn,
  deferred,
  json,
  ME,
  noContent,
  problem,
  refreshed,
} from '../../testing/fake-fetch';
import { type Harness, setupDataAccess } from '../../testing/setup';
import { AccountApi } from '../endpoints';
import { AuthApi } from './auth-api';
import { AUTH_STRATEGY } from './auth-strategy';
import { BearerAuthStrategy } from './bearer-auth.strategy';

describe('BearerAuthStrategy (native)', () => {
  let h: Harness;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    h = setupDataAccess(true);
  });

  async function signIn(access = 'access-1', refresh = 'refresh-1'): Promise<void> {
    h.fake.on('POST', '/auth/login', json(bearerSignIn(access, refresh)));
    await TestBed.inject(AuthApi).login('deniz@example.test', 'correct horse battery');
  }

  const auth = (method: string, path: string) =>
    h.fake.callsTo(method, path).map((c) => c.headers.get('Authorization'));

  it('is chosen in the native shell; refresh token to secure storage, access token in memory', async () => {
    expect(TestBed.inject(AUTH_STRATEGY)).toBeInstanceOf(BearerAuthStrategy);
    await signIn();
    expect(h.store.value).toBe('refresh-1');
    expect(h.fake.callsTo('POST', '/auth/login')[0]?.body).toMatchObject({ mode: 'bearer' });
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(auth('GET', '/me')).toEqual(['Bearer access-1']);
    for (const call of h.fake.calls) expect(call.credentials).toBe('omit');
  });

  it('on 401 refreshes once, stores the rotated token and retries once', async () => {
    await signIn();
    h.fake.on('POST', '/auth/refresh', json(refreshed('access-2', 'refresh-2')));
    h.fake.on('GET', '/me', problem(401, 'auth.required'), json(ME));
    await expect(TestBed.inject(AccountApi).me()).resolves.toEqual(ME);
    expect(auth('GET', '/me')).toEqual(['Bearer access-1', 'Bearer access-2']);
    expect(h.fake.callsTo('POST', '/auth/refresh')[0]?.body).toEqual({
      refresh_token: 'refresh-1',
    });
    expect(h.store.value).toBe('refresh-2');
  });

  it('does not loop when the retried request is refused again', async () => {
    await signIn();
    h.fake.on('POST', '/auth/refresh', json(refreshed('access-2', 'refresh-2')));
    h.fake.on('GET', '/me', problem(401, 'auth.required'));
    await expect(TestBed.inject(AccountApi).me()).rejects.toMatchObject({ status: 401 });
    expect(h.fake.callsTo('GET', '/me')).toHaveLength(2);
    expect(h.fake.callsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('signs out when the refresh is refused', async () => {
    await signIn();
    const ended = vi.fn();
    TestBed.inject(AUTH_STRATEGY).onSessionEnded(ended);
    h.fake.on('POST', '/auth/refresh', problem(401, 'auth.token_invalid'));
    h.fake.on('GET', '/me', problem(401, 'auth.required'));
    await expect(TestBed.inject(AccountApi).me()).rejects.toMatchObject({ status: 401 });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(h.store.value).toBeNull();
    h.fake.on('GET', '/me/favorites', problem(401, 'auth.required'));
    await expect(TestBed.inject(AccountApi).favorites()).rejects.toMatchObject({ status: 401 });
    expect(auth('GET', '/me/favorites')).toEqual([null]);
    expect(h.fake.callsTo('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('shares one refresh between concurrent 401s', async () => {
    await signIn();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.fake.on('POST', '/auth/refresh', async () => {
      await gate;
      return json(refreshed('access-2', 'refresh-2'));
    });
    h.fake.on('GET', '/me', problem(401, 'auth.required'), json(ME));
    h.fake.on('GET', '/me/favorites', problem(401, 'auth.required'), json([]));
    const account = TestBed.inject(AccountApi);
    const both = Promise.all([account.me(), account.favorites()]);
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/refresh')).toHaveLength(1));
    release();
    await both;
    expect(h.fake.callsTo('POST', '/auth/refresh')).toHaveLength(1);
    expect(auth('GET', '/me').at(-1)).toBe('Bearer access-2');
    expect(auth('GET', '/me/favorites').at(-1)).toBe('Bearer access-2');
  });

  it('keeps the refresh token when the refresh call fails for network reasons', async () => {
    await signIn();
    h.fake.on('POST', '/auth/refresh', () => Promise.reject(new TypeError('offline')));
    h.fake.on('GET', '/me', problem(401, 'auth.required'));
    await expect(TestBed.inject(AccountApi).me()).rejects.toMatchObject({ kind: 'network' });
    expect(h.store.value).toBe('refresh-1');
  });

  it('keeps the refresh token on a rate-limited or failing refresh', async () => {
    await signIn();
    h.fake.on(
      'POST',
      '/auth/refresh',
      problem(429, 'rate_limited', { 'Retry-After': '600' }),
      problem(503, 'internal'),
    );
    h.fake.on('GET', '/me', problem(401, 'auth.required'));
    const account = TestBed.inject(AccountApi);
    await expect(account.me()).rejects.toMatchObject({ status: 429 });
    await expect(account.me()).rejects.toMatchObject({ status: 503 });
    expect(h.store.value).toBe('refresh-1');
  });

  it('refreshes before the first request after a cold start', async () => {
    h.store.value = 'refresh-stored';
    await expect(TestBed.inject(AUTH_STRATEGY).restore()).resolves.toBe(true);
    h.fake.on('POST', '/auth/refresh', json(refreshed('access-9', 'refresh-10')));
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(h.fake.calls.map((c) => c.url.replace('https://api.test/v1', ''))).toEqual([
      '/auth/refresh',
      '/me',
    ]);
    expect(auth('GET', '/me')).toEqual(['Bearer access-9']);
    expect(h.store.value).toBe('refresh-10');
  });

  it('reports no session on a cold start without a stored token', async () => {
    await expect(TestBed.inject(AUTH_STRATEGY).restore()).resolves.toBe(false);
  });

  it('refreshes an access token that expired by the clock', async () => {
    await signIn();
    h.clock.now += 15 * 60 * 1000;
    h.fake.on('POST', '/auth/refresh', json(refreshed('access-2', 'refresh-2')));
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(auth('GET', '/me')).toEqual(['Bearer access-2']);
  });

  it('does not refresh after a wrong password at sign-in', async () => {
    h.fake.on('POST', '/auth/login', problem(401, 'auth.invalid_credentials'));
    await expect(
      TestBed.inject(AuthApi).login('deniz@example.test', 'wrong password 1'),
    ).rejects.toMatchObject({ code: 'auth.invalid_credentials' });
    expect(h.fake.calls).toHaveLength(1);
    expect(h.fake.calls[0]?.headers.has('Authorization')).toBe(false);
  });

  it('logout revokes the family on the server and clears memory and secure storage', async () => {
    await signIn();
    h.fake.on('POST', '/auth/logout', noContent());
    await TestBed.inject(AuthApi).logout();
    expect(auth('POST', '/auth/logout')).toEqual(['Bearer access-1']);
    expect(h.store.value).toBeNull();
    h.fake.on('GET', '/me/favorites', json([]));
    await TestBed.inject(AccountApi).favorites();
    expect(auth('GET', '/me/favorites')).toEqual([null]);
    expect(h.fake.callsTo('POST', '/auth/refresh')).toHaveLength(0);
  });

  it('a refresh that finishes after logout does not bring the session back', async () => {
    await signIn();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.fake.on('POST', '/auth/refresh', async () => {
      await gate;
      return json(refreshed('access-late', 'refresh-late'));
    });
    h.fake.on('GET', '/me', problem(401, 'auth.required'));
    h.fake.on('POST', '/auth/logout', noContent());
    const strategy = TestBed.inject(BearerAuthStrategy);
    const pending = strategy.refresh();
    await strategy.clear();
    release();
    await expect(pending).resolves.toBe(false);
    expect(h.store.value).toBeNull();
    expect(h.store.writes).not.toContain('refresh-late');
  });

  it('never accepts a cookie sign-in body', async () => {
    h.fake.on('POST', '/auth/login', json(cookieSignIn()));
    await expect(
      TestBed.inject(AuthApi).login('deniz@example.test', 'pw-1234567890'),
    ).rejects.toThrow('bearer strategy received a cookie sign-in');
    expect(h.store.value).toBeNull();
  });

  it('serializes clear behind a refresh write already in progress', async () => {
    await signIn();
    const entered = deferred<void>();
    const release = deferred<void>();
    const set = h.store.set.bind(h.store);
    vi.spyOn(h.store, 'set').mockImplementation(async (token: string) => {
      entered.resolve(undefined);
      await release.promise;
      await set(token);
    });
    h.fake.on('POST', '/auth/refresh', json(refreshed('access-late', 'refresh-late')));
    const strategy = TestBed.inject(BearerAuthStrategy);
    const refresh = strategy.refresh();
    await entered.promise;
    const clear = strategy.clear();
    release.resolve(undefined);
    await expect(refresh).resolves.toBe(false);
    await clear;
    expect(h.store.value).toBeNull();
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(auth('GET', '/me')).toEqual([null]);
  });

  it('never retries an old account POST with the new account token', async () => {
    const reply = deferred<Response>();
    h.fake.on(
      'POST',
      '/auth/login',
      json(bearerSignIn()),
      json(bearerSignIn('access-B', 'refresh-B')),
    );
    const api = TestBed.inject(AuthApi);
    await api.login('a@example.test', 'password-A');
    const ended = vi.fn();
    TestBed.inject(AUTH_STRATEGY).onSessionEnded(ended);
    h.fake.on('POST', '/me/licence-accept', () => reply.promise, json(ME));
    const pending = TestBed.inject(AccountApi).acceptLicence();
    const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/me/licence-accept')).toHaveLength(1));
    await api.login('b@example.test', 'password-B');
    reply.resolve(problem(401, 'auth.required'));
    await rejected;
    expect(auth('POST', '/me/licence-accept')).toEqual(['Bearer access-1']);
    expect(h.fake.callsTo('POST', '/auth/refresh')).toHaveLength(0);
    expect(ended).not.toHaveBeenCalled();
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(auth('GET', '/me')).toEqual(['Bearer access-B']);
    expect(h.store.value).toBe('refresh-B');
  });

  it('discards an old account refresh after a new sign-in', async () => {
    const reply = deferred<Response>();
    h.fake.on(
      'POST',
      '/auth/login',
      json(bearerSignIn()),
      json(bearerSignIn('access-B', 'refresh-B')),
    );
    const api = TestBed.inject(AuthApi);
    await api.login('a@example.test', 'password-A');
    h.fake.on('POST', '/auth/refresh', () => reply.promise);
    const pending = TestBed.inject(BearerAuthStrategy).refresh();
    await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/refresh')).toHaveLength(1));
    await api.login('b@example.test', 'password-B');
    reply.resolve(json(refreshed('access-late-A', 'refresh-late-A')));
    await expect(pending).resolves.toBe(false);
    expect(h.store.value).toBe('refresh-B');
    expect(h.store.writes).not.toContain('refresh-late-A');
    h.fake.on('GET', '/me', json(ME));
    await TestBed.inject(AccountApi).me();
    expect(auth('GET', '/me')).toEqual(['Bearer access-B']);
  });

  it('blocks restore after a failed secure clear and retries removal', async () => {
    await signIn();
    const clear = h.store.clear.bind(h.store);
    const entered = deferred<void>();
    const release = deferred<void>();
    const removal = vi
      .spyOn(h.store, 'clear')
      .mockImplementationOnce(async () => {
        entered.resolve(undefined);
        await release.promise;
        throw new Error('Keystore locked');
      })
      .mockImplementation(clear);
    const strategy = TestBed.inject(BearerAuthStrategy);
    const pending = strategy.clear();
    const rejected = expect(pending).rejects.toThrow('Keystore locked');
    await entered.promise;
    release.resolve(undefined);
    await rejected;
    expect(h.marker.isSet()).toBe(true);
    await expect(strategy.restore()).resolves.toBe(false);
    h.fake.on('POST', '/auth/refresh', problem(401, 'auth.token_invalid'));
    await expect(TestBed.inject(AuthApi).completePendingLogout()).resolves.toBe(true);
    expect(removal).toHaveBeenCalledTimes(2);
    expect(h.store.value).toBeNull();
    expect(h.marker.isSet()).toBe(false);
  });

  it('keeps tokens out of web storage, cookies and the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    await signIn('access-secret-1', 'refresh-secret-1');
    h.fake.on('POST', '/auth/refresh', json(refreshed('access-secret-2', 'refresh-secret-2')));
    h.fake.on('GET', '/me', problem(401, 'auth.required'), json(ME));
    await TestBed.inject(AccountApi).me();
    h.fake.on('POST', '/auth/logout', noContent());
    await TestBed.inject(AuthApi).logout();

    const persisted = [localStorage, sessionStorage]
      .flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`))
      .join('\n');
    expect(persisted).not.toMatch(/secret/);
    expect(document.cookie).not.toMatch(/secret/);
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join('\n');
    expect(logged).not.toMatch(/secret/);
    expect(h.store.writes).toEqual(['refresh-secret-1', 'refresh-secret-2']);
    spies.forEach((s) => s.mockRestore());
  });
});
