import { randomBytes as nodeRandomBytes } from 'node:crypto';

import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createAuthApi } from '../src/auth/auth-api';
import { nativeApplePort } from '../src/auth/apple-native';
import { type GoogleAuthPort, createProviderSignIn } from '../src/auth/providers';
import { sha256Hex } from '../src/auth/sha256';
import { REFRESH_TOKEN_KEY } from '../src/auth-store/token-storage';
import { createTestApi, issueTokens, problem } from './support/api';
import { __scriptApple, appleSignInCalls } from './support/expo-apple-authentication';
import { secureStoreContents } from './support/expo-secure-store';
import { apiUrl, mswServer } from './support/msw';

/*
 * Sign in with Apple and Google, flow level. The identity tokens below are made-up strings in the
 * compact JWS shape, the platform sheets are test doubles and the API is a mock server: no Apple
 * or Google account, no real token and no verification of a provider signature is involved.
 * Whether the real sheets work on a device is not covered here.
 */
const MOCK_IDENTITY_TOKEN = 'mock-header.mock-payload.mock-signature';
const secureRandom = (length: number) => new Uint8Array(nodeRandomBytes(length));

function serve(path: string) {
  const bodies: Record<string, unknown>[] = [];
  const tokens = issueTokens();
  mswServer.use(
    http.post(apiUrl(path), async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ user: { id: 'u1' }, tokens });
    }),
  );
  return { bodies, tokens };
}

function setup(google: GoogleAuthPort, randomBytes = secureRandom) {
  const { api, session, store } = createTestApi();
  const authApi = createAuthApi({ api, session, deviceLabel: 'iOS app' });
  const providers = createProviderSignIn({
    apple: nativeApplePort,
    google,
    authApi,
    randomBytes,
  });
  return { providers, store };
}

const noGoogle: GoogleAuthPort = { isAvailable: () => false, authorize: async () => null };

describe('Sign in with Apple', () => {
  it('hands Apple the SHA-256 of the raw nonce and sends the raw nonce to the API', async () => {
    const { bodies, tokens } = serve('/api/v1/auth/apple');
    __scriptApple({
      outcome: {
        kind: 'credential',
        identityToken: MOCK_IDENTITY_TOKEN,
        givenName: 'Ayşe',
        familyName: 'Yılmaz',
      },
    });
    const { providers, store } = setup(noGoogle);

    await expect(providers.signInWithApple()).resolves.toBe('signedIn');

    const sentNonce = bodies[0]?.nonce;
    expect(sentNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(appleSignInCalls()).toHaveLength(1);
    expect(appleSignInCalls()[0]?.nonce).toBe(sha256Hex(sentNonce as string));
    expect(appleSignInCalls()[0]?.nonce).not.toBe(sentNonce);
    expect(bodies[0]).toEqual({
      identityToken: MOCK_IDENTITY_TOKEN,
      nonce: sentNonce,
      displayName: 'Ayşe Yılmaz',
      deviceLabel: 'iOS app',
    });
    expect(store.getState().status).toBe('signedIn');
    expect(secureStoreContents().get(REFRESH_TOKEN_KEY)?.value).toBe(tokens.refreshToken);
  });

  it('uses a fresh nonce for every attempt', async () => {
    const { bodies } = serve('/api/v1/auth/apple');
    __scriptApple({ outcome: { kind: 'credential', identityToken: MOCK_IDENTITY_TOKEN } });
    const { providers } = setup(noGoogle);
    await providers.signInWithApple();
    await providers.signInWithApple();
    expect(bodies[0]?.nonce).not.toBe(bodies[1]?.nonce);
  });

  it('omits the name when Apple sends none or an unusable one', async () => {
    const { bodies } = serve('/api/v1/auth/apple');
    __scriptApple({ outcome: { kind: 'credential', identityToken: MOCK_IDENTITY_TOKEN } });
    const { providers } = setup(noGoogle);
    await providers.signInWithApple();
    __scriptApple({
      outcome: { kind: 'credential', identityToken: MOCK_IDENTITY_TOKEN, givenName: 'A' },
    });
    await providers.signInWithApple();
    expect(bodies.map((body) => 'displayName' in body)).toEqual([false, false]);
  });

  it('treats a dismissed sheet as a cancellation: no request, no error, no session', async () => {
    let requests = 0;
    mswServer.use(
      http.post(apiUrl('/api/v1/auth/apple'), () => {
        requests += 1;
        return HttpResponse.json({});
      }),
    );
    __scriptApple({ outcome: { kind: 'cancel' } });
    const { providers, store } = setup(noGoogle);
    await expect(providers.signInWithApple()).resolves.toBe('cancelled');
    expect(requests).toBe(0);
    expect(store.getState().status).toBe('unknown');
  });

  it('propagates a sheet failure and a missing identity token', async () => {
    const { providers } = setup(noGoogle);
    __scriptApple({ outcome: { kind: 'fail' } });
    await expect(providers.signInWithApple()).rejects.toThrow('failed');
    __scriptApple({ outcome: { kind: 'credential', identityToken: null } });
    await expect(providers.signInWithApple()).rejects.toThrow('no identity token');
  });

  it('surfaces the API refusal and keeps the user signed out', async () => {
    mswServer.use(
      http.post(apiUrl('/api/v1/auth/apple'), () => problem(409, 'account_link_required')),
    );
    __scriptApple({ outcome: { kind: 'credential', identityToken: MOCK_IDENTITY_TOKEN } });
    const { providers, store } = setup(noGoogle);
    await expect(providers.signInWithApple()).rejects.toMatchObject({
      code: 'account_link_required',
    });
    expect(store.getState().status).toBe('unknown');
  });

  it('is unavailable without a secure random source or without the platform feature', async () => {
    __scriptApple({ outcome: { kind: 'credential', identityToken: MOCK_IDENTITY_TOKEN } });
    const noRandom = setup(noGoogle, () => null as never);
    expect(await noRandom.providers.appleAvailable()).toBe(false);
    await expect(noRandom.providers.signInWithApple()).resolves.toBe('unavailable');

    __scriptApple({ available: false });
    const noApple = setup(noGoogle);
    expect(await noApple.providers.appleAvailable()).toBe(false);
    await expect(noApple.providers.signInWithApple()).resolves.toBe('unavailable');
    expect(appleSignInCalls()).toHaveLength(0);
  });
});

describe('Sign in with Google', () => {
  const googleWith = (result: { idToken: string } | null) => {
    const nonces: string[] = [];
    const port: GoogleAuthPort = {
      isAvailable: () => true,
      authorize: async (nonce) => {
        nonces.push(nonce);
        return result;
      },
    };
    return { port, nonces };
  };

  it('requests the ID token with the nonce and exchanges it with the same nonce', async () => {
    const { bodies, tokens } = serve('/api/v1/auth/google');
    const { port, nonces } = googleWith({ idToken: MOCK_IDENTITY_TOKEN });
    const { providers, store } = setup(port);

    await expect(providers.signInWithGoogle()).resolves.toBe('signedIn');

    expect(nonces).toHaveLength(1);
    expect(bodies[0]).toEqual({
      idToken: MOCK_IDENTITY_TOKEN,
      nonce: nonces[0],
      deviceLabel: 'iOS app',
    });
    expect(store.getState().accessToken).toBe(tokens.accessToken);
  });

  it('treats a dismissed sheet as a cancellation', async () => {
    const { port } = googleWith(null);
    const { providers, store } = setup(port);
    await expect(providers.signInWithGoogle()).resolves.toBe('cancelled');
    expect(store.getState().status).toBe('unknown');
  });

  it('is unavailable while no client configuration exists', async () => {
    const { providers } = setup(noGoogle);
    expect(providers.googleAvailable()).toBe(false);
    await expect(providers.signInWithGoogle()).resolves.toBe('unavailable');
  });
});
