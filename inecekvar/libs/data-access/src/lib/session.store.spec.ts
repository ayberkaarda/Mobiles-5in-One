import { TestBed } from '@angular/core/testing';
import {
  bearerSignIn,
  cookieSignIn,
  deferred,
  json,
  ME,
  noContent,
  problem,
} from '../testing/fake-fetch';
import { type Harness, setupDataAccess } from '../testing/setup';
import { readMagicLinkFragment } from './auth/magic-link';
import { AccountApi } from './endpoints';
import { SessionStore } from './session.store';

const TOKEN = 'Abc_def-0123456789abcdefghijklmnopqrstuvwxy';

function fakeLocation(hash: string) {
  const history = { state: { navigationId: 1 }, replaceState: vi.fn() };
  const location = { hash, pathname: '/giris/baglanti', search: '?utm=mail' };
  return { history, location };
}

describe('SessionStore', () => {
  let h: Harness;

  describe('on the web (cookie)', () => {
    beforeEach(() => {
      h = setupDataAccess(false);
    });

    it('strips the magic-link fragment synchronously, before any request', async () => {
      h.fake.on('GET', '/me', problem(401, 'auth.required'));
      const { history, location } = fakeLocation(`#token=${TOKEN}`);
      const session = TestBed.inject(SessionStore);
      const done = session.init(location, history);
      expect(history.replaceState).toHaveBeenCalledWith(
        { navigationId: 1 },
        '',
        '/giris/baglanti?utm=mail',
      );
      expect(h.fake.calls).toHaveLength(0);
      await done;
      expect(session.hasPendingMagicLink()).toBe(true);
    });

    it('strips a malformed token too, without keeping it', async () => {
      h.fake.on('GET', '/me', problem(401, 'auth.required'));
      const { history, location } = fakeLocation('#token=%3Cscript%3E');
      const session = TestBed.inject(SessionStore);
      await session.init(location, history);
      expect(history.replaceState).toHaveBeenCalledTimes(1);
      expect(session.hasPendingMagicLink()).toBe(false);
    });

    it('leaves other fragments alone', async () => {
      h.fake.on('GET', '/me', problem(401, 'auth.required'));
      const { history, location } = fakeLocation('#harita');
      await TestBed.inject(SessionStore).init(location, history);
      expect(history.replaceState).not.toHaveBeenCalled();
      expect(readMagicLinkFragment('')).toEqual({ present: false, token: null });
    });

    it('restores a signed-in user with role and licence flag', async () => {
      h.fake.on('GET', '/me', json({ ...ME, role: 'contributor', licence_accepted: true }));
      const session = TestBed.inject(SessionStore);
      expect(session.status()).toBe('unknown');
      await session.init(fakeLocation('').location, fakeLocation('').history);
      expect(session.status()).toBe('signed-in');
      expect(session.role()).toBe('contributor');
      expect(session.licenceAccepted()).toBe(true);
    });

    it('is anonymous when the cookie is gone', async () => {
      h.fake.on('GET', '/me', problem(401, 'auth.required'));
      const session = TestBed.inject(SessionStore);
      await session.init(fakeLocation('').location, fakeLocation('').history);
      expect(session.status()).toBe('anonymous');
      expect(session.user()).toBeNull();
      expect(session.role()).toBeNull();
    });

    it('stays unknown when the API cannot be reached', async () => {
      h.fake.on('GET', '/me', () => Promise.reject(new TypeError('offline')));
      const session = TestBed.inject(SessionStore);
      await session.init(fakeLocation('').location, fakeLocation('').history);
      expect(session.status()).toBe('unknown');
    });

    it('asks for the registration password when the link needs it, then signs in', async () => {
      h.fake.on('GET', '/me', problem(401, 'auth.required'));
      h.fake.on(
        'POST',
        '/auth/magic-link/verify',
        problem(401, 'auth.invalid_credentials'),
        json(cookieSignIn()),
      );
      const session = TestBed.inject(SessionStore);
      const { history, location } = fakeLocation(`#token=${TOKEN}`);
      await session.init(location, history);
      await expect(session.completeMagicLink()).rejects.toMatchObject({
        code: 'auth.invalid_credentials',
      });
      expect(session.hasPendingMagicLink()).toBe(true);
      await session.completeMagicLink('the registration pw');
      expect(session.isSignedIn()).toBe(true);
      expect(session.hasPendingMagicLink()).toBe(false);
      expect(h.fake.callsTo('POST', '/auth/magic-link/verify').map((c) => c.body)).toEqual([
        { token: TOKEN, mode: 'cookie' },
        { token: TOKEN, mode: 'cookie', password: 'the registration pw' },
      ]);
    });

    it('drops a link the API refuses for another reason', async () => {
      h.fake.on('POST', '/auth/magic-link/verify', problem(401, 'auth.token_invalid'));
      const session = TestBed.inject(SessionStore);
      session.consumeMagicLinkUrl(`https://app.inecekvar.app/giris/baglanti#token=${TOKEN}`);
      await expect(session.completeMagicLink()).rejects.toMatchObject({
        code: 'auth.token_invalid',
      });
      expect(session.hasPendingMagicLink()).toBe(false);
      await expect(session.completeMagicLink()).rejects.toThrow('no magic link is pending');
    });

    it('turns anonymous when the server ends the session during use', async () => {
      h.fake.on('GET', '/me', json(ME), problem(401, 'auth.required'));
      const session = TestBed.inject(SessionStore);
      await session.init(fakeLocation('').location, fakeLocation('').history);
      expect(session.isSignedIn()).toBe(true);
      await expect(TestBed.inject(AccountApi).me()).rejects.toMatchObject({ status: 401 });
      expect(session.status()).toBe('anonymous');
    });

    it('signs in with a password, accepts the licence and logs out offline', async () => {
      h.fake.on('POST', '/auth/login', json(cookieSignIn()));
      h.fake.on(
        'POST',
        '/me/licence-accept',
        json({ ...ME, licence_accepted: true, role: 'contributor' }),
      );
      h.fake.on('POST', '/auth/logout', () => Promise.reject(new TypeError('offline')));
      const session = TestBed.inject(SessionStore);
      await session.login('deniz@example.test', 'correct horse battery');
      expect(session.licenceAccepted()).toBe(false);
      await session.acceptLicence();
      expect(session.licenceAccepted()).toBe(true);
      expect(session.role()).toBe('contributor');
      expect(h.fake.callsTo('POST', '/me/licence-accept')[0]?.headers.get('X-CSRF-Token')).toBe(
        'csrf-from-login',
      );
      await expect(session.logout()).rejects.toMatchObject({ kind: 'network' });
      expect(session.status()).toBe('anonymous');
      expect(session.logoutPending()).toBe(true);
    });

    it('discards init results received after logout', async () => {
      const reply = deferred<Response>();
      h.fake.on('GET', '/me', () => reply.promise);
      h.fake.on('POST', '/auth/csrf', json({ csrf_token: 'csrf-A' }));
      h.fake.on('POST', '/auth/logout', noContent());
      const session = TestBed.inject(SessionStore);
      const pending = session.init(fakeLocation('').location, fakeLocation('').history);
      await vi.waitFor(() => expect(h.fake.callsTo('GET', '/me')).toHaveLength(1));
      await session.logout();
      reply.resolve(json(ME));
      await pending;
      expect(session.status()).toBe('anonymous');
    });

    it('discards reload results received after logout', async () => {
      const reply = deferred<Response>();
      h.fake.on('POST', '/auth/login', json(cookieSignIn()));
      h.fake.on('GET', '/me', () => reply.promise);
      h.fake.on('POST', '/auth/logout', noContent());
      const session = TestBed.inject(SessionStore);
      await session.login('a@example.test', 'password-A');
      const pending = session.reload();
      await vi.waitFor(() => expect(h.fake.callsTo('GET', '/me')).toHaveLength(1));
      await session.logout();
      reply.resolve(json(ME));
      await expect(pending).resolves.toEqual(ME);
      expect(session.status()).toBe('anonymous');
    });

    it('discards licence results received after logout', async () => {
      const reply = deferred<Response>();
      h.fake.on('POST', '/auth/login', json(cookieSignIn()));
      h.fake.on('POST', '/me/licence-accept', () => reply.promise);
      h.fake.on('POST', '/auth/logout', noContent());
      const session = TestBed.inject(SessionStore);
      await session.login('a@example.test', 'password-A');
      const pending = session.acceptLicence();
      await vi.waitFor(() => expect(h.fake.callsTo('POST', '/me/licence-accept')).toHaveLength(1));
      await session.logout();
      reply.resolve(json({ ...ME, licence_accepted: true }));
      await pending;
      expect(session.status()).toBe('anonymous');
    });

    it('discards login results received after logout', async () => {
      const reply = deferred<Response>();
      h.fake.on('POST', '/auth/login', () => reply.promise);
      h.fake.on('POST', '/auth/csrf', problem(401, 'auth.required'));
      const session = TestBed.inject(SessionStore);
      const pending = session.login('a@example.test', 'password-A');
      await vi.waitFor(() => expect(h.fake.callsTo('POST', '/auth/login')).toHaveLength(1));
      await session.logout();
      reply.resolve(json(cookieSignIn()));
      await pending;
      expect(session.status()).toBe('anonymous');
    });

    it('discards magic-link results received after logout', async () => {
      const reply = deferred<Response>();
      h.fake.on('POST', '/auth/magic-link/verify', () => reply.promise);
      h.fake.on('POST', '/auth/csrf', problem(401, 'auth.required'));
      const session = TestBed.inject(SessionStore);
      session.consumeMagicLinkUrl(`https://app.test/#token=${TOKEN}`);
      const pending = session.completeMagicLink();
      await vi.waitFor(() =>
        expect(h.fake.callsTo('POST', '/auth/magic-link/verify')).toHaveLength(1),
      );
      await session.logout();
      reply.resolve(json(cookieSignIn()));
      await pending;
      expect(session.status()).toBe('anonymous');
    });

    it('discards reload results received after another sign-in', async () => {
      const reply = deferred<Response>();
      const userB = { ...ME, id: 'user-B', display_name: 'B' };
      h.fake.on(
        'POST',
        '/auth/login',
        json(cookieSignIn()),
        json({ ...cookieSignIn('csrf-B'), user: userB }),
      );
      h.fake.on('GET', '/me', () => reply.promise);
      const session = TestBed.inject(SessionStore);
      await session.login('a@example.test', 'password-A');
      const pending = session.reload();
      await vi.waitFor(() => expect(h.fake.callsTo('GET', '/me')).toHaveLength(1));
      await session.login('b@example.test', 'password-B');
      reply.resolve(json(ME));
      await pending;
      expect(session.user()).toEqual(userB);
    });

    it('passes register and magic-link requests through', async () => {
      h.fake.on('POST', '/auth/register', json({ status: 'check_email' }, 202));
      h.fake.on('POST', '/auth/magic-link', json({ status: 'check_email' }, 202));
      const session = TestBed.inject(SessionStore);
      await expect(session.register('a@example.test', 'pw-1234567890', 'Ada')).resolves.toEqual({
        status: 'check_email',
      });
      await session.requestMagicLink('a@example.test');
      expect(h.fake.callsTo('POST', '/auth/register')[0]?.body).toEqual({
        email: 'a@example.test',
        password: 'pw-1234567890',
        mode: 'cookie',
        display_name: 'Ada',
      });
    });
  });

  describe('in the native app (bearer)', () => {
    beforeEach(() => {
      h = setupDataAccess(true);
    });

    it('is anonymous without a stored refresh token and asks nothing', async () => {
      const session = TestBed.inject(SessionStore);
      await session.init(fakeLocation('').location, fakeLocation('').history);
      expect(session.status()).toBe('anonymous');
      expect(h.fake.calls).toHaveLength(0);
    });

    it('turns anonymous when the refresh is refused', async () => {
      h.store.value = 'refresh-old';
      h.fake.on('POST', '/auth/refresh', problem(401, 'auth.token_invalid'));
      const session = TestBed.inject(SessionStore);
      await session.init(fakeLocation('').location, fakeLocation('').history);
      expect(session.status()).toBe('anonymous');
      expect(h.store.value).toBeNull();
    });

    it('deletes the account and forgets every credential', async () => {
      h.fake.on('POST', '/auth/login', json(bearerSignIn()));
      h.fake.on('DELETE', '/me', json({ status: 'deletion_scheduled' }, 202));
      const session = TestBed.inject(SessionStore);
      await session.login('deniz@example.test', 'correct horse battery');
      await expect(session.deleteAccount('correct horse battery')).resolves.toEqual({
        status: 'deletion_scheduled',
      });
      expect(h.fake.callsTo('DELETE', '/me')[0]?.body).toEqual({
        password: 'correct horse battery',
      });
      expect(h.store.value).toBeNull();
      expect(session.status()).toBe('anonymous');
    });

    it('logs out everywhere', async () => {
      h.fake.on('POST', '/auth/login', json(bearerSignIn()));
      h.fake.on('POST', '/auth/logout-all', noContent());
      const session = TestBed.inject(SessionStore);
      await session.login('deniz@example.test', 'correct horse battery');
      await session.logoutEverywhere();
      expect(h.fake.callsTo('POST', '/auth/logout-all')[0]?.headers.get('Authorization')).toBe(
        'Bearer access-1',
      );
      expect(h.store.value).toBeNull();
      expect(session.status()).toBe('anonymous');
    });
  });
});
