import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type ActivatedRouteSnapshot,
  provideRouter,
  Router,
  type RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import type { Role } from './admin-api';
import { AdminSession, STAFF_ROLES } from './admin-session';
import { guestGuard, roleGuard, staffGuard } from './guards';

function setup(role: Role | null) {
  const user = signal(role === null ? null : { id: 'u1', role });
  const session = {
    ready: vi.fn(async () => undefined),
    status: computed(() => (user() ? 'signed-in' : 'anonymous')),
    role: computed(() => user()?.role ?? null),
    isStaff: computed(() => {
      const current = user()?.role;
      return current !== undefined && STAFF_ROLES.includes(current);
    }),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: AdminSession, useValue: session }],
  });
  return session;
}

async function run(guard: typeof staffGuard): Promise<string | true> {
  const result = await TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
  if (result instanceof UrlTree) return TestBed.inject(Router).serializeUrl(result);
  return result as true;
}

afterEach(() => TestBed.resetTestingModule());

describe('admin guards (UX only)', () => {
  it('sends guests to the sign-in page after the session check', async () => {
    const session = setup(null);
    await expect(run(staffGuard)).resolves.toBe('/admin/giris');
    expect(session.ready).toHaveBeenCalled();
  });

  it.each(['user', 'contributor'] as const)('keeps a %s out of the admin area', async (role) => {
    setup(role);
    await expect(run(staffGuard)).resolves.toBe('/admin/giris');
  });

  it.each(['moderator', 'admin'] as const)('lets a %s in', async (role) => {
    setup(role);
    await expect(run(staffGuard)).resolves.toBe(true);
  });

  it('sends a moderator away from admin-only screens to the queue', async () => {
    setup('moderator');
    await expect(run(roleGuard(['admin']))).resolves.toBe('/admin/kuyruk');
  });

  it('lets an admin open admin-only screens', async () => {
    setup('admin');
    await expect(run(roleGuard(['admin']))).resolves.toBe(true);
  });

  it('sends signed-in staff from the sign-in page to the queue', async () => {
    setup('moderator');
    await expect(run(guestGuard)).resolves.toBe('/admin/kuyruk');
  });

  it('shows the sign-in page to guests', async () => {
    setup(null);
    await expect(run(guestGuard)).resolves.toBe(true);
  });
});
