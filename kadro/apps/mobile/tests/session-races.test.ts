import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { type MobileRefreshResponse } from '../src/api/contracts';
import { REFRESH_TOKEN_KEY } from '../src/auth-store/token-storage';
import { createTestApi, issueTokens } from './support/api';
import { deferred } from './support/deferred';
import { secureStoreContents } from './support/expo-secure-store';
import { apiUrl, mswServer } from './support/msw';

/**
 * `POST /auth/refresh` that holds its answer until the test releases it, so a sign-out or a new
 * sign-in can happen while the rotation is in flight.
 */
function heldRefresh() {
  const received = deferred();
  const release = deferred();
  const rotated = issueTokens();
  let calls = 0;
  mswServer.use(
    http.post(apiUrl('/api/v1/auth/refresh'), async () => {
      calls += 1;
      received.resolve();
      await release.promise;
      const body: MobileRefreshResponse = { tokens: rotated };
      return HttpResponse.json(body);
    }),
  );
  return {
    received: received.promise,
    release: () => release.resolve(),
    rotated,
    calls: () => calls,
  };
}

describe('refresh in flight across a sign-out (session generation)', () => {
  it('discards a refresh result that arrives after sign-out', async () => {
    const { session, store } = createTestApi();
    await session.establish(issueTokens(-1_000));
    const refresh = heldRefresh();

    const pending = session.refreshAccessToken();
    await refresh.received;
    await session.signOut({ revokeRemote: false });
    refresh.release();

    await expect(pending).resolves.toBeNull();
    expect(store.getState().status).toBe('signedOut');
    expect(store.getState().accessToken).toBeNull();
    expect(secureStoreContents().has(REFRESH_TOKEN_KEY)).toBe(false);
  });

  it('keeps the new account when the previous account refresh lands after a new sign-in', async () => {
    const { session, store } = createTestApi();
    await session.establish(issueTokens(-1_000));
    const refresh = heldRefresh();

    const pending = session.refreshAccessToken();
    await refresh.received;
    await session.signOut({ revokeRemote: false });
    const nextUser = issueTokens();
    await session.establish(nextUser);
    refresh.release();
    await pending;

    expect(store.getState().accessToken).toBe(nextUser.accessToken);
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value).toBe(nextUser.refreshToken);
  });

  it('starts a fresh refresh for the new account instead of joining the stale one', async () => {
    const { session } = createTestApi();
    await session.establish(issueTokens(-1_000));
    const refresh = heldRefresh();

    const stale = session.refreshAccessToken();
    await refresh.received;
    await session.establish(issueTokens(-1_000));
    const fresh = session.refreshAccessToken();

    expect(fresh).not.toBe(stale);
    refresh.release();
    await Promise.all([stale, fresh]);
    expect(refresh.calls()).toBe(2);
  });
});
