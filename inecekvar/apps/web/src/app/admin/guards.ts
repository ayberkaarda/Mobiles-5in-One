import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import type { Role } from './admin-api';
import { AdminSession } from './admin-session';

export const SIGN_IN_PATH = '/admin/giris';
export const HOME_PATH = '/admin/kuyruk';

/**
 * UX only: sends guests to the sign-in page and non-staff accounts away. The API checks the
 * role, the TOTP step-up and ownership on every request (spec section 6.4).
 */
export const staffGuard: CanActivateFn = async () => {
  const session = inject(AdminSession);
  const router = inject(Router);
  await session.ready();
  if (session.status() !== 'signed-in') return router.parseUrl(SIGN_IN_PATH);
  if (!session.isStaff()) return router.parseUrl(SIGN_IN_PATH);
  return true;
};

/** UX only: hides admin-only screens from moderators; the API answers 403 regardless. */
export function roleGuard(roles: readonly Role[]): CanActivateFn {
  return async () => {
    const session = inject(AdminSession);
    const router = inject(Router);
    await session.ready();
    const role = session.role();
    if (session.status() !== 'signed-in') return router.parseUrl(SIGN_IN_PATH);
    return role !== null && roles.includes(role) ? true : router.parseUrl(HOME_PATH);
  };
}

/** The sign-in page sends staff that is already signed in to the queue. */
export const guestGuard: CanActivateFn = async () => {
  const session = inject(AdminSession);
  const router = inject(Router);
  await session.ready();
  return session.status() === 'signed-in' && session.isStaff() ? router.parseUrl(HOME_PATH) : true;
};
