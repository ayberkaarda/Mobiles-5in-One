import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { SessionStore } from '@inecekvar/data-access';
import { filter, first, map, race, timer } from 'rxjs';

/** How long a first navigation waits for the start-up session check. */
export const SESSION_WAIT_MS = 3000;

/**
 * Sends a guest to `/giris` with the page to come back to. This is a convenience only: the API
 * checks every request (spec section 6.4). A deep link waits briefly for the start-up session
 * check; a session still unknown after that (offline) is let through so the page can explain.
 */
export const signedInGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionStore);
  const router = inject(Router);
  const decide = (status: string) =>
    status === 'anonymous'
      ? router.createUrlTree(['/giris'], { queryParams: { sonra: state.url } })
      : true;
  if (session.status() !== 'unknown') return decide(session.status());
  const settled = toObservable(session.status).pipe(filter((status) => status !== 'unknown'));
  return race(settled, timer(SESSION_WAIT_MS).pipe(map(() => 'unknown'))).pipe(
    first(),
    map(decide),
  );
};
