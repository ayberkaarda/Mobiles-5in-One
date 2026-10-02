import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { routeAccess } from '../src/auth-store/route-guard';
import { ACCESS_TOKEN_SKEW_MS } from '../src/auth-store/session';
import { REFRESH_TOKEN_KEY } from '../src/auth-store/token-storage';
import {
  clearQueryCaches,
  createQueryPersister,
  persistOptions,
  QUERY_CACHE_STORAGE_KEY,
  queryKeys,
  teamsQuery,
} from '../src/query';
import { createTestApi, issueTokens, rotatingRefreshServer } from './support/api';
import AsyncStorage, {
  asyncStorageContents,
  registerSecret,
  takeAsyncStorageViolations,
} from './support/async-storage';
import { secureStoreContents } from './support/expo-secure-store';
import { apiUrl, mswServer } from './support/msw';

const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;

describe('AsyncStorage guard (threat model T-MOB-01)', () => {
  it('detects a credential written to AsyncStorage', async () => {
    registerSecret('refresh-secret-value');
    await AsyncStorage.setItem('kadro.profile', JSON.stringify({ token: 'refresh-secret-value' }));
    await AsyncStorage.setItem('kadro.accessToken', 'anything');
    // Taken here so this deliberate violation does not fail the test in the shared afterEach.
    expect(takeAsyncStorageViolations()).toEqual([
      'AsyncStorage write to "kadro.profile" contains a registered token',
      'AsyncStorage key "kadro.accessToken" names a credential',
    ]);
  });
});

describe('session storage', () => {
  it('keeps the refresh token only in secure storage, device-bound', async () => {
    const { session, store } = createTestApi();
    const tokens = issueTokens();
    await session.establish(tokens);

    const stored = secureStoreContents().get(REFRESH_TOKEN_KEY);
    expect(stored?.value).toBe(tokens.refreshToken);
    expect(stored?.options).toEqual({ keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    // The access token is held in memory only.
    expect(store.getState().accessToken).toBe(tokens.accessToken);
    expect([...secureStoreContents().values()].map((item) => item.value)).not.toContain(
      tokens.accessToken,
    );
    expect(asyncStorageContents().size).toBe(0);
  });

  it('bootstraps signed in from a stored refresh token, without an access token', async () => {
    const first = createTestApi();
    await first.session.establish(issueTokens());
    const restarted = createTestApi();
    await restarted.session.bootstrap();
    expect(restarted.store.getState()).toEqual({
      status: 'signedIn',
      accessToken: null,
      accessTokenExpiresAt: null,
      cacheScope: expect.any(String),
    });
    expect(routeAccess(restarted.store.getState().status)).toEqual({
      pending: false,
      signedInRoutes: true,
      signedOutRoutes: false,
    });
  });

  it('bootstraps signed out without a stored token and clears leftover caches', async () => {
    const { session, store } = createTestApi();
    expect(routeAccess(store.getState().status).pending).toBe(true);
    const cleared: string[] = [];
    session.onSignOut((reason) => {
      cleared.push(reason);
    });
    await session.bootstrap();
    expect(routeAccess(store.getState().status)).toEqual({
      pending: false,
      signedInRoutes: false,
      signedOutRoutes: true,
    });
    expect(cleared).toEqual(['expired']);
  });

  it('stops sending the access token shortly before it expires', async () => {
    const { session } = createTestApi();
    await session.establish(issueTokens(ACCESS_TOKEN_SKEW_MS - 1_000));
    expect(session.getAccessToken()).toBeNull();
    await session.establish(issueTokens(ACCESS_TOKEN_SKEW_MS + 60_000));
    expect(session.getAccessToken()).not.toBeNull();
  });
});

describe('sign-out', () => {
  it('revokes on the server, then clears secure storage, memory and both query caches', async () => {
    const { api, session, store, revoked } = createTestApi();
    const tokens = issueTokens();
    await session.establish(tokens);
    mswServer.use(
      http.post(apiUrl('/api/v1/auth/logout'), () => new HttpResponse(null, { status: 204 })),
      http.get(apiUrl('/api/v1/teams'), () =>
        HttpResponse.json({
          items: [
            {
              id: '0192a0b0-0000-7000-8000-000000000001',
              name: 'Yıldızlar FK',
              slug: 'yildizlar-fk',
              badgeUrl: null,
              districtId: '0192a0b0-0000-7000-8000-0000000000d1',
              myRole: 'captain',
              memberCount: 9,
              isProLocked: false,
              createdAt: '2026-09-01T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        }),
      ),
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const persister = createQueryPersister(AsyncStorage);
    session.onSignOut(() => clearQueryCaches(queryClient, persister));
    await queryClient.fetchInfiniteQuery(teamsQuery(api));
    await persistQueryClientSave({ queryClient, ...persistOptions(persister, 'test') });
    // Throttled writes land within the persister's throttle window.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(asyncStorageContents().get(QUERY_CACHE_STORAGE_KEY)).toContain('Yıldızlar FK');

    await session.signOut();

    expect(revoked).toEqual([tokens.refreshToken]);
    expect(store.getState().status).toBe('signedOut');
    expect(store.getState().accessToken).toBeNull();
    expect(secureStoreContents().size).toBe(0);
    expect(queryClient.getQueryData(queryKeys.teams())).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(asyncStorageContents().get(QUERY_CACHE_STORAGE_KEY) ?? '').not.toContain('Yıldızlar FK');
  });

  it('completes locally when the server cannot be reached', async () => {
    const { session, store } = createTestApi();
    await session.establish(issueTokens());
    mswServer.use(http.post(apiUrl('/api/v1/auth/logout'), () => HttpResponse.error()));
    await session.signOut();
    expect(store.getState().status).toBe('signedOut');
    expect(secureStoreContents().size).toBe(0);
  });

  it('never writes a token to AsyncStorage across sign-in, refresh, caching and sign-out', async () => {
    const { api, session } = createTestApi();
    const tokens = issueTokens(-1_000);
    await session.establish(tokens);
    const refresh = rotatingRefreshServer(tokens.refreshToken);
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => HttpResponse.json({ items: [], nextCursor: null })),
      http.post(apiUrl('/api/v1/auth/logout'), () => new HttpResponse(null, { status: 204 })),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const persister = createQueryPersister(AsyncStorage);
    await queryClient.fetchInfiniteQuery(teamsQuery(api));
    await persistQueryClientSave({ queryClient, ...persistOptions(persister, 'test') });
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(refresh.calls()).toBe(1);
    await session.signOut();
    // The shared afterEach fails this test if any registered token reached AsyncStorage.
    for (const value of asyncStorageContents().values()) {
      expect(value).not.toContain(refresh.current().refreshToken);
    }
  });
});
