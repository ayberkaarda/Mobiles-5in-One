import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api/errors';
import { REFRESH_TOKEN_KEY } from '../src/auth-store/token-storage';
import { createTestApi, issueTokens, problem, rotatingRefreshServer } from './support/api';
import { secureStoreContents } from './support/expo-secure-store';
import { apiUrl, mswServer } from './support/msw';

const TEAMS = { items: [], nextCursor: null };

async function signedIn(accessTtlMs?: number) {
  const context = createTestApi();
  const tokens = issueTokens(accessTtlMs);
  await context.session.establish(tokens);
  return { ...context, tokens };
}

describe('request headers and transport', () => {
  it('sends the mobile client header, the bearer token and JSON, never cookies', async () => {
    const { api, tokens } = await signedIn();
    let seen: Headers | null = null;
    mswServer.use(
      http.post(apiUrl('/api/v1/teams'), ({ request }) => {
        seen = request.headers;
        return HttpResponse.json({ id: 't1' }, { status: 201 });
      }),
    );
    await api.request('/api/v1/teams', { method: 'POST', body: { name: 'Yıldızlar' } });
    const headers = seen as unknown as Headers;
    expect(headers.get('x-kadro-client')).toBe('mobile');
    expect(headers.get('authorization')).toBe(`Bearer ${tokens.accessToken}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('origin')).toBeNull();
  });

  it('encodes query parameters and leaves out empty ones', async () => {
    const { api } = await signedIn();
    let search = '';
    mswServer.use(
      http.get(apiUrl('/api/v1/venues'), ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json(TEAMS);
      }),
    );
    await api.request('/api/v1/venues', {
      auth: 'optional',
      query: { q: 'Moda & Kadıköy', cursor: undefined, limit: 20 },
    });
    expect(search).toBe('?q=Moda%20%26%20Kad%C4%B1k%C3%B6y&limit=20');
  });

  it('refuses absolute URLs and paths outside /api/v1 before any request', async () => {
    const { api } = await signedIn();
    await expect(api.request('https://evil.example/api/v1/me')).rejects.toThrow(TypeError);
    await expect(api.request('/api/v1/../admin')).rejects.toThrow(TypeError);
    await expect(api.request('//evil.example/api/v1/me')).rejects.toThrow(TypeError);
  });

  it('does not follow redirects, so the token never reaches the redirect target', async () => {
    const { api } = await signedIn();
    let targetHit = false;
    mswServer.use(
      http.get(apiUrl('/api/v1/me'), () =>
        HttpResponse.redirect('https://elsewhere.test.kadro.invalid/collect', 302),
      ),
      http.get('https://elsewhere.test.kadro.invalid/collect', () => {
        targetHit = true;
        return HttpResponse.json({});
      }),
    );
    await expect(api.request('/api/v1/me')).rejects.toMatchObject({ kind: 'network' });
    expect(targetHit).toBe(false);
  });

  it('fails a required-auth call locally with 401 when there is no session', async () => {
    const { api, session } = createTestApi();
    await session.bootstrap();
    await expect(api.request('/api/v1/me')).rejects.toMatchObject({
      kind: 'problem',
      status: 401,
      code: 'unauthenticated',
    });
  });
});

describe('problem details', () => {
  it('keeps code, status, requestId and field errors and drops server prose', async () => {
    const { api } = await signedIn();
    mswServer.use(
      http.post(apiUrl('/api/v1/teams'), () =>
        HttpResponse.json(
          {
            type: 'https://kadro.app/problems/validation_failed',
            title: 'Request validation failed',
            status: 400,
            code: 'validation_failed',
            requestId: 'req-42',
            errors: [{ path: 'name', issue: 'too_small' }],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const error = await api
      .request('/api/v1/teams', { method: 'POST', body: { name: '' } })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'problem',
      status: 400,
      code: 'validation_failed',
      requestId: 'req-42',
      fieldErrors: [{ path: 'name', issue: 'too_small' }],
    });
    expect((error as ApiError).message).not.toContain('Request validation failed');
  });

  it('reports a non-problem error body with a null code', async () => {
    const { api } = await signedIn();
    mswServer.use(
      http.post(
        apiUrl('/api/v1/teams'),
        () => new HttpResponse('<html>bad gateway</html>', { status: 400 }),
      ),
    );
    await expect(api.request('/api/v1/teams', { method: 'POST', body: {} })).rejects.toMatchObject({
      kind: 'problem',
      status: 400,
      code: null,
    });
  });
});

describe('single-flight refresh (ADR-0019)', () => {
  it('answers concurrent 401s with exactly one refresh and replays every request', async () => {
    const { api, tokens } = await signedIn();
    const refresh = rotatingRefreshServer(tokens.refreshToken);
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), ({ request }) => {
        const authorization = request.headers.get('authorization');
        return authorization ===
          `Bearer ${refresh.calls() > 0 ? refresh.current().accessToken : ''}`
          ? HttpResponse.json(TEAMS)
          : problem(401, 'unauthenticated');
      }),
    );

    const results = await Promise.all([
      api.request('/api/v1/teams'),
      api.request('/api/v1/teams'),
      api.request('/api/v1/teams'),
      api.request('/api/v1/teams'),
    ]);

    expect(results).toEqual([TEAMS, TEAMS, TEAMS, TEAMS]);
    expect(refresh.calls()).toBe(1);
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value).toBe(
      refresh.current().refreshToken,
    );
  });

  it('refreshes before the request when the access token has expired, once for a burst', async () => {
    const { api, tokens } = await signedIn(-1_000);
    const refresh = rotatingRefreshServer(tokens.refreshToken);
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), ({ request }) =>
        request.headers.get('authorization') === `Bearer ${refresh.current().accessToken}`
          ? HttpResponse.json(TEAMS)
          : problem(401, 'unauthenticated'),
      ),
    );
    await Promise.all([api.request('/api/v1/teams'), api.request('/api/v1/teams')]);
    expect(refresh.calls()).toBe(1);
  });

  it('stores the rotated refresh token before waiting requests resume', async () => {
    const { session, tokens } = await signedIn(-1_000);
    const refresh = rotatingRefreshServer(tokens.refreshToken);
    const accessToken = await session.refreshAccessToken();
    expect(accessToken).toBe(refresh.current().accessToken);
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value).toBe(
      refresh.current().refreshToken,
    );
    // The next refresh presents the new token, never the spent one.
    await session.refreshAccessToken();
    expect(refresh.presented()).toEqual([
      tokens.refreshToken,
      expect.stringMatching(/^refresh-token-value-/),
    ]);
    expect(refresh.presented()[1]).not.toBe(tokens.refreshToken);
  });

  it('ends the session when the refresh token is rejected (reuse or revoked family)', async () => {
    const { api, session, store, tokens } = await signedIn();
    rotatingRefreshServer('a-different-token-the-server-considers-current');
    const signOuts: string[] = [];
    session.onSignOut((reason) => {
      signOuts.push(reason);
    });
    mswServer.use(http.get(apiUrl('/api/v1/teams'), () => problem(401, 'unauthenticated')));

    const outcomes = await Promise.allSettled([
      api.request('/api/v1/teams'),
      api.request('/api/v1/teams'),
    ]);

    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({ status: 401 });
    }
    expect(store.getState()).toEqual({
      status: 'signedOut',
      accessToken: null,
      accessTokenExpiresAt: null,
    });
    expect(secureStoreContents().has(REFRESH_TOKEN_KEY)).toBe(false);
    expect(signOuts).toEqual(['expired']);
    expect(tokens.refreshToken).not.toBe('');
  });

  it('keeps the session when the refresh fails for lack of network', async () => {
    const { api, store, tokens } = await signedIn(-1_000);
    mswServer.use(http.post(apiUrl('/api/v1/auth/refresh'), () => HttpResponse.error()));
    await expect(api.request('/api/v1/teams')).rejects.toMatchObject({ kind: 'network' });
    expect(store.getState().status).toBe('signedIn');
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value).toBe(tokens.refreshToken);
  });
});

describe('retries and time limits', () => {
  it('repeats an idempotent GET after 503 and network failures', async () => {
    const { api } = await signedIn();
    let calls = 0;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => {
        calls += 1;
        if (calls === 1) {
          return problem(503, 'service_unavailable');
        }
        if (calls === 2) {
          return HttpResponse.error();
        }
        return HttpResponse.json(TEAMS);
      }),
    );
    await expect(api.request('/api/v1/teams')).resolves.toEqual(TEAMS);
    expect(calls).toBe(3);
  });

  it('gives up after the configured retries', async () => {
    const { api } = await signedIn();
    let calls = 0;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => {
        calls += 1;
        return problem(503, 'service_unavailable', `req-${calls}`);
      }),
    );
    await expect(api.request('/api/v1/teams')).rejects.toMatchObject({
      status: 503,
      requestId: 'req-3',
    });
    expect(calls).toBe(3);
  });

  it('never repeats a POST', async () => {
    const { api } = await signedIn();
    let calls = 0;
    mswServer.use(
      http.post(apiUrl('/api/v1/teams'), () => {
        calls += 1;
        return problem(503, 'service_unavailable');
      }),
    );
    await expect(api.request('/api/v1/teams', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 503,
    });
    expect(calls).toBe(1);
  });

  it('does not repeat a client error', async () => {
    const { api } = await signedIn();
    let calls = 0;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => {
        calls += 1;
        return problem(404, 'not_found');
      }),
    );
    await expect(api.request('/api/v1/teams')).rejects.toMatchObject({ code: 'not_found' });
    expect(calls).toBe(1);
  });

  it('turns a slow response into a timeout error', async () => {
    const context = createTestApi({ timeoutMs: 20, retryDelaysMs: [] });
    await context.session.establish(issueTokens());
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), async () => {
        await delay(200);
        return HttpResponse.json(TEAMS);
      }),
    );
    await expect(context.api.request('/api/v1/teams')).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('passes a caller cancellation through without retrying', async () => {
    const { api } = await signedIn();
    let calls = 0;
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), async () => {
        calls += 1;
        await delay(200);
        return HttpResponse.json(TEAMS);
      }),
    );
    const controller = new AbortController();
    const pending = api.request('/api/v1/teams', { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });
});
