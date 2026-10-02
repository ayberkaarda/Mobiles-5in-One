import { http, HttpResponse } from 'msw';

import { type ApiClientOptions, createApiClient } from '../../src/api/client';
import { type MobileRefreshResponse } from '../../src/api/contracts';
import { createSession, type SessionDeps, type SessionTokens } from '../../src/auth-store/session';
import { type AuthStore, createAuthStore } from '../../src/auth-store/store';
import { secureTokenStorage, type TokenStorage } from '../../src/auth-store/token-storage';
import { registerSecret } from './async-storage';
import { apiUrl, mswServer, TEST_API_URL } from './msw';

let tokenSerial = 0;

/**
 * A fresh token pair; every value is registered with the AsyncStorage double, so a test fails if
 * any of them is ever written there.
 */
export function issueTokens(accessTtlMs = 15 * 60 * 1000): SessionTokens & {
  refreshTokenExpiresAt: string;
  tokenType: 'Bearer';
} {
  tokenSerial += 1;
  const tokens = {
    tokenType: 'Bearer' as const,
    accessToken: `eyJhbGciOiJFUzI1NiJ9.access-${tokenSerial}.signature`,
    accessTokenExpiresAt: new Date(Date.now() + accessTtlMs).toISOString(),
    refreshToken: `refresh-token-value-${tokenSerial}-${'x'.repeat(32)}`,
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  registerSecret(tokens.accessToken);
  registerSecret(tokens.refreshToken);
  return tokens;
}

/** Problem details body as the API sends it (RFC 9457). */
export function problem(status: number, code: string, requestId = 'req-test-1') {
  return HttpResponse.json(
    {
      type: `https://kadro.app/problems/${code}`,
      title: 'Server title that must never reach the UI',
      status,
      code,
      requestId,
      detail: 'Internal detail that must never reach the UI',
    },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

export interface RefreshServer {
  readonly calls: () => number;
  /** The refresh token presented on each call, in order. */
  readonly presented: () => readonly string[];
}

/**
 * `POST /auth/refresh` that rotates like the server (ADR-0019): the current token yields a new
 * pair; a spent token is reuse and gets 401.
 */
export function rotatingRefreshServer(initialRefreshToken: string): RefreshServer & {
  readonly current: () => SessionTokens;
} {
  let validToken = initialRefreshToken;
  let latest: SessionTokens | null = null;
  const presented: string[] = [];
  mswServer.use(
    http.post(apiUrl('/api/v1/auth/refresh'), async ({ request }) => {
      const body = (await request.json()) as { refreshToken?: string };
      presented.push(body.refreshToken ?? '');
      if (body.refreshToken !== validToken) {
        return problem(401, 'unauthenticated');
      }
      const next = issueTokens();
      validToken = next.refreshToken;
      latest = next;
      const response: MobileRefreshResponse = { tokens: next };
      return HttpResponse.json(response);
    }),
  );
  return {
    calls: () => presented.length,
    presented: () => presented,
    current: () => {
      if (latest === null) {
        throw new Error('no refresh happened');
      }
      return latest;
    },
  };
}

/** Session and API client wired like `src/api/instance.ts`, against the MSW base URL. */
export interface TestApiOptions extends Partial<ApiClientOptions> {
  readonly storage?: TokenStorage;
  /** Auth state to use, e.g. the app-wide store that components read; a fresh one by default. */
  readonly store?: AuthStore;
  readonly reportError?: SessionDeps['reportError'];
}

export function createTestApi({
  storage = secureTokenStorage,
  store = createAuthStore(),
  reportError,
  ...overrides
}: TestApiOptions = {}) {
  const revoked: string[] = [];
  const session = createSession({
    store,
    storage,
    reportError,
    async refresh(refreshToken) {
      const response = await api.request<MobileRefreshResponse>('/api/v1/auth/refresh', {
        method: 'POST',
        auth: 'none',
        body: { refreshToken },
      });
      return response.tokens;
    },
    async revoke(refreshToken) {
      revoked.push(refreshToken);
      await api.request<unknown>('/api/v1/auth/logout', {
        method: 'POST',
        auth: 'none',
        body: { refreshToken },
      });
    },
  });
  const api = createApiClient({
    baseUrl: TEST_API_URL,
    session,
    retryDelaysMs: [0, 0],
    ...overrides,
  });
  return { api, session, store, revoked };
}
