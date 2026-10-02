import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../src/api/errors';
import { createAuthApi } from '../src/auth/auth-api';
import { REFRESH_TOKEN_KEY } from '../src/auth-store/token-storage';
import { createTestApi, issueTokens, problem } from './support/api';
import { secureStoreContents } from './support/expo-secure-store';
import { apiUrl, mswServer } from './support/msw';

interface Captured {
  readonly headers: Headers;
  readonly body: unknown;
}

/** Answers `path` with `respond` and records what the client sent. */
function serve(
  path: string,
  respond: () => Response | Promise<Response>,
): { readonly requests: Captured[] } {
  const requests: Captured[] = [];
  mswServer.use(
    http.post(apiUrl(path), async ({ request }) => {
      const text = await request.text();
      requests.push({
        headers: request.headers,
        body: text === '' ? null : (JSON.parse(text) as unknown),
      });
      return respond();
    }),
  );
  return { requests };
}

function signedIn(tokens = issueTokens()) {
  return HttpResponse.json({
    user: { id: '0192a0b0-0000-7000-8000-000000000001', email: 'ayse@example.com' },
    tokens,
  });
}

function setup() {
  const { api, session, store } = createTestApi();
  const authApi = createAuthApi({ api, session, deviceLabel: 'iOS app' });
  return { authApi, session, store };
}

const ACCEPTED = () => HttpResponse.json({ status: 'accepted' }, { status: 202 });
const NO_CONTENT = () => new HttpResponse(null, { status: 204 });
const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';

describe('login', () => {
  it('posts normalized credentials as the mobile client, without a bearer token, and starts the session', async () => {
    const tokens = issueTokens();
    const { requests } = serve('/api/v1/auth/login', () => signedIn(tokens));
    const { authApi, store } = setup();

    await authApi.login({ email: '  Ayse@Example.COM ', password: 'correct horse battery' });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers.get('x-kadro-client')).toBe('mobile');
    expect(requests[0]?.headers.get('authorization')).toBeNull();
    expect(requests[0]?.body).toEqual({
      email: 'ayse@example.com',
      password: 'correct horse battery',
      deviceLabel: 'iOS app',
    });
    expect(store.getState().status).toBe('signedIn');
    expect(store.getState().accessToken).toBe(tokens.accessToken);
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value).toBe(tokens.refreshToken);
  });

  it('keeps the user signed out and surfaces the problem code on invalid credentials', async () => {
    serve('/api/v1/auth/login', () => problem(401, 'invalid_credentials'));
    const { authApi, store } = setup();

    const failure = await authApi
      .login({ email: 'ayse@example.com', password: 'wrong password' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('invalid_credentials');
    expect(store.getState().status).toBe('unknown');
    expect(secureStoreContents().has(REFRESH_TOKEN_KEY)).toBe(false);
  });

  it('does not start a session from a success response without usable tokens', async () => {
    serve('/api/v1/auth/login', () =>
      HttpResponse.json({ user: {}, tokens: { tokenType: 'Bearer' } }),
    );
    const { authApi, store } = setup();

    await expect(
      authApi.login({ email: 'ayse@example.com', password: 'correct horse battery' }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
    expect(store.getState().status).toBe('unknown');
    expect(secureStoreContents().has(REFRESH_TOKEN_KEY)).toBe(false);
  });
});

describe('register, forgot, reset, verify', () => {
  it('register sends the trimmed profile and issues no session', async () => {
    const { requests } = serve('/api/v1/auth/register', ACCEPTED);
    const { authApi, store } = setup();

    await authApi.register({
      email: ' Ayse@Example.com',
      password: 'correct horse battery',
      displayName: '  Ayşe Yılmaz ',
    });

    expect(requests[0]?.headers.get('x-kadro-client')).toBe('mobile');
    expect(requests[0]?.body).toEqual({
      email: 'ayse@example.com',
      password: 'correct horse battery',
      displayName: 'Ayşe Yılmaz',
    });
    expect(store.getState().status).toBe('unknown');
    expect(secureStoreContents().size).toBe(0);
  });

  it('register surfaces a breached password', async () => {
    serve('/api/v1/auth/register', () => problem(422, 'password_breached'));
    const { authApi } = setup();
    await expect(
      authApi.register({ email: 'a@example.com', password: 'password123456', displayName: 'Ayşe' }),
    ).rejects.toMatchObject({ code: 'password_breached' });
  });

  it('forgot sends only the normalized email', async () => {
    const { requests } = serve('/api/v1/auth/forgot', ACCEPTED);
    await setup().authApi.forgotPassword(' Ayse@Example.com ');
    expect(requests[0]?.body).toEqual({ email: 'ayse@example.com' });
  });

  it('reset sends the token and the new password and keeps the device session untouched', async () => {
    const { requests } = serve('/api/v1/auth/reset', NO_CONTENT);
    await setup().authApi.resetPassword({ token: TOKEN, password: 'a brand new password' });
    expect(requests[0]?.body).toEqual({ token: TOKEN, password: 'a brand new password' });
  });

  it('reset and verify surface token_invalid', async () => {
    serve('/api/v1/auth/reset', () => problem(401, 'token_invalid'));
    serve('/api/v1/auth/verify-email', () => problem(401, 'token_invalid'));
    const { authApi } = setup();
    await expect(
      authApi.resetPassword({ token: TOKEN, password: 'a brand new password' }),
    ).rejects.toMatchObject({ code: 'token_invalid' });
    await expect(authApi.verifyEmail(TOKEN)).rejects.toMatchObject({ code: 'token_invalid' });
  });

  it('verify posts only the token', async () => {
    const { requests } = serve('/api/v1/auth/verify-email', NO_CONTENT);
    await setup().authApi.verifyEmail(TOKEN);
    expect(requests[0]?.body).toEqual({ token: TOKEN });
    expect(requests[0]?.headers.get('authorization')).toBeNull();
  });

  it('a 429 carries the Retry-After seconds', async () => {
    serve('/api/v1/auth/forgot', () =>
      HttpResponse.json(
        { status: 429, code: 'rate_limited', requestId: 'req-1' },
        {
          status: 429,
          headers: { 'retry-after': '37', 'content-type': 'application/problem+json' },
        },
      ),
    );
    const failure = await setup()
      .authApi.forgotPassword('a@example.com')
      .catch((error: unknown) => error);
    expect((failure as ApiError).retryAfterSeconds).toBe(37);
  });
});
