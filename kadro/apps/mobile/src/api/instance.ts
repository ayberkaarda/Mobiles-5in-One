import { loadMobilePublicEnv } from '@kadro/config/mobile';

import { createSession } from '../auth-store/session';
import { authStore } from '../auth-store/store';
import { secureTokenStorage } from '../auth-store/token-storage';
import { createApiClient } from './client';
import { type MobileRefreshResponse } from './contracts';

/** Logout must not hold up the sign-out screen for the full request timeout. */
const LOGOUT_TIMEOUT_MS = 5_000;

// `EXPO_PUBLIC_API_URL` is read only through `@kadro/config/mobile`, which validates it (https://
// outside the local environment) exactly as the build configuration does.
const { EXPO_PUBLIC_API_URL: apiUrl } = loadMobilePublicEnv();

/** The app session: refresh token in secure storage, access token in memory. */
export const session = createSession({
  store: authStore,
  storage: secureTokenStorage,
  reportError(stage, error) {
    // Sign-out tolerates these failures; in development they are surfaced (no token or server
    // text is part of the stage or the error name).
    if (__DEV__) {
      // eslint-disable-next-line no-console -- development diagnostics until error reporting exists
      console.warn(`session ${stage} failed: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  },
  async refresh(refreshToken) {
    const response = await api.request<MobileRefreshResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      auth: 'none',
      body: { refreshToken },
    });
    return response.tokens;
  },
  async revoke(refreshToken, accessToken) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);
    try {
      await logoutClient(accessToken).request<unknown>('/api/v1/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  },
});

/** The shared API client: bearer auth, single-flight refresh, problem details, GET retries. */
export const api = createApiClient({ baseUrl: apiUrl, session });

/**
 * Logout sends the current access token as is: an expired one must not start a refresh that
 * rotates the family being revoked.
 */
function logoutClient(accessToken: string | null) {
  return createApiClient({
    baseUrl: apiUrl,
    retryDelaysMs: [],
    session: {
      getAccessToken: () => accessToken,
      hasSession: () => accessToken !== null,
      refreshAccessToken: async () => null,
    },
  });
}
