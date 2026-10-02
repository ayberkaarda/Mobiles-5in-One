import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { REFRESH_TOKEN_KEY } from '../src/auth-store/token-storage';
import { createTestApi, issueTokens, problem } from './support/api';
import { deferred } from './support/deferred';
import { secureStoreContents } from './support/expo-secure-store';
import { apiUrl, mswServer } from './support/msw';

const TEAMS = { items: [], nextCursor: null };

describe('a failed refresh is never repeated by the request retry (ADR-0019)', () => {
  it('after a 401: one refresh, one resource call, no automatic repeat', async () => {
    const { api, session, store } = createTestApi();
    const tokens = issueTokens();
    await session.establish(tokens);
    let refreshCalls = 0;
    let teamCalls = 0;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => {
        teamCalls += 1;
        return problem(401, 'unauthenticated');
      }),
      // The server may have rotated the token before the connection dropped: the outcome is
      // unknown, so presenting the same token again could be reuse.
      http.post(apiUrl('/api/v1/auth/refresh'), () => {
        refreshCalls += 1;
        return HttpResponse.error();
      }),
    );

    await expect(api.request('/api/v1/teams')).rejects.toMatchObject({ kind: 'network' });
    expect(refreshCalls).toBe(1);
    expect(teamCalls).toBe(1);
    expect(store.getState().status).toBe('signedIn');
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value).toBe(tokens.refreshToken);
  });

  it('with an expired access token: one refresh, the resource is not called', async () => {
    const { api, session } = createTestApi();
    await session.establish(issueTokens(-1_000));
    let refreshCalls = 0;
    let teamCalls = 0;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => {
        teamCalls += 1;
        return HttpResponse.json(TEAMS);
      }),
      http.post(apiUrl('/api/v1/auth/refresh'), () => {
        refreshCalls += 1;
        return HttpResponse.error();
      }),
    );

    await expect(api.request('/api/v1/teams')).rejects.toMatchObject({ kind: 'network' });
    expect(refreshCalls).toBe(1);
    expect(teamCalls).toBe(0);
  });
});

describe('caller cancellation', () => {
  it('stops waiting for a refresh when the caller aborts', async () => {
    const { api, session } = createTestApi();
    await session.establish(issueTokens(-1_000));
    const received = deferred();
    const release = deferred();
    mswServer.use(
      http.post(apiUrl('/api/v1/auth/refresh'), async () => {
        received.resolve();
        await release.promise;
        return problem(503, 'service_unavailable');
      }),
    );
    const controller = new AbortController();
    const pending = api.request('/api/v1/teams', { signal: controller.signal });
    await received.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    release.resolve();
  });

  it('stops the pause before a retry when the caller aborts', async () => {
    const sleeping = deferred();
    const { api, session } = createTestApi({
      retryDelaysMs: [60_000],
      // The pause never ends by itself: only the cancellation can finish the call.
      sleep: () => {
        sleeping.resolve();
        return new Promise<void>(() => undefined);
      },
    });
    await session.establish(issueTokens());
    mswServer.use(http.get(apiUrl('/api/v1/teams'), () => problem(503, 'service_unavailable')));
    const controller = new AbortController();
    const pending = api.request('/api/v1/teams', { signal: controller.signal });
    await sleeping.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
