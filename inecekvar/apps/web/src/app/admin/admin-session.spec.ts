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

  it('forgets the TOTP status of the previous account', async () => {
    const { session } = setup();
    await session.signIn('mod1@example.com', 'x');
    await session.refreshTotp();
    expect(session.totp()?.enabled).toBe(true);
    await session.signOut();
    expect(session.totp()).toBeNull();
  });
});
