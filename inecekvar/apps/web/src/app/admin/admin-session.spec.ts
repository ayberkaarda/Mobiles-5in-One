import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionStore } from '@inecekvar/data-access';
import { AdminApi } from './admin-api';
import { AdminSession } from './admin-session';

function setup() {
  const user = signal<{ id: string; role: string } | null>(null);
  const store = {
    user,
    status: computed(() => (user() ? 'signed-in' : 'anonymous')),
    role: computed(() => user()?.role ?? null),
    init: vi.fn(async () => undefined),
    login: vi.fn(async (email: string) => {
      const next = { id: email, role: email.startsWith('mod') ? 'moderator' : 'contributor' };
      user.set(next);
      return next;
    }),
    logout: vi.fn(async () => user.set(null)),
    reload: vi.fn(async () => {
      const current = user();
      if (current === null) throw new Error('anonymous');
      return current;
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      AdminSession,
      { provide: SessionStore, useValue: store },
      {
        provide: AdminApi,
        useValue: {
          totpStatus: vi.fn(async () => ({ enabled: true, enabled_at: null, pending: false })),
        },
      },
    ],
  });
  return { session: TestBed.inject(AdminSession), store, user };
}

afterEach(() => TestBed.resetTestingModule());

describe('AdminSession', () => {
  it('starts once', async () => {
    const { session, store } = setup();
    await Promise.all([session.ready(), session.ready()]);
    expect(store.init).toHaveBeenCalledTimes(1);
  });

  it('changes the generation on every account switch and sign-out', async () => {
    const { session } = setup();
    await session.ready();
    const start = session.generation();
    await session.signIn('mod1@example.com', 'x');
    const first = session.generation();
    expect(first).toBeGreaterThan(start);
    await session.signOut();
    expect(session.generation()).toBeGreaterThan(first);
    expect(session.notice()).toBe('signed-out');
    await session.signIn('mod2@example.com', 'x');
    expect(session.notice()).toBeNull();
  });

  it('signs a non-staff account straight out with a notice', async () => {
    const { session, store } = setup();
    await session.ready();
    await expect(session.signIn('katki@example.com', 'x')).resolves.toBe('not-staff');
    expect(store.logout).toHaveBeenCalledTimes(1);
    expect(session.notice()).toBe('not-staff');
    expect(session.status()).toBe('anonymous');
  });

  it('marks a session the server ended as expired', async () => {
    const { session, user } = setup();
    await session.signIn('mod1@example.com', 'x');
    user.set(null);
    session.track();
    expect(session.notice()).toBe('expired');
  });

  it('re-checks GET me and resets everything when another tab signed in as someone else', async () => {
    const { session, store, user } = setup();
    await session.signIn('mod1@example.com', 'x');
    await session.refreshTotp();
    const before = session.generation();
    store.reload.mockImplementation(async () => {
      const next = { id: 'mod2@example.com', role: 'moderator' };
      user.set(next);
      return next;
    });
    await expect(session.recheck()).resolves.toBe(false);
    expect(store.reload).toHaveBeenCalledTimes(1);
    expect(session.generation()).toBeGreaterThan(before);
    expect(session.user()?.id).toBe('mod2@example.com');
    expect(session.totp()).toBeNull();
  });

  it('keeps the generation when the re-checked account is unchanged and shares one request', async () => {
    const { session, store } = setup();
    await session.signIn('mod1@example.com', 'x');
    const before = session.generation();
    await expect(Promise.all([session.recheck(), session.recheck()])).resolves.toEqual([
      true,
      true,
    ]);
    expect(store.reload).toHaveBeenCalledTimes(1);
    expect(session.generation()).toBe(before);
  });

  it('does not call GET me while signed out', async () => {
    const { session, store } = setup();
    await session.ready();
    await expect(session.recheck()).resolves.toBe(true);
    expect(store.reload).not.toHaveBeenCalled();
  });

  it('treats a session ended during the re-check as an account change', async () => {
    const { session, store, user } = setup();
    await session.signIn('mod1@example.com', 'x');
    store.reload.mockImplementation(async () => {
      user.set(null);
      throw new Error('401');
    });
    await expect(session.recheck()).resolves.toBe(false);
    expect(session.notice()).toBe('expired');
  });

  it('forgets the TOTP status of the previous account', async () => {
    const { session } = setup();
    await session.signIn('mod1@example.com', 'x');
    await session.refreshTotp();
    expect(session.totp()?.enabled).toBe(true);
    await session.signOut();
    expect(session.totp()).toBeNull();
  });
});
