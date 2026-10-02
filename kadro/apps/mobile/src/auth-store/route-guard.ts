import { type AuthStatus } from './store';

export interface RouteAccess {
  /** Hold the splash screen: the stored session has not been read yet. */
  readonly pending: boolean;
  /** The tab navigator and every signed-in screen. */
  readonly signedInRoutes: boolean;
  /** The entry screen and the `(auth)` group (sign-in, registration, password reset). */
  readonly signedOutRoutes: boolean;
}

/**
 * Which route groups the root stack exposes. Exactly one side is open once the session is known,
 * so a signed-out user cannot reach a tab through a deep link and a signed-in user is not shown
 * the sign-in flow; expo-router sends a navigation to a closed route to the first open screen.
 */
export function routeAccess(status: AuthStatus): RouteAccess {
  return {
    pending: status === 'unknown',
    signedInRoutes: status === 'signedIn',
    signedOutRoutes: status === 'signedOut',
  };
}
