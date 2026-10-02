import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * - `unknown`: secure storage not read yet (splash screen stays up).
 * - `signedIn`: a refresh token is stored; the access token may still need a refresh.
 * - `signedOut`: no session on this device.
 */
export type AuthStatus = 'unknown' | 'signedIn' | 'signedOut';

export interface AuthState {
  readonly status: AuthStatus;
  /** Bearer token for API calls. Memory only: never persisted, gone when the app is killed. */
  readonly accessToken: string | null;
  /** Epoch milliseconds after which `accessToken` is no longer sent. */
  readonly accessTokenExpiresAt: number | null;
  /** Id of the current sign-in; scopes the persisted query cache. `null` when signed out. */
  readonly cacheScope: string | null;
}

export const SIGNED_OUT_STATE: AuthState = {
  status: 'signedOut',
  accessToken: null,
  accessTokenExpiresAt: null,
  cacheScope: null,
};

/**
 * In-memory auth state. No persistence middleware is attached on purpose: tokens must not reach
 * AsyncStorage (threat model T-MOB-01).
 */
export function createAuthStore() {
  return createStore<AuthState>()(() => ({
    status: 'unknown',
    accessToken: null,
    accessTokenExpiresAt: null,
    cacheScope: null,
  }));
}

export type AuthStore = ReturnType<typeof createAuthStore>;

export const authStore: AuthStore = createAuthStore();

export function useAuthStatus(store: AuthStore = authStore): AuthStatus {
  return useStore(store, (state) => state.status);
}
