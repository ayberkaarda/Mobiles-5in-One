import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from '@inecekvar/data-access';

/**
 * Sends a guest to `/giris` with the page to come back to. This is a convenience only: the API
 * checks every request (spec section 6.4), and an unknown session (offline at start-up) is let
 * through so the page can explain itself.
 */
export const signedInGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionStore);
  if (session.status() !== 'anonymous') return true;
  return inject(Router).createUrlTree(['/giris'], { queryParams: { sonra: state.url } });
};
